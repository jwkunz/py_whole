const SCIENTIFIC_PACKAGES = [
  "numpy",
  "scipy",
  "matplotlib",
  "sympy",
  "pandas",
  "opencv",
  "xarray",
  "statsmodels",
  "networkx",
  "scikit-image",
  "plotly",
  "bokeh",
  "seaborn",
  "mpmath",
  "pint",
];

const notebookState = {
  runtimeReady: false,
  saveState: "Unsaved",
  workspace: {
    activeNotebookId: null,
    files: [],
    notebooks: [],
  },
};

let nextCellId = 1;
let saveTimer = null;
const EMBEDDED_PYODIDE = globalThis.__PYWHOLE_EMBEDDED_PYODIDE__ || { available: false };
const BUNDLED_PACKAGE_SET = new Set(EMBEDDED_PYODIDE.bundledPackages || []);
const WORKSPACE_STORAGE_KEY = "py_whole.workspace.v1";

const runtimeAdapter = {
  pyodide: null,
  runCellFn: null,

  async initialize() {
    if (this.pyodide) {
      notebookState.runtimeReady = true;
      updateKernelState("Runtime ready");
      return;
    }

    if (!EMBEDDED_PYODIDE.available || typeof globalThis.loadPyodide !== "function") {
      throw new Error("Embedded Pyodide runtime assets are not available in this build.");
    }

    updateKernelState("Loading embedded Pyodide");
    installPyodideAssetFetch();
    this.pyodide = await globalThis.loadPyodide({
      indexURL: EMBEDDED_PYODIDE.indexURL,
      lockFileURL: EMBEDDED_PYODIDE.lockFileURL,
      stdout: () => {},
      stderr: () => {},
    });
    if (EMBEDDED_PYODIDE.bundledPackages?.length) {
      updateKernelState("Loading bundled scientific packages");
      await this.pyodide.loadPackage(EMBEDDED_PYODIDE.bundledPackages);
    }
    await this.installNotebookHelpers();
    await this.syncWorkspaceFiles();
    notebookState.runtimeReady = true;
    updateKernelState(
      `Runtime ready (Pyodide ${EMBEDDED_PYODIDE.version}, ${EMBEDDED_PYODIDE.bundledPackages?.length || 0} bundled packages)`,
    );
  },

  async restart() {
    updateKernelState("Restarting via page reload");
    window.location.reload();
  },

  async execute(source) {
    if (!this.pyodide || !notebookState.runtimeReady) {
      throw new Error(
        "Runtime is not initialized. Click 'Initialize Runtime' before running cells.",
      );
    }

    const stdout = [];
    const stderr = [];
    this.pyodide.setStdout({
      batched: (line) => stdout.push(line),
    });
    this.pyodide.setStderr({
      batched: (line) => stderr.push(line),
    });

    globalThis.__pyWholeDisplayOutputs = [];
    try {
      if (!this.runCellFn) {
        this.runCellFn = this.pyodide.globals.get("_pywhole_run_cell");
      }
      await this.runCellFn(source);
    } finally {
      this.pyodide.setStdout({ batched: () => {} });
      this.pyodide.setStderr({ batched: () => {} });
    }

    const outputs = [];
    if (stdout.length) {
      outputs.push(createStreamOutput(stdout.join("\n")));
    }
    outputs.push(...normalizeDisplayOutputs(globalThis.__pyWholeDisplayOutputs || []));
    if (stderr.length) {
      outputs.push(createStreamOutput(stderr.join("\n")));
    }

    return outputs.length ? outputs : [createStreamOutput("Execution completed with no textual output.")];
  },

  async installNotebookHelpers() {
    this.pyodide.registerJsModule("pywhole_bridge", {
      push_output(payload) {
        if (!globalThis.__pyWholeDisplayOutputs) {
          globalThis.__pyWholeDisplayOutputs = [];
        }
        globalThis.__pyWholeDisplayOutputs.push(payload);
      },
    });

    await this.pyodide.runPythonAsync(`
import ast
import base64
import __main__
from pywhole_bridge import push_output

def _pywhole_capture_display(value):
    if value is None:
        return

    if hasattr(value, "_repr_html_"):
        html = value._repr_html_()
        if html:
            push_output({"kind": "html", "html": str(html)})
            return

    if hasattr(value, "_repr_png_"):
        png = value._repr_png_()
        if png:
            if isinstance(png, memoryview):
                png = png.tobytes()
            encoded = base64.b64encode(png).decode("ascii")
            push_output({"kind": "image", "mime": "image/png", "data": encoded})
            return

    if "matplotlib" in globals():
        try:
            import io
            import matplotlib.pyplot as plt
            figures = [plt.figure(num) for num in plt.get_fignums()]
            for figure in figures:
                buffer = io.BytesIO()
                figure.savefig(buffer, format="png", bbox_inches="tight")
                encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                push_output({"kind": "image", "mime": "image/png", "data": encoded})
            if figures:
                plt.close("all")
                return
        except Exception:
            pass

    push_output({"kind": "stream", "text": str(value)})

def _pywhole_capture_figures():
    try:
        import io
        import matplotlib.pyplot as plt
    except Exception:
        return

    figure_numbers = list(plt.get_fignums())
    if not figure_numbers:
        return

    for number in figure_numbers:
        figure = plt.figure(number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        push_output({"kind": "image", "mime": "image/png", "data": encoded})
    plt.close("all")

def _pywhole_run_cell(source):
    namespace = __main__.__dict__
    tree = ast.parse(source, mode="exec")

    if tree.body and isinstance(tree.body[-1], ast.Expr):
        prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
        if prefix.body:
            exec(compile(prefix, "<py_whole>", "exec"), namespace, namespace)
        expr = ast.Expression(tree.body[-1].value)
        value = eval(compile(expr, "<py_whole>", "eval"), namespace, namespace)
        _pywhole_capture_display(value)
    else:
        exec(compile(tree, "<py_whole>", "exec"), namespace, namespace)

    _pywhole_capture_figures()
`);
  },

  async syncWorkspaceFiles() {
    if (!this.pyodide) {
      return;
    }

    const files = notebookState.workspace.files || [];
    this.pyodide.FS.mkdirTree("/workspace");
    for (const file of files) {
      const bytes = decodeBase64ToUint8Array(file.base64);
      const path = `/workspace/${file.path || file.name}`;
      ensureParentDirectories(this.pyodide.FS, path);
      try {
        this.pyodide.FS.unlink(path);
      } catch (_error) {
      }
      this.pyodide.FS.writeFile(path, bytes);
    }
  },
};

function normalizeDisplayOutputs(items) {
  return (items || [])
    .map((item) => {
      if (item.kind === "html") {
        return createHtmlOutput(item.html || "");
      }
      if (item.kind === "image") {
        return createImageOutput(item.mime || "image/png", item.data || "");
      }
      if (item.kind === "stream") {
        return createStreamOutput(item.text || "");
      }
      return null;
    })
    .filter(Boolean);
}

function installPyodideAssetFetch() {
  if (!EMBEDDED_PYODIDE.available || globalThis.__pyWholePyodideFetchInstalled) {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  const assetCache = new Map();
  const base = EMBEDDED_PYODIDE.indexURL;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (typeof url === "string" && url.startsWith(base)) {
      return serveEmbeddedPyodideAsset(url, assetCache);
    }
    return originalFetch(input, init);
  };

  globalThis.__pyWholePyodideFetchInstalled = true;
}

function serveEmbeddedPyodideAsset(url, assetCache) {
  const headers = new Headers();
  if (url.endsWith("pyodide.asm.wasm")) {
    headers.set("Content-Type", "application/wasm");
    return Promise.resolve(
      new Response(decodeBase64Asset("wasm", EMBEDDED_PYODIDE.assets.wasmBase64, assetCache), {
        headers,
      }),
    );
  }
  if (url.endsWith("python_stdlib.zip")) {
    headers.set("Content-Type", "application/zip");
    return Promise.resolve(
      new Response(
        decodeBase64Asset("stdlib", EMBEDDED_PYODIDE.assets.stdlibBase64, assetCache),
        { headers },
      ),
    );
  }
  if (url.endsWith("pyodide-lock.json")) {
    headers.set("Content-Type", "application/json");
    return Promise.resolve(new Response(EMBEDDED_PYODIDE.assets.lockFileText, { headers }));
  }
  const packageFileName = url.slice(EMBEDDED_PYODIDE.indexURL.length);
  if (EMBEDDED_PYODIDE.assets.packages && EMBEDDED_PYODIDE.assets.packages[packageFileName]) {
    headers.set(
      "Content-Type",
      packageFileName.endsWith(".zip") ? "application/zip" : "application/octet-stream",
    );
    return Promise.resolve(
      new Response(
        decodeBase64Asset(
          `pkg:${packageFileName}`,
          EMBEDDED_PYODIDE.assets.packages[packageFileName],
          assetCache,
        ),
        { headers },
      ),
    );
  }
  return Promise.resolve(new Response("Not found", { status: 404 }));
}

function decodeBase64Asset(cacheKey, base64, assetCache) {
  if (assetCache.has(cacheKey)) {
    return assetCache.get(cacheKey);
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  assetCache.set(cacheKey, bytes);
  return bytes;
}

function encodeUint8ArrayToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function decodeBase64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeWorkspacePath(path) {
  return String(path || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function basename(path) {
  const parts = normalizeWorkspacePath(path).split("/");
  return parts[parts.length - 1] || "";
}

function ensureParentDirectories(fsApi, absolutePath) {
  const parts = absolutePath.split("/").filter(Boolean);
  let current = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    current += `/${parts[index]}`;
    try {
      fsApi.mkdir(current);
    } catch (_error) {
    }
  }
}

function updateKernelState(text) {
  document.getElementById("kernel-state").textContent = text;
}

function updateSaveState(text) {
  notebookState.saveState = text;
  document.getElementById("save-state").textContent = text;
}

function createNotebookRecord(title = "Untitled") {
  return {
    id: `nb-${crypto.randomUUID()}`,
    title,
    cells: [],
    updatedAt: new Date().toISOString(),
  };
}

function createWorkspaceFile(name, bytes, type = "application/octet-stream") {
  const normalizedPath = normalizeWorkspacePath(name);
  return {
    id: `file-${crypto.randomUUID()}`,
    name: basename(normalizedPath),
    path: normalizedPath,
    type,
    size: bytes.length,
    updatedAt: new Date().toISOString(),
    base64: encodeUint8ArrayToBase64(bytes),
  };
}

function activeNotebook() {
  return notebookState.workspace.notebooks.find(
    (notebook) => notebook.id === notebookState.workspace.activeNotebookId,
  );
}

function createCodeCell(source, output = "") {
  return {
    id: nextCellId++,
    cellType: "code",
    source,
    outputs: output ? [createStreamOutput(output)] : [],
    executionCount: null,
    status: "Idle",
  };
}

function createMarkdownCell(source) {
  return {
    id: nextCellId++,
    cellType: "markdown",
    source,
    outputs: [],
    executionCount: null,
    status: "Idle",
  };
}

function createStreamOutput(text) {
  return {
    kind: "stream",
    text,
  };
}

function createHtmlOutput(html) {
  return {
    kind: "html",
    html,
  };
}

function createImageOutput(mime, data) {
  return {
    kind: "image",
    mime,
    data,
  };
}

function createStarterNotebook() {
  const notebook = createNotebookRecord("Untitled");
  notebook.cells = [
    createCodeCell(
      [
        "# py_whole proof of concept",
        "import math",
        "",
        "radius = 3",
        "area = math.pi * radius ** 2",
        "print(f'circle area = {area:.3f}')",
      ].join("\n"),
      "Cell output will appear here.",
    ),
  ];
  return notebook;
}

function scheduleAutosave() {
  updateSaveState("Pending autosave");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNotebookToStorage, 250);
}

function syncNotebookTitle() {
  const notebook = activeNotebook();
  document.getElementById("notebook-title-input").value = notebook ? notebook.title : "Untitled";
}

function notebookFileName() {
  const notebook = activeNotebook();
  const trimmed = (notebook ? notebook.title : "Untitled").trim() || "Untitled";
  return trimmed.endsWith(".ipynb") ? trimmed : `${trimmed}.ipynb`;
}

function buildIpynbDocument() {
  const notebook = activeNotebook();
  const cells = notebook ? notebook.cells : [];
  return {
    cells: cells.map((cell) => ({
      cell_type: cell.cellType,
      execution_count: cell.cellType === "code" ? cell.executionCount : null,
      metadata: {},
      outputs:
        cell.cellType === "code" ? serializeOutputs(cell.outputs) : [],
      source: splitLines(cell.source),
    })),
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.x",
      },
      py_whole: {
        saved_at: new Date().toISOString(),
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function serializeOutputs(outputs) {
  return (outputs || [])
    .map((output) => {
      if (output.kind === "stream") {
        return {
          name: "stdout",
          output_type: "stream",
          text: `${output.text}\n`,
        };
      }
      if (output.kind === "html") {
        return {
          output_type: "display_data",
          data: {
            "text/html": output.html,
          },
          metadata: {},
        };
      }
      if (output.kind === "image") {
        return {
          output_type: "display_data",
          data: {
            [output.mime]: output.data,
          },
          metadata: {},
        };
      }
      return null;
    })
    .filter(Boolean);
}

function splitLines(text) {
  if (!text) {
    return [];
  }

  return text.split("\n").map((line, index, all) => {
    const needsNewline = index < all.length - 1;
    return needsNewline ? `${line}\n` : line;
  });
}

function joinNotebookSource(source) {
  if (Array.isArray(source)) {
    return source.join("");
  }
  return String(source || "");
}

function parseOutputs(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return [];
  }

  return outputs
    .map((output) => {
      if (output.output_type === "stream") {
        return createStreamOutput(joinNotebookSource(output.text));
      }
      if (output.output_type === "execute_result" || output.output_type === "display_data") {
        const html = output.data && output.data["text/html"];
        if (html) {
          return createHtmlOutput(joinNotebookSource(html));
        }
        const png = output.data && output.data["image/png"];
        if (png) {
          return createImageOutput("image/png", joinNotebookSource(png));
        }
        const plain = output.data && output.data["text/plain"];
        return plain ? createStreamOutput(joinNotebookSource(plain)) : null;
      }
      if (output.output_type === "error") {
        const traceback = output.traceback || [];
        return createStreamOutput(traceback.join("\n"));
      }
      return null;
    })
    .filter(Boolean);
}

function saveNotebookToStorage() {
  const payload = {
    activeNotebookId: notebookState.workspace.activeNotebookId,
    files: notebookState.workspace.files,
    notebooks: notebookState.workspace.notebooks.map((notebook) => ({
      id: notebook.id,
      title: notebook.title,
      updatedAt: notebook.updatedAt,
      notebook: buildIpynbDocumentForNotebook(notebook),
    })),
  };
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  updateSaveState(`Saved locally at ${new Date().toLocaleTimeString()}`);
}

function loadNotebookFromStorage() {
  const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) {
    const notebook = createStarterNotebook();
    notebookState.workspace.notebooks = [notebook];
    notebookState.workspace.activeNotebookId = notebook.id;
    updateSaveState("Not yet saved");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    applyWorkspaceState(parsed);
    updateSaveState("Recovered from browser storage");
  } catch (error) {
    console.error(error);
    const notebook = createStarterNotebook();
    notebookState.workspace.notebooks = [notebook];
    notebookState.workspace.activeNotebookId = notebook.id;
    updateSaveState("Recovery failed");
  }
}

function applyImportedNotebook(document, titleHint) {
  const importedCells = Array.isArray(document.cells) ? document.cells : [];
  const notebook = createNotebookRecord(stripNotebookExtension(titleHint || "Imported"));
  notebook.cells = importedCells.length
    ? importedCells.map((cell) => ({
        id: nextCellId++,
        cellType: cell.cell_type === "markdown" ? "markdown" : "code",
        source: joinNotebookSource(cell.source),
        outputs: parseOutputs(cell.outputs),
        executionCount: cell.execution_count ?? null,
        status: "Idle",
      }))
    : [createCodeCell("print('new notebook')")];
  notebook.updatedAt = new Date().toISOString();
  notebookState.workspace.notebooks.push(notebook);
  notebookState.workspace.activeNotebookId = notebook.id;
  syncNotebookTitle();
}

function applyWorkspaceState(state) {
  const notebooks = Array.isArray(state.notebooks) ? state.notebooks : [];
  notebookState.workspace.files = Array.isArray(state.files) ? state.files : [];
  notebookState.workspace.notebooks = notebooks.length
    ? notebooks.map((entry) => hydrateNotebookRecord(entry))
    : [createStarterNotebook()];
  notebookState.workspace.activeNotebookId =
    state.activeNotebookId && notebookState.workspace.notebooks.some((entry) => entry.id === state.activeNotebookId)
      ? state.activeNotebookId
      : notebookState.workspace.notebooks[0].id;
}

function hydrateNotebookRecord(entry) {
  const notebook = createNotebookRecord(stripNotebookExtension(entry.title || "Recovered"));
  notebook.id = entry.id || notebook.id;
  notebook.updatedAt = entry.updatedAt || new Date().toISOString();
  const document = entry.notebook || {};
  const importedCells = Array.isArray(document.cells) ? document.cells : [];
  notebook.cells = importedCells.length
    ? importedCells.map((cell) => ({
        id: nextCellId++,
        cellType: cell.cell_type === "markdown" ? "markdown" : "code",
        source: joinNotebookSource(cell.source),
        outputs: parseOutputs(cell.outputs),
        executionCount: cell.execution_count ?? null,
        status: "Idle",
      }))
    : [createCodeCell("print('new notebook')")];
  return notebook;
}

function buildIpynbDocumentForNotebook(notebook) {
  const previousId = notebookState.workspace.activeNotebookId;
  notebookState.workspace.activeNotebookId = notebook.id;
  const document = buildIpynbDocument();
  notebookState.workspace.activeNotebookId = previousId;
  return document;
}

function stripNotebookExtension(name) {
  return String(name || "Untitled").replace(/\.ipynb$/i, "");
}

function renderPackageList() {
  const list = document.getElementById("package-list");
  list.replaceChildren(
    ...SCIENTIFIC_PACKAGES.map((pkg) => {
      const item = document.createElement("li");
      item.textContent = BUNDLED_PACKAGE_SET.has(pkg) ? `${pkg} (bundled)` : `${pkg} (planned)`;
      return item;
    }),
  );
}

function renderWorkspaceList() {
  const list = document.getElementById("workspace-list");
  list.replaceChildren(
    ...notebookState.workspace.notebooks.map((notebook) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-item";
      button.classList.toggle("is-active", notebook.id === notebookState.workspace.activeNotebookId);
      button.addEventListener("click", () => switchNotebook(notebook.id));

      const title = document.createElement("span");
      title.className = "workspace-item-title";
      title.textContent = `${notebook.title}.ipynb`;

      const meta = document.createElement("span");
      meta.className = "workspace-item-meta";
      meta.textContent = new Date(notebook.updatedAt).toLocaleString();

      button.append(title, meta);
      return button;
    }),
  );
}

function renderWorkspaceFiles() {
  const list = document.getElementById("workspace-files");
  const files = notebookState.workspace.files || [];
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "workspace-file-item";
    empty.textContent = "No imported files yet.";
    list.replaceChildren(empty);
    return;
  }

  const tree = buildWorkspaceTree(files);
  list.replaceChildren(...renderWorkspaceTreeNodes(tree));
}

function formatBytes(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildWorkspaceTree(files) {
  const root = new Map();
  for (const file of files) {
    const parts = normalizeWorkspacePath(file.path || file.name).split("/");
    let cursor = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isLeaf = index === parts.length - 1;
      if (isLeaf) {
        cursor.set(part, { type: "file", file });
      } else {
        if (!cursor.has(part)) {
          cursor.set(part, { type: "directory", children: new Map() });
        }
        cursor = cursor.get(part).children;
      }
    }
  }
  return root;
}

function renderWorkspaceTreeNodes(tree) {
  return Array.from(tree.entries()).map(([name, entry]) => {
    if (entry.type === "directory") {
      const dir = document.createElement("div");
      dir.className = "workspace-directory";

      const title = document.createElement("span");
      title.className = "workspace-directory-title";
      title.textContent = `${name}/`;

      const children = document.createElement("div");
      children.className = "workspace-directory-children";
      children.replaceChildren(...renderWorkspaceTreeNodes(entry.children));

      dir.append(title, children);
      return dir;
    }

    const file = entry.file;
    const item = document.createElement("div");
    item.className = "workspace-file-item";

    const title = document.createElement("span");
    title.className = "workspace-item-title";
    title.textContent = file.name;

    const meta = document.createElement("span");
    meta.className = "workspace-item-meta";
    meta.textContent = `${file.path || file.name} • ${formatBytes(file.size)} • ${new Date(file.updatedAt).toLocaleString()}`;

    const actions = document.createElement("div");
    actions.className = "workspace-file-actions";

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "secondary";
    exportButton.textContent = "Export";
    exportButton.addEventListener("click", () => exportWorkspaceFile(file.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteWorkspaceFile(file.id));

    actions.append(exportButton, deleteButton);
    item.append(title, meta, actions);
    return item;
  });
}

function renderCellOutputs(outputList, outputs) {
  const items = Array.isArray(outputs) ? outputs : [];
  if (!items.length) {
    const empty = document.createElement("pre");
    empty.className = "cell-output-text is-empty";
    empty.textContent = "Cell output will appear here.";
    outputList.replaceChildren(empty);
    return;
  }

  outputList.replaceChildren(
    ...items.map((output) => {
      if (output.kind === "html") {
        const html = document.createElement("div");
        html.className = "cell-output-html";
        html.innerHTML = output.html;
        return html;
      }
      if (output.kind === "image") {
        const wrapper = document.createElement("div");
        wrapper.className = "cell-output-image";
        const image = document.createElement("img");
        image.src = `data:${output.mime};base64,${output.data}`;
        wrapper.append(image);
        return wrapper;
      }
      const pre = document.createElement("pre");
      pre.className = "cell-output-text";
      pre.textContent = output.text || "";
      return pre;
    }),
  );
}

function renderMarkdownPreview(previewNode, source) {
  previewNode.innerHTML = markdownToHtml(source || "");
}

function markdownToHtml(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const fence = trimmed;
      const codeLines = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== fence) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderInlineMarkdown(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*]\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+\.\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim()) {
      const candidate = lines[index].trim();
      if (
        candidate.startsWith("```") ||
        candidate.startsWith(">") ||
        candidate.match(/^#{1,4}\s+/) ||
        candidate.match(/^[-*]\s+/) ||
        candidate.match(/^\d+\.\s+/)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
  }

  return blocks.join("");
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderNotebook() {
  const notebook = activeNotebook();
  if (!notebook) {
    return;
  }
  const cellsRoot = document.getElementById("notebook-cells");
  const template = document.getElementById("cell-template");
  renderWorkspaceList();
  renderWorkspaceFiles();

  cellsRoot.replaceChildren(
    ...notebook.cells.map((cell, index) => {
      const fragment = template.content.cloneNode(true);
      const article = fragment.querySelector(".cell");
      const kindNode = fragment.querySelector(".cell-kind");
      const statusNode = fragment.querySelector(".cell-status");
      const editorModeLabel = fragment.querySelector(".editor-mode-label");
      const editor = fragment.querySelector(".cell-editor");
      const markdownPreviewBlock = fragment.querySelector(".markdown-preview-block");
      const markdownPreview = fragment.querySelector(".cell-markdown-preview");
      const outputBlock = fragment.querySelector(".output-block");
      const outputList = fragment.querySelector(".cell-output-list");
      const toggleKindButton = fragment.querySelector(".toggle-kind");
      const runButton = fragment.querySelector(".run-cell");
      const deleteButton = fragment.querySelector(".delete-cell");
      const moveUpButton = fragment.querySelector(".move-up");
      const moveDownButton = fragment.querySelector(".move-down");

      article.dataset.cellId = String(cell.id);
      kindNode.textContent = cell.cellType === "markdown" ? "Markdown" : "Code";
      statusNode.textContent = cell.status;
      editorModeLabel.textContent = cell.cellType === "markdown" ? "Markdown" : "Python";
      editor.value = cell.source;
      markdownPreviewBlock.classList.toggle("is-hidden", cell.cellType !== "markdown");
      outputBlock.classList.toggle("is-hidden", cell.cellType === "markdown");
      if (cell.cellType === "markdown") {
        renderMarkdownPreview(markdownPreview, cell.source);
      }
      renderCellOutputs(outputList, cell.outputs);
      toggleKindButton.addEventListener("click", () => toggleCellType(cell.id));
      runButton.addEventListener("click", () => runCell(cell.id));
      deleteButton.addEventListener("click", () => deleteCell(cell.id));
      moveUpButton.disabled = index === 0;
      moveDownButton.disabled = index === notebook.cells.length - 1;
      runButton.disabled = cell.cellType !== "code";
      moveUpButton.addEventListener("click", () => moveCell(cell.id, -1));
      moveDownButton.addEventListener("click", () => moveCell(cell.id, 1));
      editor.addEventListener("input", (event) => {
        cell.source = event.target.value;
        scheduleAutosave();
      });

      return fragment;
    }),
  );
}

function addCodeCell() {
  const notebook = activeNotebook();
  if (!notebook) {
    return;
  }
  notebook.cells.push(createCodeCell("print('hello from py_whole')"));
  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  scheduleAutosave();
}

function addMarkdownCell() {
  const notebook = activeNotebook();
  if (!notebook) {
    return;
  }
  notebook.cells.push(createMarkdownCell("# Markdown cell\n\nDocument your work here."));
  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  scheduleAutosave();
}

function deleteCell(cellId) {
  const notebook = activeNotebook();
  if (!notebook || notebook.cells.length === 1) {
    return;
  }

  notebook.cells = notebook.cells.filter((cell) => cell.id !== cellId);
  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  scheduleAutosave();
}

function moveCell(cellId, offset) {
  const notebook = activeNotebook();
  if (!notebook) {
    return;
  }
  const index = notebook.cells.findIndex((cell) => cell.id === cellId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= notebook.cells.length) {
    return;
  }

  const [cell] = notebook.cells.splice(index, 1);
  notebook.cells.splice(targetIndex, 0, cell);
  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  scheduleAutosave();
}

function toggleCellType(cellId) {
  const notebook = activeNotebook();
  const cell = notebook && notebook.cells.find((entry) => entry.id === cellId);
  if (!cell) {
    return;
  }

  if (cell.cellType === "code") {
    cell.cellType = "markdown";
    cell.outputs = [];
    cell.executionCount = null;
    cell.status = "Idle";
  } else {
    cell.cellType = "code";
    cell.status = "Idle";
  }

  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  scheduleAutosave();
}

async function runCell(cellId) {
  const notebook = activeNotebook();
  const cell = notebook && notebook.cells.find((entry) => entry.id === cellId);
  if (!cell || cell.cellType !== "code") {
    return;
  }

  cell.status = "Running";
  cell.outputs = [createStreamOutput("Executing...")];
  renderNotebook();

  try {
    const outputs = await runtimeAdapter.execute(cell.source);
    cell.outputs = outputs;
    cell.executionCount = (cell.executionCount || 0) + 1;
    cell.status = "Complete";
  } catch (error) {
    cell.outputs = [createStreamOutput(String(error.message || error))];
    cell.status = "Error";
  }

  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  scheduleAutosave();
}

async function runAllCells() {
  const notebook = activeNotebook();
  if (!notebook) {
    return;
  }
  for (const cell of notebook.cells) {
    await runCell(cell.id);
  }
}

function wireEvents() {
  document
    .getElementById("initialize-runtime")
    .addEventListener("click", async () => {
      try {
        await runtimeAdapter.initialize();
      } catch (error) {
        updateKernelState(String(error.message || error));
      }
    });
  document
    .getElementById("restart-runtime")
    .addEventListener("click", () => runtimeAdapter.restart());
  document
    .getElementById("add-code-cell")
    .addEventListener("click", addCodeCell);
  document
    .getElementById("add-markdown-cell")
    .addEventListener("click", addMarkdownCell);
  document.getElementById("run-all").addEventListener("click", runAllCells);
  document
    .getElementById("new-notebook-sidebar")
    .addEventListener("click", createNewNotebook);
  document
    .getElementById("delete-notebook")
    .addEventListener("click", deleteActiveNotebook);
  document
    .getElementById("import-file")
    .addEventListener("click", () => {
      document.getElementById("workspace-file-input").click();
    });
  document
    .getElementById("new-folder")
    .addEventListener("click", createWorkspaceFolder);
  document
    .getElementById("export-notebook")
    .addEventListener("click", exportNotebook);
  document
    .getElementById("import-notebook")
    .addEventListener("click", () => {
      document.getElementById("ipynb-file-input").click();
    });
  document
    .getElementById("clear-recovery")
    .addEventListener("click", clearRecovery);
  document
    .getElementById("notebook-title-input")
    .addEventListener("input", (event) => {
      const notebook = activeNotebook();
      if (!notebook) {
        return;
      }
      notebook.title = stripNotebookExtension(event.target.value);
      notebook.updatedAt = new Date().toISOString();
      renderWorkspaceList();
      scheduleAutosave();
    });
  document
    .getElementById("ipynb-file-input")
    .addEventListener("change", importNotebook);
  document
    .getElementById("workspace-file-input")
    .addEventListener("change", importWorkspaceFiles);
}

function createNewNotebook() {
  const notebook = createStarterNotebook();
  notebookState.workspace.notebooks.push(notebook);
  notebookState.workspace.activeNotebookId = notebook.id;
  syncNotebookTitle();
  renderNotebook();
  scheduleAutosave();
}

function switchNotebook(notebookId) {
  if (notebookState.workspace.activeNotebookId === notebookId) {
    return;
  }
  notebookState.workspace.activeNotebookId = notebookId;
  syncNotebookTitle();
  renderNotebook();
  scheduleAutosave();
}

function deleteActiveNotebook() {
  if (notebookState.workspace.notebooks.length <= 1) {
    return;
  }
  const currentId = notebookState.workspace.activeNotebookId;
  notebookState.workspace.notebooks = notebookState.workspace.notebooks.filter(
    (notebook) => notebook.id !== currentId,
  );
  notebookState.workspace.activeNotebookId = notebookState.workspace.notebooks[0].id;
  syncNotebookTitle();
  renderNotebook();
  scheduleAutosave();
}

function exportNotebook() {
  const blob = new Blob([JSON.stringify(buildIpynbDocument(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = notebookFileName();
  anchor.click();
  URL.revokeObjectURL(url);
  updateSaveState("Exported .ipynb");
}

async function importNotebook(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const document = JSON.parse(text);
    applyImportedNotebook(document, file.name);
    renderNotebook();
    scheduleAutosave();
  } catch (error) {
    updateSaveState(`Import failed: ${String(error.message || error)}`);
  }

  event.target.value = "";
}

async function importWorkspaceFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const relativePath = normalizeWorkspacePath(file.webkitRelativePath || file.name);
    const existingIndex = notebookState.workspace.files.findIndex(
      (entry) => (entry.path || entry.name) === relativePath,
    );
    const record = createWorkspaceFile(relativePath, bytes, file.type || "application/octet-stream");
    if (existingIndex >= 0) {
      notebookState.workspace.files.splice(existingIndex, 1, record);
    } else {
      notebookState.workspace.files.push(record);
    }
  }

  if (runtimeAdapter.pyodide) {
    await runtimeAdapter.syncWorkspaceFiles();
  }

  renderNotebook();
  scheduleAutosave();
  event.target.value = "";
}

function exportWorkspaceFile(fileId) {
  const file = notebookState.workspace.files.find((entry) => entry.id === fileId);
  if (!file) {
    return;
  }
  const blob = new Blob([decodeBase64ToUint8Array(file.base64)], {
    type: file.type || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.path || file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function deleteWorkspaceFile(fileId) {
  const file = notebookState.workspace.files.find((entry) => entry.id === fileId);
  if (!file) {
    return;
  }
  notebookState.workspace.files = notebookState.workspace.files.filter((entry) => entry.id !== fileId);
  if (runtimeAdapter.pyodide) {
    try {
      runtimeAdapter.pyodide.FS.unlink(`/workspace/${file.path || file.name}`);
    } catch (_error) {
    }
  }
  renderNotebook();
  scheduleAutosave();
}

function createWorkspaceFolder() {
  const folderName = window.prompt("Folder path inside workspace:");
  const normalizedPath = normalizeWorkspacePath(folderName || "");
  if (!normalizedPath) {
    return;
  }

  const placeholderPath = `${normalizedPath}/.gitkeep`;
  const existingIndex = notebookState.workspace.files.findIndex(
    (entry) => (entry.path || entry.name) === placeholderPath,
  );
  const record = createWorkspaceFile(placeholderPath, new Uint8Array(), "application/octet-stream");
  if (existingIndex >= 0) {
    notebookState.workspace.files.splice(existingIndex, 1, record);
  } else {
    notebookState.workspace.files.push(record);
  }

  if (runtimeAdapter.pyodide) {
    const absolutePath = `/workspace/${placeholderPath}`;
    ensureParentDirectories(runtimeAdapter.pyodide.FS, absolutePath);
    try {
      runtimeAdapter.pyodide.FS.writeFile(absolutePath, new Uint8Array());
    } catch (_error) {
    }
  }

  renderNotebook();
  scheduleAutosave();
}

function clearRecovery() {
  localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  updateSaveState("Recovery cleared");
}

function bootstrap() {
  renderPackageList();
  loadNotebookFromStorage();
  syncNotebookTitle();
  renderNotebook();
  wireEvents();
  updateKernelState(
    EMBEDDED_PYODIDE.available ? "Embedded runtime ready to initialize" : "Runtime bundle missing",
  );
}

bootstrap();
