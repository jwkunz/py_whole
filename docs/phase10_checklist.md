# Phase 10 Checklist

This checklist turns the current Phase 10 plan into a concrete manual verification pass for the existing workbench.

## Scope

Priority order:

1. primary notebook workflows
2. workspace and file workflows
3. runtime diagnostics and plotting
4. terminal, variables, watch, and debugger
5. UX and layout review

## Test Environment

- Build the single-file app with `bash scripts/build_single_html.sh`
- Open `dist/py_whole.html` locally in a modern browser
- Run the pass once from a clean browser storage state
- Run the pass again after reload to verify recovery behavior

## Notebook Core

- `File > New Notebook`
  - Expected: a new notebook becomes active, title is editable, document tab updates, save state changes
- `Edit > Add Code Cell`
  - Expected: a new code cell appears and can be focused by clicking anywhere in the cell
- `Edit > Add Markdown Cell`
  - Expected: a markdown cell appears and supports source/editing and rendered preview
- Per-cell run button
  - Expected: the active code cell runs and renders output
- `Cell > Run Cell`
  - Expected: selected cell runs
- `Cell > Run Above`
  - Expected: all runnable cells above the selected cell run in order
- `Cell > Run Below`
  - Expected: selected cell and following runnable cells run in order
- `Cell > Run All Cells`
  - Expected: the whole notebook runs without leaving execution state stuck
- `Edit > Clear Outputs`
  - Expected: all visible cell outputs clear
- `Shift+Enter`
  - Expected: active cell runs and runtime initializes automatically if needed
- `Cmd/Ctrl+Enter`
  - Expected: active cell runs without breaking focus behavior

## Notebook Persistence and Compatibility

- Reload after edits
  - Expected: notebook title, cells, outputs, workspace state, and panel visibility recover from browser storage
- `File > Export Notebook`
  - Expected: a valid `.ipynb` download is produced
- `File > Import Notebook`
  - Expected: an `.ipynb` file imports as a new notebook with code and markdown cells preserved
- `Edit > Clear Recovery`
  - Expected: storage is cleared and the next reload starts fresh

## Workspace and Files

- `File > New File`
  - Expected: a new text file is created in `/workspace`
- `File > New Folder`
  - Expected: a folder placeholder appears in the workspace tree
- `File > Import Files`
  - Expected: one or more local files import into `/workspace`
- Workspace tree selection
  - Expected: selecting a text file opens it in the editor surface
- Sidebar file editor and main file editor
  - Expected: edits stay synchronized between both editors
- `Save File`
  - Expected: the file record updates and remains readable after reload
- `Revert`
  - Expected: unsaved file edits are discarded
- Workspace tree actions
  - Expected: rename, move, duplicate, export, and delete behave correctly
- File filters
  - Expected: notebook and file filters narrow the visible lists without corrupting state

## Launcher and Command Palette

- `File > Launcher`
  - Expected: launcher surface opens
- Launcher `New Notebook`
  - Expected: creates and opens a notebook
- Launcher `Import Notebook`
  - Expected: opens file picker and imports correctly
- Launcher `Import Files`
  - Expected: opens file picker and imports correctly
- Launcher `Open Console`
  - Expected: launcher remains usable and terminal input receives focus
- Launcher runtime report actions
  - Expected: run, copy, and insert flows operate without stale state
- `Cmd/Ctrl+P` quick open / command palette
  - Expected: dialog opens, filtering works, and actions execute the intended operation
- Command-palette mutation actions
  - Expected: notebook, file, watch, and diagnostics actions update UI state immediately

## Runtime and Plotting

- `Kernel > Initialize Runtime`
  - Expected: runtime initializes offline and kernel state updates correctly
- `Kernel > Interrupt Runtime`
  - Expected: interrupt state updates coherently during a run
- `Kernel > Restart Runtime`
  - Expected: page reload behavior is understandable and app recovers cleanly
- `Help > Run Runtime Check`
  - Expected: diagnostics run completes and package statuses update
- `Help > Copy Runtime Report`
  - Expected: a text summary is placed on the clipboard
- `Help > Insert Runtime Report`
  - Expected: a markdown cell is inserted with the latest report
- `Packages` panel demo actions
  - Expected: copy, insert, and run actions work for actually bundled packages
- Multi-cell `matplotlib` workflow
  - Expected: figures render across repeated runs and `plt.show()` does not regress after multiple cells

## Variables, Watch, Debug, Terminal

- Variable viewer refresh after code execution
  - Expected: top-level Python variables appear with sensible summaries
- Variable inspector
  - Expected: selecting a variable shows richer detail without errors
- Watch panel
  - Expected: expressions can be added, edited, evaluated, and removed cleanly
- Cell debug action
  - Expected: debug starts from the intended cell and paused-cell styling is accurate
- Debug controls
  - Expected: continue, step, and stop update both the UI and debug history coherently
- Debug keyboard shortcuts
  - Expected: shortcuts work only in appropriate states
- Terminal command execution
  - Expected: Python console commands run, render output, and do not corrupt notebook execution state
- `Clear` terminal output
  - Expected: terminal history clears without affecting notebook outputs

## View and Layout

- View toggles for `Variables`, `Inspector`, `Watch`, `Debug`, and `Terminal`
  - Expected: panels hide/show reliably from both menus and local hide buttons
- Desktop layout
  - Expected: three-column structure stays intact and the notebook remains dominant
- Narrow layout below `760px`
  - Expected: responsive collapse is usable and no important surface becomes unreachable
- Side-rail density
  - Expected: package/runtime panels do not crowd out workspace tasks
- Launcher readability
  - Expected: recent content and action cards feel understandable without competing with the main workbench

## Defect Logging

For each failure, record:

- area
- exact action
- observed behavior
- expected behavior
- whether it is a regression, polish issue, or blocker

## Exit Rule

Phase 10 verification is complete when every checklist item is either:

- passed
- explicitly deferred with a reason
- converted into a tracked follow-up task
