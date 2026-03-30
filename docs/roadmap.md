# Roadmap

## Development Strategy

The project should move quickly by validating the hardest constraints early:

1. single-file offline packaging
2. in-browser Python execution with acceptable runtime performance
3. notebook editing and output rendering
4. package feasibility
5. advanced environment features such as workspace, terminal, and debugging

The roadmap below is intentionally phased to reduce technical risk before investing in broad UI surface area.

## Phase 0: Technical Spike and Packaging Baseline

Objective: prove that the core runtime can exist as a single offline HTML artifact.

Deliverables:

- Minimal source app and build script structure
- Single HTML output containing the app shell
- Embedded Pyodide or equivalent Python/WASM runtime
- Offline startup with no network requests
- Measurement of artifact size, startup time, and memory profile
- Feasibility report for bundling strategy and package loading model

Exit criteria:

- The app opens locally with no network access
- Python executes in-browser
- The packaging approach is credible enough to continue

## Phase 1: Notebook Editing and Basic Python Execution

Objective: deliver the first useful proof of concept centered on a single notebook.

Deliverables:

- Single-notebook UI
- Rich code-cell editor
- Add/remove/reorder code cells
- Execute code cells
- Render text outputs
- Execution state and basic kernel controls
- New notebook creation

Exit criteria:

- A user can create a notebook, add code cells, execute Python, and see outputs in a local offline HTML file

## Phase 2: Plotting and Notebook Structure

Objective: make the proof of concept feel recognizably notebook-like for scientific work.

Deliverables:

- Inline plotting support
- `matplotlib` integration
- Evaluation of interactive plotting support via `plotly` or `bokeh`
- Notebook metadata structure aligned with `.ipynb`
- Serialization of notebooks in notebook-compatible JSON form

Exit criteria:

- Scientific users can execute basic plotting workflows in the offline notebook

## Phase 3: Markdown and Persistence

Objective: close the gap between code-only execution and actual notebook authoring.

Deliverables:

- Markdown cells
- Markdown preview/rendering
- Math/LaTeX rendering
- Autosave to browser storage
- Recovery on reload or tab close
- Explicit save/load behavior for notebooks

Exit criteria:

- A user can author a mixed code/Markdown notebook and recover it after reopening the app

## Phase 4: Import/Export and `.ipynb` Compatibility

Objective: interoperate with external notebook workflows and arbitrary user files.

Deliverables:

- Import existing `.ipynb`
- Export `.ipynb`
- Arbitrary file import into the virtual filesystem
- Arbitrary file export from the virtual filesystem
- Compatibility validation for Python and Markdown cells

Exit criteria:

- A user can exchange notebooks and data files between the browser app and their local machine

## Phase 5: Workspace and Multi-Notebook UX

Objective: move from a single-document proof of concept toward a practical environment.

Deliverables:

- Multi-notebook support
- Workspace model
- Jupyter-style file browser
- Notebook switching and file navigation
- Better document lifecycle management

Exit criteria:

- Users can work on more than one notebook and manage files in a coherent offline workspace

## Phase 6: Scientific Package Expansion

Objective: broaden the built-in scientific stack while preserving runtime performance.

Deliverables:

- Integrate required packages that are feasible in-browser
- Publish an in-app package inventory/help panel
- Feasibility decisions for:
  - `opencv-python`
  - `scikit-learn`
  - `xarray`
  - `statsmodels`
  - `networkx`
  - `scikit-image`
  - `seaborn`
  - `mpmath`
  - `pint`
  - `h5py`
  - `netCDF4`

Exit criteria:

- The package set is explicit, documented, and tested against representative notebook workflows

## Phase 7: Rich Output and Media Support

Objective: support a broader set of notebook display behaviors.

Deliverables:

- HTML output rendering
- image output handling
- media embeds
- widget feasibility assessment and implementation where practical
- interactive plotting polish

Exit criteria:

- The notebook can display a broad range of rich outputs expected by scientific users

## Phase 8: Terminal and Environment Tooling

Objective: expand the environment beyond notebook cells.

Deliverables:

- Browser terminal experience
- Filesystem access through the terminal
- Clear constraints around shell-like versus Python-console behavior

Exit criteria:

- The terminal is useful and coherent within the offline browser environment

## Phase 9: Debugging and Inspection

Objective: deliver the advanced development ergonomics requested for the product.

Deliverables:

- Breakpoints
- Step over/into/out
- Call stack
- Watch expressions
- Variable explorer
- Debug UX aligned with notebook workflows

Exit criteria:

- Debugging workflows are usable enough to support real notebook development

## Suggested Immediate Next Step

Start with Phase 0 and Phase 1 together in one spike:

- create a minimal browser app source structure
- embed the Python runtime
- prove single-file offline packaging
- implement a single code cell backed by a rich editor
- execute Python and render text output

This is the shortest path to validating whether the product direction is technically viable.
