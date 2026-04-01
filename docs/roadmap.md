# Roadmap

## Status

The original spike roadmap is effectively complete through the core product proof:

- single-file offline packaging exists
- embedded Pyodide execution works offline
- notebook editing, execution, markdown, and persistence exist
- `.ipynb` import and export exist
- a multi-document workspace and workspace file model exist
- variable, watch, terminal, debugger, runtime diagnostics, and package-help surfaces exist

That means the project is no longer in the "prove the concept" stage. The next work should focus on hardening, validation, and narrowing the gap between "implemented" and "reliably usable."

## Current Product Audit

### Completed Foundation

- Single HTML build pipeline with embedded JavaScript, CSS, Pyodide runtime, and bundled package assets
- Offline Python execution in modern browsers
- Notebook cell editing, insertion, deletion, duplication, reordering, and execution
- Markdown cells with rendered preview and math presentation
- Browser-storage persistence and recovery
- `.ipynb` import and export
- Multi-notebook workspace shell with document tabs and launcher
- Workspace file import, export, preview, filtering, editing, rename, move, and folder creation
- Runtime diagnostics and package inventory/help UI
- Variable viewer, variable inspector, watch expressions, and a browser Python console
- Initial debugger flow with breakpoints, pause/continue/step mechanics, and keyboard shortcuts

### Still Partial

- Scientific package expansion beyond the currently bundled subset
- Rich-output coverage beyond the currently supported MIME and plotting paths
- Terminal ergonomics and clear product framing for the console model
- Debugging depth relative to the original VS Code-style aspiration
- Regression-tested confidence in the newest menubar and workbench refactors

### Known Constraints

- The app remains primarily implemented in one large file: `src/app.js`
- Runtime restart is still a full page reload because Pyodide does not support a second runtime instance in the same global scope
- The package UI lists some desired packages that are not yet embedded in the shipped runtime
- Some recently moved UI surfaces still need validation after the workbench refactor

## Phase 10: Verification and Product Hardening

Objective: turn the current feature-rich prototype into a more reliable and internally coherent offline notebook environment.

### Deliverables

- End-to-end verification of all top-menubar actions and launcher actions
- Regression pass for `.ipynb` import/export and workspace file import/export flows
- Validation of multi-cell `matplotlib` workflows, especially repeated `plt.show()`
- Validation of the bottom `Debug` and `Terminal` utility panels after their relocation
- UX cleanup for side-rail density, notebook readability, and panel placement
- Clear documentation of what is truly bundled versus only planned in the package inventory
- Cleanup of stale docs so requirements, roadmap, README, and handoff notes describe the current product accurately

### Exit Criteria

- The primary notebook, workspace, runtime, and diagnostics workflows all pass manual verification without known blocking regressions
- The UI layout feels intentional and coherent on both desktop and narrow-width layouts
- The package/help surfaces do not overstate runtime capabilities
- The docs describe the current product and the next set of engineering priorities accurately

## Proposed Work Breakdown For Phase 10

### 1. Functional Verification

- File menu actions
- Cell menu actions
- Kernel menu actions
- Help/runtime actions
- Launcher shortcuts
- Quick-open and command-palette actions
- Notebook import/export
- Workspace file import/export/editing
- Execute the manual pass captured in `docs/phase10_checklist.md`

### 2. Runtime and Plotting Validation

- Re-test runtime initialization and restart flows
- Re-test runtime diagnostics output and report insertion
- Re-test `matplotlib` figure capture across multiple cells
- Re-test package demo snippets against the actually bundled runtime set

### 3. UX Tightening

- Reduce visual crowding in the side rails
- Tighten notebook document typography and vertical spacing
- Re-evaluate whether `Watch` belongs in the right rail or in the bottom utility area
- Simplify launcher presentation now that the workbench is the primary product surface

### 4. Documentation and Product Framing

- Keep requirements as the broad product target
- Use the roadmap as the live implementation status and near-term plan
- Keep handoff notes focused on architecture, constraints, and immediate validation work
- Update README so it describes the current workbench instead of an initial scaffold
- Keep `docs/phase10_checklist.md` as the working verification script for this iteration

## After Phase 10

If Phase 10 closes cleanly, the next decision should be made from a position of verified behavior rather than speculative scope. At that point the likely branches are:

- broaden the bundled scientific stack
- deepen rich-output compatibility
- improve debugger fidelity
- refactor `src/app.js` into maintainable modules

That choice should be driven by the results of the verification pass rather than by the original spike roadmap.
