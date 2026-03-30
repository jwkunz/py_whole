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
  title: "Untitled.ipynb",
  runtimeReady: false,
  cells: [],
};

let nextCellId = 1;

const runtimeAdapter = {
  async initialize() {
    notebookState.runtimeReady = true;
    updateKernelState("Runtime adapter ready");
  },

  async restart() {
    notebookState.runtimeReady = false;
    updateKernelState("Restarting");
    await this.initialize();
  },

  async execute(source) {
    if (!notebookState.runtimeReady) {
      throw new Error(
        "Runtime is not initialized. The Python/WASM payload still needs to be embedded.",
      );
    }

    return [
      "Execution adapter placeholder",
      "",
      "The notebook shell is live, but Python execution is not yet connected.",
      "Next step: embed the offline WebAssembly runtime and route cell code into it.",
      "",
      "Submitted source:",
      source,
    ].join("\n");
  },
};

function updateKernelState(text) {
  document.getElementById("kernel-state").textContent = text;
}

function createStarterCell() {
  return {
    id: nextCellId++,
    source: [
      "# py_whole proof of concept",
      "import math",
      "",
      "radius = 3",
      "area = math.pi * radius ** 2",
      "print(f'circle area = {area:.3f}')",
    ].join("\n"),
    output: "Cell output will appear here.",
    status: "Idle",
  };
}

function seedNotebook() {
  notebookState.cells = [createStarterCell()];
}

function renderPackageList() {
  const list = document.getElementById("package-list");
  list.replaceChildren(
    ...SCIENTIFIC_PACKAGES.map((pkg) => {
      const item = document.createElement("li");
      item.textContent = pkg;
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
      const statusNode = fragment.querySelector(".cell-status");
      const editor = fragment.querySelector(".cell-editor");
      const output = fragment.querySelector(".cell-output");
      const runButton = fragment.querySelector(".run-cell");
      const deleteButton = fragment.querySelector(".delete-cell");
      const moveUpButton = fragment.querySelector(".move-up");
      const moveDownButton = fragment.querySelector(".move-down");

      article.dataset.cellId = String(cell.id);
      statusNode.textContent = cell.status;
      editor.value = cell.source;
      output.textContent = cell.output;
      output.classList.toggle("is-empty", !cell.output);
      runButton.addEventListener("click", () => runCell(cell.id));
      deleteButton.addEventListener("click", () => deleteCell(cell.id));
      moveUpButton.disabled = index === 0;
      moveDownButton.disabled = index === notebookState.cells.length - 1;
      moveUpButton.addEventListener("click", () => moveCell(cell.id, -1));
      moveDownButton.addEventListener("click", () => moveCell(cell.id, 1));
      editor.addEventListener("input", (event) => {
        cell.source = event.target.value;
      });

      return fragment;
    }),
  );
}

function addCodeCell() {
  notebookState.cells.push({
    id: nextCellId++,
    source: "print('hello from py_whole')",
    output: "",
    status: "Idle",
  });
  renderNotebook();
}

function deleteCell(cellId) {
  if (notebookState.cells.length === 1) {
    return;
  }

  notebookState.cells = notebookState.cells.filter((cell) => cell.id !== cellId);
  renderNotebook();
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
}

async function runCell(cellId) {
  const cell = notebookState.cells.find((entry) => entry.id === cellId);
  if (!cell) {
    return;
  }

  cell.status = "Running";
  cell.output = "Executing...";
  renderNotebook();

  try {
    const output = await runtimeAdapter.execute(cell.source);
    cell.output = output;
    cell.status = "Complete";
  } catch (error) {
    cell.output = String(error.message || error);
    cell.status = "Error";
  }

  renderNotebook();
}

async function runAllCells() {
  for (const cell of notebookState.cells) {
    await runCell(cell.id);
  }
}

function wireEvents() {
  document
    .getElementById("initialize-runtime")
    .addEventListener("click", () => runtimeAdapter.initialize());
  document
    .getElementById("restart-runtime")
    .addEventListener("click", () => runtimeAdapter.restart());
  document
    .getElementById("add-code-cell")
    .addEventListener("click", addCodeCell);
  document.getElementById("run-all").addEventListener("click", runAllCells);
}

function bootstrap() {
  renderPackageList();
  seedNotebook();
  renderNotebook();
  wireEvents();
  updateKernelState("Awaiting runtime bundle");
}

bootstrap();
