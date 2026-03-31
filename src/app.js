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
  focusedCellId: null,
  selectedVariableName: "",
  selectedWorkspaceFileId: null,
  workspaceFileDraft: "",
  terminalEntries: [],
  watches: [],
  execution: {
    busy: false,
    currentCellId: null,
    runAll: false,
    interruptRequested: false,
  },
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
      syncExecutionUi();
      renderTerminalOutput();
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
    await refreshVariableViewer();
    updateKernelState(
      `Runtime ready (Pyodide ${EMBEDDED_PYODIDE.version}, ${EMBEDDED_PYODIDE.bundledPackages?.length || 0} bundled packages)`,
    );
    syncExecutionUi();
    renderTerminalOutput();
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
      outputs.push(createStreamOutput(stdout.join("\n"), "stdout"));
    }
    outputs.push(...normalizeDisplayOutputs(globalThis.__pyWholeDisplayOutputs || []));
    if (stderr.length) {
      outputs.push(createStreamOutput(stderr.join("\n"), "stderr"));
    }

    return outputs.length ? outputs : [createStreamOutput("Execution completed with no textual output.", "stdout")];
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

    if hasattr(value, "_repr_svg_"):
        svg = value._repr_svg_()
        if svg:
            push_output({"kind": "svg", "svg": str(svg)})
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

    if isinstance(value, (dict, list, tuple)):
        try:
            import json
            push_output({"kind": "json", "data": json.dumps(value, indent=2, default=str)})
            return
        except Exception:
            pass

    if hasattr(value, "_repr_markdown_"):
        markdown = value._repr_markdown_()
        if markdown:
            push_output({"kind": "markdown", "markdown": str(markdown)})
            return

    if hasattr(value, "_repr_latex_"):
        latex = value._repr_latex_()
        if latex:
            push_output({"kind": "latex", "latex": str(latex)})
            return

    push_output({"kind": "stream", "name": "stdout", "text": str(value)})

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

def _pywhole_list_variables():
    namespace = __main__.__dict__
    variables = []
    for name in sorted(namespace):
        if name.startswith("_"):
            continue
        value = namespace[name]
        try:
            value_type = type(value).__name__
        except Exception:
            value_type = "unknown"
        try:
            value_repr = repr(value)
        except Exception:
            value_repr = "<unrepresentable>"
        if len(value_repr) > 120:
            value_repr = value_repr[:117] + "..."
        variables.append({
            "name": name,
            "type": value_type,
            "value": value_repr,
        })
    return variables

def _pywhole_inspect_variable(name):
    namespace = __main__.__dict__
    if name not in namespace:
        return {
            "ok": False,
            "name": name,
            "type": "NameError",
            "summary": f"{name!r} is not defined",
            "detail_kind": "text",
            "detail": "",
        }

    value = namespace[name]
    try:
        value_type = type(value).__name__
    except Exception:
        value_type = "unknown"

    try:
        summary = repr(value)
    except Exception:
        summary = "<unrepresentable>"
    if len(summary) > 160:
        summary = summary[:157] + "..."

    detail_kind = "text"
    detail = ""

    if hasattr(value, "_repr_html_"):
        try:
            html = value._repr_html_()
            if html:
                detail_kind = "html"
                detail = str(html)
        except Exception:
            detail_kind = "text"

    if not detail:
        try:
            if "numpy" in globals():
                import numpy as np
                if isinstance(value, np.ndarray):
                    detail = f"shape={value.shape}\\ndtype={value.dtype}\\n\\n{np.array2string(value, threshold=40)}"
            if not detail and "pandas" in globals():
                import pandas as pd
                if isinstance(value, pd.DataFrame):
                    detail = value.to_string(max_rows=20, max_cols=12)
                elif isinstance(value, pd.Series):
                    detail = value.to_string(max_rows=30)
            if not detail:
                detail = repr(value)
        except Exception:
            detail = summary

    if len(detail) > 4000:
        detail = detail[:3997] + "..."

    return {
        "ok": True,
        "name": name,
        "type": value_type,
        "summary": summary,
        "detail_kind": detail_kind,
        "detail": detail,
    }

def _pywhole_evaluate_watch(expression):
    namespace = __main__.__dict__
    try:
        value = eval(expression, namespace, namespace)
        value_type = type(value).__name__
        value_repr = repr(value)
        if len(value_repr) > 160:
            value_repr = value_repr[:157] + "..."
        return {
            "ok": True,
            "type": value_type,
            "value": value_repr,
        }
    except Exception as exc:
        return {
            "ok": False,
            "type": type(exc).__name__,
            "value": str(exc),
        }
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

  async listVariables() {
    if (!this.pyodide) {
      return [];
    }

    const listingFn = this.pyodide.globals.get("_pywhole_list_variables");
    const proxy = listingFn();
    try {
      return proxy.toJs ? proxy.toJs() : Array.from(proxy);
    } finally {
      if (proxy && typeof proxy.destroy === "function") {
        proxy.destroy();
      }
      if (listingFn && typeof listingFn.destroy === "function") {
        listingFn.destroy();
      }
    }
  },

  async inspectVariable(name) {
    if (!this.pyodide) {
      return {
        ok: false,
        name,
        type: "RuntimeError",
        summary: "Runtime is not initialized.",
        detail_kind: "text",
        detail: "",
      };
    }

    const inspectFn = this.pyodide.globals.get("_pywhole_inspect_variable");
    const proxy = inspectFn(name);
    try {
      return proxy.toJs ? proxy.toJs() : proxy;
    } finally {
      if (proxy && typeof proxy.destroy === "function") {
        proxy.destroy();
      }
      if (inspectFn && typeof inspectFn.destroy === "function") {
        inspectFn.destroy();
      }
    }
  },

  async evaluateWatch(expression) {
    if (!this.pyodide) {
      return {
        ok: false,
        type: "RuntimeError",
        value: "Runtime is not initialized.",
      };
    }

    const watchFn = this.pyodide.globals.get("_pywhole_evaluate_watch");
    const proxy = watchFn(expression);
    try {
      return proxy.toJs ? proxy.toJs() : proxy;
    } finally {
      if (proxy && typeof proxy.destroy === "function") {
        proxy.destroy();
      }
      if (watchFn && typeof watchFn.destroy === "function") {
        watchFn.destroy();
      }
    }
  },
};

function normalizeDisplayOutputs(items) {
  return (items || [])
    .map((item) => {
      if (item.kind === "html") {
        return createHtmlOutput(item.html || "");
      }
      if (item.kind === "markdown") {
        return createMarkdownOutput(item.markdown || "");
      }
      if (item.kind === "latex") {
        return createLatexOutput(item.latex || "");
      }
      if (item.kind === "svg") {
        return createSvgOutput(item.svg || "");
      }
      if (item.kind === "image") {
        return createImageOutput(item.mime || "image/png", item.data || "");
      }
      if (item.kind === "json") {
        return createJsonOutput(item.data || "");
      }
      if (item.kind === "stream") {
        return createStreamOutput(item.text || "", item.name || "stdout");
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

function decodeBase64ToText(base64) {
  return new TextDecoder().decode(decodeBase64ToUint8Array(base64));
}

function encodeTextToBase64(text) {
  return encodeUint8ArrayToBase64(new TextEncoder().encode(String(text || "")));
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

function isLikelyTextFile(file) {
  const type = String(file?.type || "");
  const path = String(file?.path || file?.name || "").toLowerCase();
  return (
    type.startsWith("text/") ||
    [
      ".txt",
      ".csv",
      ".tsv",
      ".json",
      ".md",
      ".py",
      ".js",
      ".mjs",
      ".css",
      ".html",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".cfg",
      ".ipynb",
    ].some((extension) => path.endsWith(extension))
  );
}

function isPreviewableImage(file) {
  const type = String(file?.type || "");
  const path = String(file?.path || file?.name || "").toLowerCase();
  return type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].some((ext) => path.endsWith(ext));
}

function isPreviewableAudio(file) {
  const type = String(file?.type || "");
  const path = String(file?.path || file?.name || "").toLowerCase();
  return type.startsWith("audio/") || [".mp3", ".wav", ".ogg", ".m4a"].some((ext) => path.endsWith(ext));
}

function isPreviewableVideo(file) {
  const type = String(file?.type || "");
  const path = String(file?.path || file?.name || "").toLowerCase();
  return type.startsWith("video/") || [".mp4", ".webm", ".ogv", ".mov"].some((ext) => path.endsWith(ext));
}

function dataUrlForWorkspaceFile(file) {
  const mime = file.type || "application/octet-stream";
  return `data:${mime};base64,${file.base64}`;
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

function executionStatusText() {
  const { busy, currentCellId, runAll } = notebookState.execution;
  if (!busy) {
    return "Idle";
  }
  if (currentCellId === "terminal") {
    return "Running terminal command";
  }
  if (runAll) {
    return currentCellId ? `Running all cells (active cell ${currentCellId})` : "Running all cells";
  }
  return currentCellId ? `Running cell ${currentCellId}` : "Running";
}

function interruptStatusText() {
  if (!notebookState.execution.busy) {
    return "Not requested";
  }
  return notebookState.execution.interruptRequested
    ? "Requested; stops after current cell"
    : "Available between cell boundaries";
}

function syncExecutionUi() {
  const { busy, currentCellId, interruptRequested } = notebookState.execution;
  const executionText = executionStatusText();
  const canInterrupt = busy && !interruptRequested;

  document.getElementById("execution-state").textContent = executionText;
  document.getElementById("interrupt-state").textContent = interruptStatusText();
  document.getElementById("run-state").textContent = executionText;

  document.querySelector(".app-shell")?.classList.toggle("is-busy", busy);

  const interruptButtons = [
    document.getElementById("interrupt-runtime"),
    document.getElementById("interrupt-run"),
  ];

  for (const button of interruptButtons) {
    if (button) {
      button.disabled = !canInterrupt;
    }
  }

  for (const control of [
    document.getElementById("run-all"),
    document.getElementById("add-code-cell"),
    document.getElementById("add-markdown-cell"),
    document.getElementById("new-notebook-sidebar"),
    document.getElementById("delete-notebook"),
    document.getElementById("import-notebook"),
    document.getElementById("export-notebook"),
    document.getElementById("import-file"),
    document.getElementById("new-folder"),
    document.getElementById("clear-recovery"),
    document.getElementById("add-watch"),
    document.getElementById("notebook-title-input"),
    document.getElementById("run-terminal-command"),
    document.getElementById("terminal-input"),
  ]) {
    if (control) {
      control.disabled = busy;
    }
  }

  const initButton = document.getElementById("initialize-runtime");
  if (initButton) {
    initButton.disabled = busy || notebookState.runtimeReady;
  }

  document.querySelectorAll(".workspace-item").forEach((item) => {
    item.classList.toggle("is-busy", busy);
  });
  document.querySelectorAll(".cell").forEach((cellNode) => {
    const cellId = Number(cellNode.dataset.cellId);
    cellNode.classList.toggle("is-running", busy && currentCellId === cellId);
    cellNode.classList.toggle(
      "is-interrupt-pending",
      busy && currentCellId === cellId && interruptRequested,
    );
  });
  renderWorkspaceFileEditor();
}

function beginExecution(cellId, options = {}) {
  notebookState.execution.busy = true;
  notebookState.execution.currentCellId = cellId;
  notebookState.execution.runAll = Boolean(options.runAll);
  notebookState.execution.interruptRequested = false;
  syncExecutionUi();
}

function endExecution() {
  notebookState.execution.busy = false;
  notebookState.execution.currentCellId = null;
  notebookState.execution.runAll = false;
  notebookState.execution.interruptRequested = false;
  syncExecutionUi();
}

function requestInterrupt() {
  if (!notebookState.execution.busy || notebookState.execution.interruptRequested) {
    return;
  }
  notebookState.execution.interruptRequested = true;
  updateKernelState("Interrupt requested. Current cell will finish before execution stops.");
  syncExecutionUi();
}

function canRunCell(cellId) {
  if (!notebookState.execution.busy) {
    return true;
  }
  return notebookState.execution.currentCellId === cellId;
}

function focusCellEditor(cellId) {
  const editor = document.querySelector(`.cell[data-cell-id="${cellId}"] .cell-editor`);
  if (editor) {
    editor.focus();
  }
}

function quotedWorkspacePath(file) {
  return JSON.stringify(`/workspace/${file.path || file.name}`);
}

function workspaceLoadSnippet(file) {
  const fullPath = `/workspace/${file.path || file.name}`;
  const quotedPath = JSON.stringify(fullPath);
  const lowerPath = String(file.path || file.name).toLowerCase();

  if (lowerPath.endsWith(".csv")) {
    return `import pandas as pd\n\ndf = pd.read_csv(${quotedPath})\ndf.head()`;
  }
  if (lowerPath.endsWith(".tsv")) {
    return `import pandas as pd\n\ndf = pd.read_csv(${quotedPath}, sep="\\t")\ndf.head()`;
  }
  if (lowerPath.endsWith(".json")) {
    return `import json\n\nwith open(${quotedPath}, "r", encoding="utf-8") as handle:\n    data = json.load(handle)\n\ndata`;
  }
  if (lowerPath.endsWith(".npy")) {
    return `import numpy as np\n\narray = np.load(${quotedPath})\narray`;
  }
  if (lowerPath.endsWith(".npz")) {
    return `import numpy as np\n\narchive = np.load(${quotedPath})\narchive.files`;
  }
  if (lowerPath.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/)) {
    return `import cv2\n\nimage = cv2.imread(${quotedPath}, cv2.IMREAD_UNCHANGED)\nimage.shape`;
  }
  if (lowerPath.endsWith(".py")) {
    return `with open(${quotedPath}, "r", encoding="utf-8") as handle:\n    source = handle.read()\n\nprint(source)`;
  }
  return `path = ${quotedPath}\npath`;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    updateSaveState("Copied path to clipboard");
  } catch (_error) {
    updateSaveState("Clipboard copy failed");
  }
}

function insertTextIntoActiveEditor(text) {
  const notebook = activeNotebook();
  const activeCell = notebook?.cells.find((cell) => cell.id === notebookState.focusedCellId);
  if (activeCell && activeCell.cellType === "code") {
    activeCell.source = activeCell.source
      ? `${activeCell.source}${activeCell.source.endsWith("\n") ? "" : "\n"}${text}`
      : text;
    renderNotebook();
    focusCellEditor(activeCell.id);
    scheduleAutosave();
    return true;
  }

  const terminalInput = document.getElementById("terminal-input");
  if (terminalInput && !terminalInput.disabled) {
    terminalInput.value = terminalInput.value
      ? `${terminalInput.value}${terminalInput.value.endsWith("\n") ? "" : "\n"}${text}`
      : text;
    terminalInput.focus();
    return true;
  }

  return false;
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

function createStreamOutput(text, name = "stdout") {
  return {
    kind: "stream",
    name,
    text,
  };
}

function createHtmlOutput(html) {
  return {
    kind: "html",
    html,
  };
}

function createMarkdownOutput(markdown) {
  return {
    kind: "markdown",
    markdown,
  };
}

function createLatexOutput(latex) {
  return {
    kind: "latex",
    latex,
  };
}

function createSvgOutput(svg) {
  return {
    kind: "svg",
    svg,
  };
}

function createImageOutput(mime, data) {
  return {
    kind: "image",
    mime,
    data,
  };
}

function createJsonOutput(data) {
  return {
    kind: "json",
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
          name: output.name || "stdout",
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
      if (output.kind === "markdown") {
        return {
          output_type: "display_data",
          data: {
            "text/markdown": output.markdown,
            "text/plain": output.markdown,
          },
          metadata: {},
        };
      }
      if (output.kind === "latex") {
        return {
          output_type: "display_data",
          data: {
            "text/latex": output.latex,
            "text/plain": output.latex,
          },
          metadata: {},
        };
      }
      if (output.kind === "svg") {
        return {
          output_type: "display_data",
          data: {
            "image/svg+xml": output.svg,
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
      if (output.kind === "json") {
        return {
          output_type: "display_data",
          data: {
            "application/json": output.data,
            "text/plain": output.data,
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
        return createStreamOutput(joinNotebookSource(output.text), output.name || "stdout");
      }
      if (output.output_type === "execute_result" || output.output_type === "display_data") {
        const html = output.data && output.data["text/html"];
        if (html) {
          return createHtmlOutput(joinNotebookSource(html));
        }
        const markdown = output.data && output.data["text/markdown"];
        if (markdown) {
          return createMarkdownOutput(joinNotebookSource(markdown));
        }
        const latex = output.data && output.data["text/latex"];
        if (latex) {
          return createLatexOutput(joinNotebookSource(latex));
        }
        const svg = output.data && output.data["image/svg+xml"];
        if (svg) {
          return createSvgOutput(joinNotebookSource(svg));
        }
        const png = output.data && output.data["image/png"];
        if (png) {
          return createImageOutput("image/png", joinNotebookSource(png));
        }
        const json = output.data && output.data["application/json"];
        if (json) {
          return createJsonOutput(joinNotebookSource(json));
        }
        const plain = output.data && output.data["text/plain"];
        return plain ? createStreamOutput(joinNotebookSource(plain)) : null;
      }
      if (output.output_type === "error") {
        const traceback = output.traceback || [];
        return createStreamOutput(traceback.join("\n"), "stderr");
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
    watches: notebookState.watches,
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
  notebookState.watches = Array.isArray(state.watches) ? state.watches : [];
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

      button.disabled = notebookState.execution.busy;
      button.append(title, meta);
      return button;
    }),
  );
}

function renderWorkspaceFiles() {
  const list = document.getElementById("workspace-files");
  const files = notebookState.workspace.files || [];
  if (!files.length) {
    notebookState.selectedWorkspaceFileId = null;
    notebookState.workspaceFileDraft = "";
    const empty = document.createElement("div");
    empty.className = "workspace-file-item";
    empty.textContent = "No imported files yet.";
    list.replaceChildren(empty);
    renderWorkspaceFileEditor();
    return;
  }

  if (
    notebookState.selectedWorkspaceFileId &&
    !files.some((file) => file.id === notebookState.selectedWorkspaceFileId)
  ) {
    notebookState.selectedWorkspaceFileId = null;
    notebookState.workspaceFileDraft = "";
  }

  const tree = buildWorkspaceTree(files);
  list.replaceChildren(...renderWorkspaceTreeNodes(tree));
  renderWorkspaceFileEditor();
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
    item.classList.toggle("is-selected", file.id === notebookState.selectedWorkspaceFileId);
    if (
      isLikelyTextFile(file) ||
      isPreviewableImage(file) ||
      isPreviewableAudio(file) ||
      isPreviewableVideo(file)
    ) {
      item.addEventListener("click", () => selectWorkspaceFile(file.id));
    }

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
    exportButton.addEventListener("click", (event) => {
      event.stopPropagation();
      exportWorkspaceFile(file.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteWorkspaceFile(file.id);
    });

    const copyPathButton = document.createElement("button");
    copyPathButton.type = "button";
    copyPathButton.className = "secondary";
    copyPathButton.textContent = "Copy Path";
    copyPathButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void copyTextToClipboard(quotedWorkspacePath(file));
    });

    const insertPathButton = document.createElement("button");
    insertPathButton.type = "button";
    insertPathButton.className = "secondary";
    insertPathButton.textContent = "Insert Path";
    insertPathButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const inserted = insertTextIntoActiveEditor(quotedWorkspacePath(file));
      updateSaveState(inserted ? "Inserted workspace path" : "No active editor for path insertion");
    });

    const loadSnippetButton = document.createElement("button");
    loadSnippetButton.type = "button";
    loadSnippetButton.className = "secondary";
    loadSnippetButton.textContent = "Load Snippet";
    loadSnippetButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const inserted = insertTextIntoActiveEditor(workspaceLoadSnippet(file));
      updateSaveState(inserted ? "Inserted load snippet" : "No active editor for snippet insertion");
    });

    if (
      isLikelyTextFile(file) ||
      isPreviewableImage(file) ||
      isPreviewableAudio(file) ||
      isPreviewableVideo(file)
    ) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary";
      editButton.textContent = isLikelyTextFile(file) ? "Open" : "Preview";
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        selectWorkspaceFile(file.id);
      });
      actions.append(editButton);
    }

    actions.append(copyPathButton, insertPathButton, loadSnippetButton, exportButton, deleteButton);
    item.append(title, meta, actions);
    return item;
  });
}

function selectedWorkspaceFile() {
  return notebookState.workspace.files.find((file) => file.id === notebookState.selectedWorkspaceFileId);
}

function renderWorkspaceFileEditor() {
  const meta = document.getElementById("workspace-file-editor-meta");
  const preview = document.getElementById("workspace-file-preview");
  const editor = document.getElementById("workspace-file-editor");
  const saveButton = document.getElementById("save-workspace-file");
  const revertButton = document.getElementById("revert-workspace-file");
  const file = selectedWorkspaceFile();

  if (!file) {
    meta.textContent = "Select a text file to edit it.";
    preview.replaceChildren();
    editor.value = "";
    editor.disabled = true;
    saveButton.disabled = true;
    revertButton.disabled = true;
    return;
  }

  meta.textContent = `${file.path || file.name} • ${formatBytes(file.size)}`;
  preview.replaceChildren(...buildWorkspaceFilePreviewNodes(file));

  if (isLikelyTextFile(file)) {
    editor.value = notebookState.workspaceFileDraft;
    editor.disabled = notebookState.execution.busy;
    saveButton.disabled = notebookState.execution.busy;
    revertButton.disabled = notebookState.execution.busy;
    return;
  }

  editor.value = "";
  editor.disabled = true;
  saveButton.disabled = true;
  revertButton.disabled = true;
}

function selectWorkspaceFile(fileId) {
  const file = notebookState.workspace.files.find((entry) => entry.id === fileId);
  if (!file) {
    return;
  }
  notebookState.selectedWorkspaceFileId = file.id;
  notebookState.workspaceFileDraft = isLikelyTextFile(file) ? decodeBase64ToText(file.base64) : "";
  renderWorkspaceFiles();
}

function buildWorkspaceFilePreviewNodes(file) {
  const nodes = [];

  const metaCard = document.createElement("div");
  metaCard.className = "workspace-file-preview-card";
  const metaPre = document.createElement("pre");
  metaPre.textContent = [
    `Path: ${file.path || file.name}`,
    `Type: ${file.type || "application/octet-stream"}`,
    `Size: ${formatBytes(file.size)}`,
    `Updated: ${new Date(file.updatedAt).toLocaleString()}`,
  ].join("\n");
  metaCard.append(metaPre);
  nodes.push(metaCard);

  if (isPreviewableImage(file)) {
    const card = document.createElement("div");
    card.className = "workspace-file-preview-card";
    const image = document.createElement("img");
    image.src = dataUrlForWorkspaceFile(file);
    image.alt = file.name;
    card.append(image);
    nodes.push(card);
    return nodes;
  }

  if (isPreviewableAudio(file)) {
    const card = document.createElement("div");
    card.className = "workspace-file-preview-card";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = dataUrlForWorkspaceFile(file);
    card.append(audio);
    nodes.push(card);
    return nodes;
  }

  if (isPreviewableVideo(file)) {
    const card = document.createElement("div");
    card.className = "workspace-file-preview-card";
    const video = document.createElement("video");
    video.controls = true;
    video.src = dataUrlForWorkspaceFile(file);
    card.append(video);
    nodes.push(card);
    return nodes;
  }

  return nodes;
}

function renderVariableViewer(variables) {
  const container = document.getElementById("variable-viewer");
  if (!variables.length) {
    notebookState.selectedVariableName = "";
    const empty = document.createElement("div");
    empty.className = "variable-item";
    empty.textContent = notebookState.runtimeReady
      ? "No user variables yet."
      : "Initialize runtime to inspect variables.";
    container.replaceChildren(empty);
    renderVariableDetail(null);
    return;
  }

  if (
    notebookState.selectedVariableName &&
    !variables.some((variable) => variable.name === notebookState.selectedVariableName)
  ) {
    notebookState.selectedVariableName = "";
  }

  container.replaceChildren(
    ...variables.map((variable) => {
      const item = document.createElement("div");
      item.className = "variable-item";
      item.classList.toggle("is-selected", variable.name === notebookState.selectedVariableName);

      const name = document.createElement("span");
      name.className = "variable-name";
      name.textContent = variable.name;

      const type = document.createElement("span");
      type.className = "variable-type";
      type.textContent = variable.type;

      const value = document.createElement("span");
      value.className = "variable-value";
      value.textContent = variable.value;

      item.addEventListener("click", () => {
        notebookState.selectedVariableName = variable.name;
        renderVariableViewer(variables);
        void refreshVariableDetail();
      });

      item.append(name, type, value);
      return item;
    }),
  );
}

function renderVariableDetail(detail) {
  const container = document.getElementById("variable-detail-viewer");
  if (!detail) {
    const empty = document.createElement("div");
    empty.className = "variable-detail-card";
    empty.textContent = notebookState.runtimeReady
      ? "Select a variable to inspect it."
      : "Initialize runtime to inspect variable details.";
    container.replaceChildren(empty);
    return;
  }

  const cards = [];
  for (const [label, value] of [
    ["Name", detail.name || ""],
    ["Type", detail.type || ""],
    ["Summary", detail.summary || ""],
  ]) {
    const card = document.createElement("div");
    card.className = "variable-detail-card";

    const title = document.createElement("span");
    title.className = "variable-detail-label";
    title.textContent = label;

    const content = document.createElement("span");
    content.className = "variable-detail-value";
    content.textContent = value;

    card.append(title, content);
    cards.push(card);
  }

  const detailCard = document.createElement("div");
  detailCard.className = "variable-detail-card";
  const detailLabel = document.createElement("span");
  detailLabel.className = "variable-detail-label";
  detailLabel.textContent = "Detail";

  let detailBody;
  if (detail.detail_kind === "html") {
    detailBody = document.createElement("div");
    detailBody.className = "cell-output-html";
    detailBody.innerHTML = detail.detail || "";
  } else {
    detailBody = document.createElement("span");
    detailBody.className = "variable-detail-value";
    detailBody.textContent = detail.detail || "";
  }
  detailCard.append(detailLabel, detailBody);
  cards.push(detailCard);

  container.replaceChildren(...cards);
}

function renderWatchViewer(results) {
  const container = document.getElementById("watch-viewer");
  if (!notebookState.watches.length) {
    const empty = document.createElement("div");
    empty.className = "watch-item";
    empty.textContent = "No watch expressions yet.";
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(
    ...notebookState.watches.map((watch, index) => {
      const item = document.createElement("div");
      item.className = "watch-item";

      const input = document.createElement("input");
      input.className = "watch-input";
      input.type = "text";
      input.value = watch.expression;
      input.placeholder = "expression";
      input.addEventListener("input", (event) => {
        notebookState.watches[index].expression = event.target.value;
        scheduleAutosave();
      });

      const result = document.createElement("span");
      result.className = "watch-result";
      const current = results[index];
      if (!watch.expression.trim()) {
        result.textContent = "Enter an expression to evaluate.";
      } else if (!notebookState.runtimeReady) {
        result.textContent = "Initialize runtime to evaluate watches.";
      } else if (!current) {
        result.textContent = "No result.";
      } else {
        result.textContent = `${current.type}: ${current.value}`;
      }

      const actions = document.createElement("div");
      actions.className = "watch-actions";

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.className = "secondary";
      refreshButton.textContent = "Refresh";
      refreshButton.addEventListener("click", () => refreshWatchViewer());

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        notebookState.watches.splice(index, 1);
        renderWatchViewer([]);
        scheduleAutosave();
      });

      actions.append(refreshButton, deleteButton);
      item.append(input, result, actions);
      return item;
    }),
  );
}

async function refreshVariableViewer() {
  if (!runtimeAdapter.pyodide || !notebookState.runtimeReady) {
    renderVariableViewer([]);
    return;
  }

  try {
    const variables = await runtimeAdapter.listVariables();
    renderVariableViewer(variables);
    await refreshVariableDetail();
  } catch (_error) {
    renderVariableViewer([]);
  }
}

async function refreshVariableDetail() {
  if (
    !runtimeAdapter.pyodide ||
    !notebookState.runtimeReady ||
    !notebookState.selectedVariableName
  ) {
    renderVariableDetail(null);
    return;
  }

  try {
    const detail = await runtimeAdapter.inspectVariable(notebookState.selectedVariableName);
    renderVariableDetail(detail);
  } catch (_error) {
    renderVariableDetail(null);
  }
}

async function refreshWatchViewer() {
  if (!notebookState.watches.length) {
    renderWatchViewer([]);
    return;
  }

  if (!runtimeAdapter.pyodide || !notebookState.runtimeReady) {
    renderWatchViewer([]);
    return;
  }

  const results = [];
  for (const watch of notebookState.watches) {
    if (!watch.expression.trim()) {
      results.push(null);
      continue;
    }
    try {
      results.push(await runtimeAdapter.evaluateWatch(watch.expression));
    } catch (error) {
      results.push({
        ok: false,
        type: "Error",
        value: String(error.message || error),
      });
    }
  }
  renderWatchViewer(results);
}

function flattenOutputsToText(outputs) {
  return (outputs || [])
    .map((output) => {
      if (output.kind === "stream") {
        return output.text || "";
      }
      if (output.kind === "json") {
        return output.data || "";
      }
      if (output.kind === "markdown") {
        return output.markdown || "";
      }
      if (output.kind === "latex") {
        return output.latex || "";
      }
      if (output.kind === "html") {
        return "[html output]";
      }
      if (output.kind === "svg") {
        return "[svg output]";
      }
      if (output.kind === "image") {
        return `[${output.mime || "image"} output]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function renderTerminalOutput() {
  const container = document.getElementById("terminal-output");
  if (!container) {
    return;
  }

  if (!notebookState.terminalEntries.length) {
    const empty = document.createElement("div");
    empty.className = "terminal-entry";
    empty.textContent = notebookState.runtimeReady
      ? "Run Python snippets here."
      : "Initialize runtime to use the terminal.";
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(
    ...notebookState.terminalEntries.map((entry) => {
      const item = document.createElement("div");
      item.className = "terminal-entry";

      const label = document.createElement("span");
      label.className = "terminal-entry-label";
      label.textContent = entry.label;

      const body = document.createElement("pre");
      body.className = "terminal-entry-body";
      body.textContent = entry.text;

      item.append(label, body);
      return item;
    }),
  );
  container.scrollTop = container.scrollHeight;
}

async function runTerminalCommand() {
  const input = document.getElementById("terminal-input");
  const source = String(input?.value || "").trim();
  if (!source) {
    return;
  }
  if (notebookState.execution.busy) {
    return;
  }

  notebookState.terminalEntries.push({
    label: "In",
    text: source,
  });
  renderTerminalOutput();
  beginExecution("terminal");
  updateKernelState("Running terminal command");

  try {
    const outputs = await runtimeAdapter.execute(source);
    notebookState.terminalEntries.push({
      label: "Out",
      text: flattenOutputsToText(outputs) || "Execution completed with no terminal output.",
    });
    updateKernelState("Runtime ready");
    await refreshVariableViewer();
    await refreshWatchViewer();
  } catch (error) {
    notebookState.terminalEntries.push({
      label: "Error",
      text: String(error.message || error),
    });
    updateKernelState(`Execution error: ${String(error.message || error)}`);
  }

  input.value = "";
  endExecution();
  renderNotebook();
  renderTerminalOutput();
}

function clearTerminalOutput() {
  notebookState.terminalEntries = [];
  renderTerminalOutput();
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
      if (output.kind === "markdown") {
        const markdown = document.createElement("div");
        markdown.className = "cell-output-markdown";
        markdown.innerHTML = markdownToHtml(output.markdown || "");
        return markdown;
      }
      if (output.kind === "latex") {
        const latex = document.createElement("pre");
        latex.className = "cell-output-latex";
        latex.textContent = output.latex || "";
        return latex;
      }
      if (output.kind === "svg") {
        const svg = document.createElement("div");
        svg.className = "cell-output-svg";
        svg.innerHTML = output.svg || "";
        return svg;
      }
      if (output.kind === "image") {
        const wrapper = document.createElement("div");
        wrapper.className = "cell-output-image";
        const image = document.createElement("img");
        image.src = `data:${output.mime};base64,${output.data}`;
        wrapper.append(image);
        return wrapper;
      }
      if (output.kind === "json") {
        const pre = document.createElement("pre");
        pre.className = "cell-output-text";
        pre.textContent = output.data || "";
        return pre;
      }
      const pre = document.createElement("pre");
      pre.className = `cell-output-text ${output.name === "stderr" ? "is-stderr" : ""}`.trim();
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
      article.classList.toggle(
        "is-running",
        notebookState.execution.busy && notebookState.execution.currentCellId === cell.id,
      );
      article.classList.toggle(
        "is-interrupt-pending",
        notebookState.execution.busy &&
          notebookState.execution.currentCellId === cell.id &&
          notebookState.execution.interruptRequested,
      );
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
      runButton.disabled = cell.cellType !== "code" || !canRunCell(cell.id);
      toggleKindButton.disabled = notebookState.execution.busy;
      deleteButton.disabled = notebookState.execution.busy;
      moveUpButton.disabled = moveUpButton.disabled || notebookState.execution.busy;
      moveDownButton.disabled = moveDownButton.disabled || notebookState.execution.busy;
      editor.disabled = notebookState.execution.busy;
      moveUpButton.addEventListener("click", () => moveCell(cell.id, -1));
      moveDownButton.addEventListener("click", () => moveCell(cell.id, 1));
      editor.addEventListener("focus", () => {
        notebookState.focusedCellId = cell.id;
      });
      editor.addEventListener("keydown", (event) => {
        if (cell.cellType !== "code") {
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) {
            void runCellAndAdvance(cell.id);
          } else {
            void runCell(cell.id);
          }
        }
      });
      editor.addEventListener("input", (event) => {
        cell.source = event.target.value;
        scheduleAutosave();
      });

      return fragment;
    }),
  );
  syncExecutionUi();
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
  if (notebookState.execution.busy && notebookState.execution.currentCellId !== cellId) {
    updateKernelState("A cell is already running.");
    return;
  }

  beginExecution(cell.id, { runAll: false });
  updateKernelState(`Running cell ${cell.id}`);
  cell.status = "Running";
  cell.outputs = [createStreamOutput("Executing...")];
  renderNotebook();

  try {
    const outputs = await runtimeAdapter.execute(cell.source);
    cell.outputs = outputs;
    cell.executionCount = (cell.executionCount || 0) + 1;
    cell.status = "Complete";
    updateKernelState("Runtime ready");
  } catch (error) {
    cell.outputs = [createStreamOutput(String(error.message || error))];
    cell.status = "Error";
    updateKernelState(`Execution error: ${String(error.message || error)}`);
  }

  notebook.updatedAt = new Date().toISOString();
  renderNotebook();
  await refreshVariableViewer();
  await refreshWatchViewer();
  endExecution();
  scheduleAutosave();
}

async function runCellAndAdvance(cellId) {
  const notebook = activeNotebook();
  const index = notebook ? notebook.cells.findIndex((cell) => cell.id === cellId) : -1;
  await runCell(cellId);
  if (!notebook || index < 0) {
    return;
  }

  const nextCodeCell = notebook.cells.slice(index + 1).find((cell) => cell.cellType === "code");
  if (nextCodeCell) {
    notebookState.focusedCellId = nextCodeCell.id;
    focusCellEditor(nextCodeCell.id);
  }
}

async function runAllCells() {
  const notebook = activeNotebook();
  if (!notebook || notebookState.execution.busy) {
    return;
  }
  for (const cell of notebook.cells) {
    if (cell.cellType !== "code") {
      continue;
    }

    beginExecution(cell.id, { runAll: true });
    updateKernelState(`Running all cells (active cell ${cell.id})`);
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
      updateKernelState(`Execution error: ${String(error.message || error)}`);
    }

    notebook.updatedAt = new Date().toISOString();
    renderNotebook();
    await refreshVariableViewer();
    await refreshWatchViewer();

    if (notebookState.execution.interruptRequested) {
      endExecution();
      updateKernelState("Run all interrupted after the current cell completed.");
      renderNotebook();
      scheduleAutosave();
      return;
    }
  }

  endExecution();
  updateKernelState("Runtime ready");
  renderNotebook();
  scheduleAutosave();
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
    .getElementById("interrupt-runtime")
    .addEventListener("click", requestInterrupt);
  document
    .getElementById("interrupt-run")
    .addEventListener("click", requestInterrupt);
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
    .getElementById("add-watch")
    .addEventListener("click", () => {
      notebookState.watches.push({ expression: "" });
      renderWatchViewer([]);
      scheduleAutosave();
    });
  document
    .getElementById("run-terminal-command")
    .addEventListener("click", runTerminalCommand);
  document
    .getElementById("clear-terminal-output")
    .addEventListener("click", clearTerminalOutput);
  document
    .getElementById("terminal-input")
    .addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runTerminalCommand();
      }
    });
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
  document
    .getElementById("workspace-file-editor")
    .addEventListener("input", (event) => {
      notebookState.workspaceFileDraft = event.target.value;
    });
  document
    .getElementById("save-workspace-file")
    .addEventListener("click", () => {
      void saveSelectedWorkspaceFile();
    });
  document
    .getElementById("revert-workspace-file")
    .addEventListener("click", revertSelectedWorkspaceFile);
}

function createNewNotebook() {
  const notebook = createStarterNotebook();
  notebookState.workspace.notebooks.push(notebook);
  notebookState.workspace.activeNotebookId = notebook.id;
  syncNotebookTitle();
  renderNotebook();
  scheduleAutosave();
}

async function saveSelectedWorkspaceFile() {
  const file = selectedWorkspaceFile();
  if (!file || !isLikelyTextFile(file)) {
    return;
  }

  file.base64 = encodeTextToBase64(notebookState.workspaceFileDraft);
  file.size = new TextEncoder().encode(notebookState.workspaceFileDraft).length;
  file.updatedAt = new Date().toISOString();

  if (runtimeAdapter.pyodide) {
    const bytes = decodeBase64ToUint8Array(file.base64);
    const absolutePath = `/workspace/${file.path || file.name}`;
    ensureParentDirectories(runtimeAdapter.pyodide.FS, absolutePath);
    try {
      runtimeAdapter.pyodide.FS.unlink(absolutePath);
    } catch (_error) {
    }
    runtimeAdapter.pyodide.FS.writeFile(absolutePath, bytes);
  }

  renderWorkspaceFiles();
  scheduleAutosave();
}

function revertSelectedWorkspaceFile() {
  const file = selectedWorkspaceFile();
  if (!file || !isLikelyTextFile(file)) {
    return;
  }
  notebookState.workspaceFileDraft = decodeBase64ToText(file.base64);
  renderWorkspaceFileEditor();
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

  let lastImportedOpenableFileId = null;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const relativePath = normalizeWorkspacePath(file.webkitRelativePath || file.name);
    const existingIndex = notebookState.workspace.files.findIndex(
      (entry) => (entry.path || entry.name) === relativePath,
    );
    const record = createWorkspaceFile(relativePath, bytes, file.type || "application/octet-stream");
    if (
      isLikelyTextFile(record) ||
      isPreviewableImage(record) ||
      isPreviewableAudio(record) ||
      isPreviewableVideo(record)
    ) {
      lastImportedOpenableFileId = record.id;
    }
    if (existingIndex >= 0) {
      notebookState.workspace.files.splice(existingIndex, 1, record);
    } else {
      notebookState.workspace.files.push(record);
    }
  }

  if (runtimeAdapter.pyodide) {
    await runtimeAdapter.syncWorkspaceFiles();
  }

  if (lastImportedOpenableFileId) {
    selectWorkspaceFile(lastImportedOpenableFileId);
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
  renderVariableViewer([]);
  renderVariableDetail(null);
  renderWatchViewer([]);
  renderWorkspaceFileEditor();
  renderTerminalOutput();
  wireEvents();
  updateKernelState(
    EMBEDDED_PYODIDE.available ? "Embedded runtime ready to initialize" : "Runtime bundle missing",
  );
  syncExecutionUi();
}

bootstrap();
