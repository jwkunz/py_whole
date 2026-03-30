# Product Requirements

## Product Summary

The product is a self-contained single HTML file web application containing all required JavaScript and WebAssembly assets. It runs entirely in modern browsers with no network access and provides a Jupyter-compatible notebook environment for scientific computing.

The implementation may use a more maintainable source project and build pipeline internally, but the shipped artifact must be one static HTML file that works offline after opening it locally.

## Goals

- Deliver a browser-only notebook environment with no server dependency
- Emulate a Jupyter notebook workflow closely enough to preserve user expectations
- Support scientific computing workloads at a moderate scale
- Optimize first for runtime performance
- Start with a fast proof of concept and iterate toward the broader product

## Non-Goals

- No extension or plugin system in v1
- No multi-user or collaborative editing
- No network connectivity at runtime
- No runtime installation of additional packages

## Platform Requirements

### Runtime

- Must run entirely in the browser
- Must not require any backend service
- Must not require internet access at runtime
- Must target modern browsers
- Must remain strictly single-user

### Packaging

- Final deliverable must be a single HTML file
- The HTML may be very large if needed
- All JavaScript, WebAssembly, styles, and bundled assets must be embedded or otherwise included within the single-file artifact
- A separate build script or source application is acceptable and expected

## Execution Environment

### Language Runtime

- Python execution must run in-browser via WebAssembly
- Pyodide is acceptable if the implementation remains fully browser-side and WebAssembly-based
- The environment is fixed at build time
- Users must not be able to install additional packages at runtime

### Filesystem

- The app must emulate a virtual filesystem in the browser
- Users must be able to import arbitrary files into the virtual filesystem
- Users must be able to export arbitrary files from the virtual filesystem
- Browser storage persistence is required
- Autosave and recovery after browser/tab close are required

## Notebook Requirements

### Compatibility

- Full `.ipynb` compatibility is required for Python cells and Markdown cells
- The user experience should closely match Jupyter
- New notebook creation is the first priority for the initial proof of concept
- Existing notebook import support follows after that

### Editing

- Notebook editing is the highest-priority first milestone
- The editor should be richer than classic Jupyter editing
- The target editing experience is closer to Monaco-class capabilities
- Syntax highlighting is expected
- A notebook cell model with rich editing is required

### Execution Controls

- Execute notebook cells in-browser
- Support interrupt execution
- Support kernel restart
- Support clear-kernel-style controls

### Output Rendering

- Notebook cell output rendering is required in the first proof of concept
- Text output is required immediately
- Plotting support should follow immediately after basic execution
- Rich outputs are required in the broader product:
  - HTML output
  - LaTeX and math rendering
  - images
  - widgets where feasible
  - audio/video embeds

### Markdown

- Markdown cells are required for full compatibility
- Markdown editing/rendering can follow after the initial Python code-cell proof of concept

## Workspace Requirements

- The broad product must support multiple notebooks
- The broad product must include a Jupyter-style workspace and file browser
- The first proof of concept may start with a single-notebook UI

## Terminal Requirements

- A browser terminal is required in the broader product

## Debugging Requirements

The intended notebook experience should incorporate VS Code-style notebook debugging capabilities while remaining Jupyter-like overall.

Required debugging capabilities:

- breakpoints
- step over
- step into
- step out
- call stack
- watch expressions
- variable explorer

## Visual and UX Requirements

- The UI should generally match Jupyter expectations
- Dark mode is required
- Variable viewing similar to VS Code's Jupyter experience is required

## Package Requirements

### Must-Have Packages

- `numpy`
- `scipy`
- `matplotlib`
- `sympy`
- `pandas`
- `opencv-python` or equivalent browser-feasible OpenCV support

### Optional Package

- `scikit-learn`, if feasible within browser/WebAssembly constraints

### Additional Desired Packages

- `xarray`
- `statsmodels`
- `networkx`
- `scikit-image`
- `plotly` or `bokeh` for interactive plots
- `seaborn`
- `mpmath`
- `pint`
- `h5py` or `netCDF4`, if feasible under browser constraints

### Package Visibility

- The application must advertise the installed package set in on-page help/documentation

## Performance Requirements

- Primary optimization target: runtime performance
- Moderate workloads are the target for v1
- Startup time and final HTML size are secondary to runtime performance

## Delivery Priorities Captured From Interview

### First Proof of Concept

- single notebook
- new notebook creation
- rich code editor
- Python execution
- cell output rendering
- text output first
- plotting immediately after basic execution

### Later Phases

- Markdown cells
- notebook persistence
- existing `.ipynb` import
- multi-notebook workspace
- file browser
- arbitrary file import/export
- terminal
- debugger
- richer output support

## Open Technical Risks and Assumptions

These are not unresolved product requirements. They are implementation risks to validate early.

- Producing one offline HTML file that embeds a substantial Python scientific stack may create a very large artifact
- Some packages may not be feasible in Pyodide or may require substitutions
- OpenCV, `scikit-learn`, `h5py`, and `netCDF4` may be especially sensitive to browser and WASM constraints
- Full Jupyter widget compatibility may be difficult in a single-file offline artifact
- VS Code-class debugging in a browser-hosted Pyodide notebook may require substantial custom infrastructure
- A terminal in the browser may need to be framed as a Python or filesystem console rather than a full POSIX shell
