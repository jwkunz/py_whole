self.window = self;
__INLINE_RUNTIME_BOOTSTRAP_WORKER__
__INLINE_RUNTIME_LOADER__

const EMBEDDED_PYODIDE = self.__PYWHOLE_EMBEDDED_PYODIDE__ || { available: false };
const BUNDLED_PACKAGE_SET = new Set(EMBEDDED_PYODIDE.bundledPackages || []);
const assetCache = new Map();
let pyodide = null;
let runCellFn = null;
let loadedPackages = new Set();
let knownWorkspacePaths = new Set();
let debugNotebookManifest = {
  notebookId: null,
  cells: [],
  cellMap: new Map(),
  breakpointsByCell: {},
  status: "idle",
  reason: "",
  pausedCellId: null,
  pausedLine: null,
  selectedFrameIndex: 0,
  note: "",
};
let activeDebugPlan = null;

function workerDebugFilename(cellId) {
  const notebookId = encodeURIComponent(debugNotebookManifest.notebookId || "active");
  return `pywhole://notebook/${notebookId}/cell/${cellId}.py`;
}

function normalizeFetchUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (input && typeof input.url === "string") {
    return input.url;
  }
  return String(input || "");
}

function isEmbeddedPyodideAssetUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }
  if (url.startsWith(EMBEDDED_PYODIDE.indexURL)) {
    return true;
  }
  try {
    const parsed = new URL(url, "https://pywhole.local/");
    const embeddedBase = new URL(EMBEDDED_PYODIDE.indexURL);
    return parsed.origin === embeddedBase.origin && parsed.pathname.startsWith(embeddedBase.pathname);
  } catch (_error) {
    return false;
  }
}

function normalizeEmbeddedAssetUrl(url) {
  try {
    return new URL(url, EMBEDDED_PYODIDE.indexURL).href;
  } catch (_error) {
    return url;
  }
}

function decodeBase64Asset(cacheKey, base64) {
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

function serveEmbeddedPyodideAsset(url) {
  const normalizedUrl = normalizeEmbeddedAssetUrl(url);
  const headers = new Headers();
  if (normalizedUrl.endsWith("pyodide.asm.wasm")) {
    headers.set("Content-Type", "application/wasm");
    return new Response(decodeBase64Asset("wasm", EMBEDDED_PYODIDE.assets.wasmBase64), { headers });
  }
  if (normalizedUrl.endsWith("python_stdlib.zip")) {
    headers.set("Content-Type", "application/zip");
    return new Response(decodeBase64Asset("stdlib", EMBEDDED_PYODIDE.assets.stdlibBase64), { headers });
  }
  if (normalizedUrl.endsWith("pyodide-lock.json")) {
    headers.set("Content-Type", "application/json");
    return new Response(EMBEDDED_PYODIDE.assets.lockFileText, { headers });
  }
  const packageFileName = normalizedUrl.slice(EMBEDDED_PYODIDE.indexURL.length);
  if (EMBEDDED_PYODIDE.assets.packages && EMBEDDED_PYODIDE.assets.packages[packageFileName]) {
    headers.set(
      "Content-Type",
      packageFileName.endsWith(".zip") ? "application/zip" : "application/octet-stream",
    );
    return new Response(
      decodeBase64Asset(`pkg:${packageFileName}`, EMBEDDED_PYODIDE.assets.packages[packageFileName]),
      { headers },
    );
  }
  return new Response("Not found", { status: 404 });
}

function installPyodideAssetFetch() {
  if (!EMBEDDED_PYODIDE.available || self.__pyWholePyodideFetchInstalled) {
    return;
  }
  const originalFetch = self.fetch.bind(self);
  self.fetch = async (input, init) => {
    const url = normalizeFetchUrl(input);
    if (isEmbeddedPyodideAssetUrl(url)) {
      return serveEmbeddedPyodideAsset(url);
    }
    return originalFetch(input, init);
  };
  self.__pyWholePyodideFetchInstalled = true;
}

function pyodidePackageName(packageName) {
  switch (packageName) {
    case "opencv":
      return "opencv-python";
    default:
      return packageName;
  }
}

async function ensurePackagesLoaded(packageNames) {
  if (!pyodide || !Array.isArray(packageNames) || !packageNames.length) {
    return Array.from(loadedPackages);
  }
  const pendingPackages = packageNames.filter(
    (packageName) => BUNDLED_PACKAGE_SET.has(packageName) && !loadedPackages.has(packageName),
  );
  if (!pendingPackages.length) {
    return Array.from(loadedPackages);
  }
  await pyodide.loadPackage(pendingPackages.map(pyodidePackageName));
  pendingPackages.forEach((packageName) => loadedPackages.add(packageName));
  return Array.from(loadedPackages);
}

function ensureParentDirectories(fsApi, filePath) {
  const segments = String(filePath || "").split("/").filter(Boolean);
  if (segments.length <= 1) {
    return;
  }
  let currentPath = "";
  for (const segment of segments.slice(0, -1)) {
    currentPath += `/${segment}`;
    try {
      fsApi.mkdir(currentPath);
    } catch (_error) {
    }
  }
}

function setDebugNotebookManifest(payload = {}) {
  const cells = Array.isArray(payload.cells) ? payload.cells : [];
  debugNotebookManifest = {
    notebookId: payload.notebookId ?? null,
    cells: cells
      .filter((cell) => cell && typeof cell === "object" && Number.isFinite(cell.id))
      .map((cell) => ({
        id: cell.id,
        cellType: String(cell.cellType || "code"),
        source: String(cell.source || ""),
      })),
    cellMap: new Map(),
    breakpointsByCell: payload.breakpointsByCell && typeof payload.breakpointsByCell === "object"
      ? payload.breakpointsByCell
      : {},
    status: "idle",
    reason: "",
    pausedCellId: null,
    pausedLine: null,
    selectedFrameIndex: 0,
    note: "",
  };
  debugNotebookManifest.cells.forEach((cell) => {
    debugNotebookManifest.cellMap.set(cell.id, cell);
  });
  activeDebugPlan = null;
}

function debugCellById(cellId) {
  return debugNotebookManifest.cellMap.get(cellId) || null;
}

function debugCellLabel(cellId, lineNumber = null) {
  const cell = debugCellById(cellId);
  if (!cell) {
    return "No active location";
  }
  const lines = String(cell.source || "").split("\n");
  const preview = Number.isFinite(lineNumber)
    ? (lines[lineNumber - 1] || "").trim()
    : (lines[0] || "").trim();
  const lineSuffix = Number.isFinite(lineNumber) ? ` : line ${lineNumber}` : "";
  return `Cell ${cell.id}${lineSuffix}  ${preview || "(blank line)"}`;
}

function executableLineNumbers(source) {
  const lines = String(source || "").split("\n");
  const result = [];
  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    result.push(index + 1);
  });
  return result;
}

function firstExecutableLine(cellId) {
  const cell = debugCellById(cellId);
  if (!cell) {
    return 1;
  }
  return executableLineNumbers(cell.source)[0] || 1;
}

async function buildDebugPlan(cellId) {
  const cell = debugCellById(cellId);
  if (!cell || !pyodide) {
    return null;
  }
  const planJson = await pyodide.runPythonAsync(`
import json

source = ${JSON.stringify(String(cell.source || ""))}
tree = ast.parse(source, mode="exec")
plan = []
for statement in tree.body:
    plan.append({
        "lineno": getattr(statement, "lineno", 1),
        "end_lineno": getattr(statement, "end_lineno", getattr(statement, "lineno", 1)),
        "is_expression": isinstance(statement, ast.Expr),
    })
json.dumps(plan)
`);
  const statements = JSON.parse(planJson || "[]");
  return {
    cellId,
    source: String(cell.source || ""),
    statements,
    statementIndex: 0,
  };
}

function nextExecutableLine(cellId, currentLine) {
  const cell = debugCellById(cellId);
  if (!cell) {
    return null;
  }
  return executableLineNumbers(cell.source).find((line) => line > currentLine) || null;
}

function breakpointLines(cellId) {
  const raw = debugNotebookManifest.breakpointsByCell?.[cellId];
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(new Set(raw.filter((line) => Number.isInteger(line) && line > 0))).sort((a, b) => a - b);
}

function updateDebugState(nextState = {}) {
  const currentLocationLabel = nextState.current_location_label
    || (Number.isFinite(nextState.paused_cell_id)
      ? debugCellLabel(nextState.paused_cell_id, nextState.paused_line)
      : "");
  const frames = Array.isArray(nextState.frames) ? nextState.frames : (
    Number.isFinite(nextState.paused_cell_id)
      ? [{
          cell_id: nextState.paused_cell_id,
          line: nextState.paused_line,
          location_label: currentLocationLabel,
          locals: [],
        }]
      : []
  );
  const state = {
    status: String(nextState.status || "idle"),
    reason: String(nextState.reason || ""),
    paused: ["paused", "running", "exception"].includes(String(nextState.status || "idle")),
    paused_cell_id: Number.isFinite(nextState.paused_cell_id) ? nextState.paused_cell_id : null,
    paused_line: Number.isFinite(nextState.paused_line) ? nextState.paused_line : null,
    current_location_label: currentLocationLabel,
    frames,
    selected_frame_index: Number.isFinite(nextState.selected_frame_index) ? nextState.selected_frame_index : 0,
    breakpoints: debugNotebookManifest.cells.flatMap((cell) =>
      breakpointLines(cell.id).map((line) => ({
        cell_id: cell.id,
        line,
        location_label: debugCellLabel(cell.id, line),
      }))
    ),
    note: String(nextState.note || ""),
  };
  debugNotebookManifest.status = state.status;
  debugNotebookManifest.reason = state.reason;
  debugNotebookManifest.pausedCellId = state.paused_cell_id;
  debugNotebookManifest.pausedLine = state.paused_line;
  debugNotebookManifest.selectedFrameIndex = state.selected_frame_index;
  debugNotebookManifest.note = state.note;
  return state;
}

function configureDebugNotebook(payload = {}) {
  setDebugNotebookManifest(payload);
  return updateDebugState({
    status: "idle",
    reason: "",
    note: "Debug runtime protocol configured.",
  });
}

async function startDebugSession(payload = {}) {
  const cellId = Number(payload.cellId);
  activeDebugPlan = await buildDebugPlan(cellId);
  const line = activeDebugPlan?.statements?.[0]?.lineno || firstExecutableLine(cellId);
  return updateDebugState({
    status: "paused",
    reason: "Paused on entry",
    paused_cell_id: cellId,
    paused_line: line,
    note: "Worker debug session prepared.",
  });
}

async function executePlannedStatement(plan, statementIndex) {
  if (!plan || !plan.statements?.[statementIndex] || !pyodide) {
    return null;
  }
  const statement = plan.statements[statementIndex];
  const snippet = String(plan.source || "")
    .split("\n")
    .slice(Math.max(0, statement.lineno - 1), statement.end_lineno)
    .join("\n");
  const stdout = [];
  const stderr = [];
  pyodide.setStdout({ batched: (line) => stdout.push(line) });
  pyodide.setStderr({ batched: (line) => stderr.push(line) });
  self.__pyWholeDisplayOutputs = [];
  try {
    const resultJson = await pyodide.runPythonAsync(`
import json

source = ${JSON.stringify(snippet)}
filename = ${JSON.stringify(workerDebugFilename(plan.cellId))}
is_expression = ${statement.is_expression ? "True" : "False"}

_pywhole_patch_matplotlib()
namespace = __main__.__dict__
tree = ast.parse(source, mode="exec")

if is_expression and tree.body and isinstance(tree.body[-1], ast.Expr):
    value = eval(compile(ast.Expression(tree.body[-1].value), filename, "eval"), namespace, namespace)
    _pywhole_capture_display(value)
else:
    exec(compile(tree, filename, "exec"), namespace, namespace)

_pywhole_patch_matplotlib()
_pywhole_capture_figures()
json.dumps({"ok": True})
`);
    const result = JSON.parse(resultJson || "{\"ok\":true}");
    return {
      ...result,
      stdout,
      stderr,
      displayOutputs: self.__pyWholeDisplayOutputs || [],
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      stdout,
      stderr,
      displayOutputs: self.__pyWholeDisplayOutputs || [],
    };
  } finally {
    pyodide.setStdout({ batched: () => {} });
    pyodide.setStderr({ batched: () => {} });
  }
}

async function continueDebugSession() {
  if (!activeDebugPlan || !Number.isFinite(activeDebugPlan.cellId)) {
    return updateDebugState({
      status: "idle",
      reason: "",
      note: "No active debug session.",
    });
  }
  const { cellId } = activeDebugPlan;
  const breakpoints = new Set(breakpointLines(cellId));
  const outputs = [];
  while (activeDebugPlan.statementIndex < activeDebugPlan.statements.length) {
    const statement = activeDebugPlan.statements[activeDebugPlan.statementIndex];
    if (activeDebugPlan.statementIndex > 0 && breakpoints.has(statement.lineno)) {
      return {
        state: updateDebugState({
          status: "paused",
          reason: "Paused at breakpoint",
          paused_cell_id: cellId,
          paused_line: statement.lineno,
          note: "Paused at the next breakpoint in the current cell.",
        }),
        outputs,
      };
    }
    const statementResult = await executePlannedStatement(activeDebugPlan, activeDebugPlan.statementIndex);
    outputs.push(statementResult);
    if (!statementResult?.ok) {
      activeDebugPlan = null;
      return {
        state: updateDebugState({
          status: "exception",
          reason: "Exception paused",
          paused_cell_id: cellId,
          paused_line: statement.lineno,
          note: statementResult.error || "Statement execution failed.",
        }),
        outputs,
      };
    }
    activeDebugPlan.statementIndex += 1;
  }
  activeDebugPlan = null;
  return {
    state: updateDebugState({
      status: "completed",
      reason: "Completed",
      paused_cell_id: null,
      paused_line: null,
      note: "Reached the end of the current authored cell.",
    }),
    outputs,
  };
}

async function stepIntoDebugSession() {
  if (!activeDebugPlan || !Number.isFinite(activeDebugPlan.cellId)) {
    return updateDebugState({
      status: "idle",
      reason: "",
      note: "No active debug session.",
    });
  }
  if (activeDebugPlan.statementIndex >= activeDebugPlan.statements.length) {
    activeDebugPlan = null;
    return {
      state: updateDebugState({
        status: "completed",
        reason: "Completed",
        paused_cell_id: null,
        paused_line: null,
        note: "Reached the end of the current authored cell.",
      }),
      outputs: [],
    };
  }
  const statement = activeDebugPlan.statements[activeDebugPlan.statementIndex];
  const statementResult = await executePlannedStatement(activeDebugPlan, activeDebugPlan.statementIndex);
  if (!statementResult?.ok) {
    activeDebugPlan = null;
    return {
      state: updateDebugState({
        status: "exception",
        reason: "Exception paused",
        paused_cell_id: activeDebugPlan?.cellId || null,
        paused_line: statement?.lineno || null,
        note: statementResult.error || "Statement execution failed.",
      }),
      outputs: [statementResult],
    };
  }
  activeDebugPlan.statementIndex += 1;
  const nextStatement = activeDebugPlan.statements[activeDebugPlan.statementIndex];
  if (nextStatement) {
    return {
      state: updateDebugState({
        status: "paused",
        reason: "Stepped",
        paused_cell_id: activeDebugPlan.cellId,
        paused_line: nextStatement.lineno,
        note: "Advanced to the next top-level statement in the current cell.",
      }),
      outputs: [statementResult],
    };
  }
  activeDebugPlan = null;
  return {
    state: updateDebugState({
      status: "completed",
      reason: "Completed",
      paused_cell_id: null,
      paused_line: null,
      note: "Reached the end of the current authored cell.",
    }),
    outputs: [statementResult],
  };
}

async function stepOverDebugSession() {
  return stepIntoDebugSession();
}

function stopDebugSession() {
  activeDebugPlan = null;
  return updateDebugState({
    status: "idle",
    reason: "",
    paused_cell_id: null,
    paused_line: null,
    note: "Debug session stopped.",
  });
}

async function syncWorkspaceFiles(files) {
  if (!pyodide) {
    return;
  }
  const fsApi = pyodide.FS;
  try {
    fsApi.mkdirTree("/workspace");
  } catch (_error) {
  }
  const nextPaths = new Set((files || []).map((file) => `/workspace/${file.path || file.name}`));
  for (const previousPath of knownWorkspacePaths) {
    if (nextPaths.has(previousPath)) {
      continue;
    }
    try {
      fsApi.unlink(previousPath);
    } catch (_error) {
    }
  }
  for (const file of files || []) {
    const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
    const path = `/workspace/${file.path || file.name}`;
    ensureParentDirectories(fsApi, path);
    try {
      fsApi.unlink(path);
    } catch (_error) {
    }
    fsApi.writeFile(path, bytes);
  }
  knownWorkspacePaths = nextPaths;
}

async function installNotebookHelpers() {
  pyodide.registerJsModule("pywhole_bridge", {
    push_output_json(payloadJson) {
      if (!self.__pyWholeDisplayOutputs) {
        self.__pyWholeDisplayOutputs = [];
      }
      self.__pyWholeDisplayOutputs.push(JSON.parse(payloadJson));
    },
  });

  await pyodide.runPythonAsync(`
import ast
import base64
import __main__
import json
import os
from pywhole_bridge import push_output_json

os.environ["MPLBACKEND"] = "Agg"
os.environ["DISPLAY"] = ""

def _pywhole_push_output(payload):
    push_output_json(json.dumps(payload))

def _pywhole_capture_display(value):
    if value is None:
        return

    if hasattr(value, "_repr_html_"):
        html = value._repr_html_()
        if html:
            _pywhole_push_output({"kind": "html", "html": str(html)})
            return

    if hasattr(value, "_repr_svg_"):
        svg = value._repr_svg_()
        if svg:
            _pywhole_push_output({"kind": "svg", "svg": str(svg)})
            return

    if hasattr(value, "_repr_png_"):
        png = value._repr_png_()
        if png:
            if isinstance(png, memoryview):
                png = png.tobytes()
            encoded = base64.b64encode(png).decode("ascii")
            _pywhole_push_output({"kind": "image", "mime": "image/png", "data": encoded})
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
                _pywhole_push_output({"kind": "image", "mime": "image/png", "data": encoded})
            if figures:
                plt.close("all")
                return
        except Exception:
            pass

    if isinstance(value, (dict, list, tuple)):
        try:
            _pywhole_push_output({"kind": "json", "data": json.dumps(value, indent=2, default=str)})
            return
        except Exception:
            pass

    _pywhole_push_output({"kind": "stream", "name": "stdout", "text": str(value)})

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
        _pywhole_push_output({"kind": "image", "mime": "image/png", "data": encoded})
    plt.close("all")

def _pywhole_patch_matplotlib():
    try:
        import matplotlib
        matplotlib.use("Agg", force=True)
        matplotlib.rcParams["backend"] = "Agg"
        import matplotlib.pyplot as plt
        plt.switch_backend("Agg")
        plt.pause = lambda *args, **kwargs: None
    except Exception:
        pass

def _pywhole_run_cell(source):
    _pywhole_patch_matplotlib()
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

    _pywhole_patch_matplotlib()
    _pywhole_capture_figures()

def _pywhole_debug_empty_state():
    return {
        "status": "idle",
        "reason": "",
        "paused": False,
        "paused_cell_id": None,
        "paused_line": None,
        "current_location_label": "",
        "frames": [],
        "selected_frame_index": 0,
        "breakpoints": [],
        "note": "",
    }

_pywhole_debug_state = _pywhole_debug_empty_state()

def _pywhole_get_debug_state():
    return _pywhole_debug_state

def _pywhole_reset_debug_state():
    global _pywhole_debug_state
    _pywhole_debug_state = _pywhole_debug_empty_state()
    return _pywhole_debug_state

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
    try:
        if hasattr(value, "_repr_html_"):
            html = value._repr_html_()
            if html:
                detail_kind = "html"
                detail = html
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
`);
}

async function initializeRuntime({ files = [], preloadPackages = [] }) {
  if (pyodide) {
    return {
      version: EMBEDDED_PYODIDE.version,
      loadedPackages: Array.from(loadedPackages),
    };
  }
  if (!EMBEDDED_PYODIDE.available || typeof self.loadPyodide !== "function") {
    throw new Error("Embedded Pyodide runtime assets are not available in this build.");
  }
  installPyodideAssetFetch();
  pyodide = await self.loadPyodide({
    indexURL: EMBEDDED_PYODIDE.indexURL,
    lockFileURL: EMBEDDED_PYODIDE.lockFileURL,
    stdout: () => {},
    stderr: () => {},
  });
  await installNotebookHelpers();
  await syncWorkspaceFiles(files);
  await ensurePackagesLoaded(preloadPackages);
  return {
    version: EMBEDDED_PYODIDE.version,
    loadedPackages: Array.from(loadedPackages),
  };
}

async function executeCode(source) {
  if (!pyodide) {
    throw new Error("Runtime is not initialized.");
  }
  const stdout = [];
  const stderr = [];
  pyodide.setStdout({ batched: (line) => stdout.push(line) });
  pyodide.setStderr({ batched: (line) => stderr.push(line) });
  self.__pyWholeDisplayOutputs = [];
  try {
    if (!runCellFn) {
      runCellFn = pyodide.globals.get("_pywhole_run_cell");
    }
    await runCellFn(source);
  } finally {
    pyodide.setStdout({ batched: () => {} });
    pyodide.setStderr({ batched: () => {} });
  }
  return {
    stdout,
    stderr,
    displayOutputs: self.__pyWholeDisplayOutputs || [],
  };
}

async function listVariables() {
  const listingFn = pyodide.globals.get("_pywhole_list_variables");
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
}

async function inspectVariable(name) {
  const inspectFn = pyodide.globals.get("_pywhole_inspect_variable");
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
}

async function runDiagnostics(checks) {
  await ensurePackagesLoaded((checks || []).map(([packageName]) => packageName));
  const diagnosticsJson = await pyodide.runPythonAsync(`
import importlib
import io
import json
import sys
import base64

checks = ${JSON.stringify([])}
results = [{
    "name": "python",
    "ok": True,
    "detail": sys.version.split("\\n")[0],
}]

for package_name, module_name in checks:
    try:
        module = importlib.import_module(module_name)
        version = getattr(module, "__version__", "unknown")
        detail = f"version={version}"
        if package_name == "matplotlib":
            try:
                detail += f" backend={module.get_backend()}"
            except Exception:
                pass
        results.append({
            "name": package_name,
            "ok": True,
            "detail": detail,
        })
    except Exception as exc:
        results.append({
            "name": package_name,
            "ok": False,
            "detail": str(exc),
        })

try:
    import numpy as np
    import pandas as pd
    series = pd.Series(np.array([1, 2, 3], dtype=float))
    results.append({
        "name": "numpy+pandas smoke",
        "ok": True,
        "detail": f"series_sum={float(series.sum())}",
    })
except Exception as exc:
    results.append({
        "name": "numpy+pandas smoke",
        "ok": False,
        "detail": str(exc),
    })

try:
    import matplotlib
    import matplotlib.pyplot as plt

    figure = plt.figure()
    axis = figure.add_subplot(111)
    axis.plot([0, 1, 2], [0, 1, 4])
    axis.set_title("py_whole diagnostics")
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", bbox_inches="tight")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    plt.close(figure)
    results.append({
        "name": "matplotlib render",
        "ok": True,
        "detail": f"bytes={len(buffer.getvalue())} backend={matplotlib.get_backend()}",
        "preview_mime": "image/png",
        "preview_data": encoded,
    })
except Exception as exc:
    results.append({
        "name": "matplotlib render",
        "ok": False,
        "detail": str(exc),
    })

try:
    import matplotlib.pyplot as plt
    figure = plt.figure()
    axis = figure.add_subplot(111)
    axis.plot([0, 1], [0, 1])
    plt.show()
    plt.close(figure)
    results.append({
        "name": "matplotlib show()",
        "ok": True,
        "detail": "show() completed without raising an exception",
    })
except Exception as exc:
    results.append({
        "name": "matplotlib show()",
        "ok": False,
        "detail": str(exc),
    })

json.dumps(results)
`.replace(JSON.stringify([]), JSON.stringify(checks || [])));
  return JSON.parse(diagnosticsJson);
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    switch (type) {
      case "initialize":
        result = await initializeRuntime(payload || {});
        break;
      case "ensurePackagesLoaded":
        result = { loadedPackages: await ensurePackagesLoaded(payload?.packageNames || []) };
        break;
      case "syncWorkspaceFiles":
        await syncWorkspaceFiles(payload?.files || []);
        result = { ok: true };
        break;
      case "execute":
        result = await executeCode(payload?.source || "");
        break;
      case "listVariables":
        result = await listVariables();
        break;
      case "inspectVariable":
        result = await inspectVariable(payload?.name || "");
        break;
      case "runDiagnostics":
        result = await runDiagnostics(payload?.checks || []);
        break;
      case "fetchDebugState":
        result = pyodide ? pyodide.globals.get("_pywhole_get_debug_state")().toJs() : null;
        break;
      case "resetDebugState":
        result = pyodide ? pyodide.globals.get("_pywhole_reset_debug_state")().toJs() : null;
        break;
      case "configureDebugNotebook":
        result = configureDebugNotebook(payload || {});
        break;
      case "startDebugSession":
        result = await startDebugSession(payload || {});
        break;
      case "continueDebugSession":
        result = await continueDebugSession();
        break;
      case "stepIntoDebugSession":
        result = await stepIntoDebugSession();
        break;
      case "stepOverDebugSession":
        result = await stepOverDebugSession();
        break;
      case "stopDebugSession":
        result = stopDebugSession();
        break;
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
