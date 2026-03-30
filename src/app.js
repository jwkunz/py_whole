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
  title: "Untitled",
  runtimeReady: false,
  cells: [],
  saveState: "Unsaved",
};

let nextCellId = 1;
let saveTimer = null;
const STORAGE_KEY = "py_whole.notebook.v1";
const EMBEDDED_PYODIDE = globalThis.__PYWHOLE_EMBEDDED_PYODIDE__ || { available: false };
const BUNDLED_PACKAGE_SET = new Set(EMBEDDED_PYODIDE.bundledPackages || []);

const runtimeAdapter = {
  pyodide: null,

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

    let result;
    try {
      result = await this.pyodide.runPythonAsync(source);
    } finally {
      this.pyodide.setStdout({ batched: () => {} });
      this.pyodide.setStderr({ batched: () => {} });
    }

    const parts = [];
    if (stdout.length) {
      parts.push(stdout.join("\n"));
    }
    if (result !== undefined && result !== null) {
      parts.push(stringifyPyodideResult(result));
    }
    if (stderr.length) {
      parts.push(stderr.join("\n"));
    }

    return parts.join("\n").trim() || "Execution completed with no textual output.";
  },
};

function stringifyPyodideResult(result) {
  try {
    return String(result);
  } finally {
    if (result && typeof result.destroy === "function") {
      result.destroy();
    }
  }
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

function updateKernelState(text) {
  document.getElementById("kernel-state").textContent = text;
}

function updateSaveState(text) {
  notebookState.saveState = text;
  document.getElementById("save-state").textContent = text;
}

function createCodeCell(source, output = "") {
  return {
    id: nextCellId++,
    cellType: "code",
    source,
    output,
    executionCount: null,
    status: "Idle",
  };
}

function createMarkdownCell(source) {
  return {
    id: nextCellId++,
    cellType: "markdown",
    source,
    output: "",
    executionCount: null,
    status: "Idle",
  };
}

function createStarterNotebook() {
  notebookState.title = "Untitled";
  notebookState.cells = [
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
}

function scheduleAutosave() {
  updateSaveState("Pending autosave");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNotebookToStorage, 250);
}

function syncNotebookTitle() {
  document.getElementById("notebook-title-input").value = notebookState.title;
}

function notebookFileName() {
  const trimmed = notebookState.title.trim() || "Untitled";
  return trimmed.endsWith(".ipynb") ? trimmed : `${trimmed}.ipynb`;
}

function buildIpynbDocument() {
  return {
    cells: notebookState.cells.map((cell) => ({
      cell_type: cell.cellType,
      execution_count: cell.cellType === "code" ? cell.executionCount : null,
      metadata: {},
      outputs:
        cell.cellType === "code" && cell.output
          ? [
              {
                name: "stdout",
                output_type: "stream",
                text: `${cell.output}\n`,
              },
            ]
          : [],
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
    return "";
  }

  return outputs
    .map((output) => {
      if (output.output_type === "stream") {
        return joinNotebookSource(output.text);
      }
      if (output.output_type === "execute_result" || output.output_type === "display_data") {
        const plain = output.data && output.data["text/plain"];
        return plain ? joinNotebookSource(plain) : "[Rich output omitted in current importer]";
      }
      if (output.output_type === "error") {
        const traceback = output.traceback || [];
        return traceback.join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function saveNotebookToStorage() {
  const payload = {
    title: notebookState.title,
    notebook: buildIpynbDocument(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  updateSaveState(`Saved locally at ${new Date().toLocaleTimeString()}`);
}

function loadNotebookFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    createStarterNotebook();
    updateSaveState("Not yet saved");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    applyImportedNotebook(parsed.notebook, parsed.title || "Recovered");
    updateSaveState("Recovered from browser storage");
  } catch (error) {
    console.error(error);
    createStarterNotebook();
    updateSaveState("Recovery failed");
  }
}

function applyImportedNotebook(document, titleHint) {
  const importedCells = Array.isArray(document.cells) ? document.cells : [];
  notebookState.title = stripNotebookExtension(titleHint || "Imported");
  notebookState.cells = importedCells.length
    ? importedCells.map((cell) => ({
        id: nextCellId++,
        cellType: cell.cell_type === "markdown" ? "markdown" : "code",
        source: joinNotebookSource(cell.source),
        output: parseOutputs(cell.outputs),
        executionCount: cell.execution_count ?? null,
        status: "Idle",
      }))
    : [createCodeCell("print('new notebook')")];
  syncNotebookTitle();
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

function renderNotebook() {
  const cellsRoot = document.getElementById("notebook-cells");
  const template = document.getElementById("cell-template");

  cellsRoot.replaceChildren(
    ...notebookState.cells.map((cell, index) => {
      const fragment = template.content.cloneNode(true);
      const article = fragment.querySelector(".cell");
      const kindNode = fragment.querySelector(".cell-kind");
      const statusNode = fragment.querySelector(".cell-status");
      const editorModeLabel = fragment.querySelector(".editor-mode-label");
      const editor = fragment.querySelector(".cell-editor");
      const output = fragment.querySelector(".cell-output");
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
      output.textContent = cell.output;
      output.classList.toggle("is-empty", !cell.output);
      toggleKindButton.addEventListener("click", () => toggleCellType(cell.id));
      runButton.addEventListener("click", () => runCell(cell.id));
      deleteButton.addEventListener("click", () => deleteCell(cell.id));
      moveUpButton.disabled = index === 0;
      moveDownButton.disabled = index === notebookState.cells.length - 1;
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
  notebookState.cells.push(createCodeCell("print('hello from py_whole')"));
  renderNotebook();
  scheduleAutosave();
}

function addMarkdownCell() {
  notebookState.cells.push(createMarkdownCell("# Markdown cell\n\nDocument your work here."));
  renderNotebook();
  scheduleAutosave();
}

function deleteCell(cellId) {
  if (notebookState.cells.length === 1) {
    return;
  }

  notebookState.cells = notebookState.cells.filter((cell) => cell.id !== cellId);
  renderNotebook();
  scheduleAutosave();
}

function moveCell(cellId, offset) {
  const index = notebookState.cells.findIndex((cell) => cell.id === cellId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= notebookState.cells.length) {
    return;
  }

  const [cell] = notebookState.cells.splice(index, 1);
  notebookState.cells.splice(targetIndex, 0, cell);
  renderNotebook();
  scheduleAutosave();
}

function toggleCellType(cellId) {
  const cell = notebookState.cells.find((entry) => entry.id === cellId);
  if (!cell) {
    return;
  }

  if (cell.cellType === "code") {
    cell.cellType = "markdown";
    cell.output = "";
    cell.executionCount = null;
    cell.status = "Idle";
  } else {
    cell.cellType = "code";
    cell.status = "Idle";
  }

  renderNotebook();
  scheduleAutosave();
}

async function runCell(cellId) {
  const cell = notebookState.cells.find((entry) => entry.id === cellId);
  if (!cell || cell.cellType !== "code") {
    return;
  }

  cell.status = "Running";
  cell.output = "Executing...";
  renderNotebook();

  try {
    const output = await runtimeAdapter.execute(cell.source);
    cell.output = output;
    cell.executionCount = (cell.executionCount || 0) + 1;
    cell.status = "Complete";
  } catch (error) {
    cell.output = String(error.message || error);
    cell.status = "Error";
  }

  renderNotebook();
  scheduleAutosave();
}

async function runAllCells() {
  for (const cell of notebookState.cells) {
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
    .getElementById("new-notebook")
    .addEventListener("click", createNewNotebook);
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
      notebookState.title = stripNotebookExtension(event.target.value);
      scheduleAutosave();
    });
  document
    .getElementById("ipynb-file-input")
    .addEventListener("change", importNotebook);
}

function createNewNotebook() {
  createStarterNotebook();
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

function clearRecovery() {
  localStorage.removeItem(STORAGE_KEY);
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
