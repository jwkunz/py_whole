# Py-Whole

Offline browser notebook workbench packaged for static hosting and single-file release.

## Project Summary

Py-Whole is a browser-based Python notebook environment built around Pyodide. The project now supports two delivery shapes:

- `dist/py_whole.html`
  Single-file offline release with embedded runtime assets
- `dist/py_whole_web/`
  Static web package with normal served files suitable for a conventional static host

The current app includes:

- notebook code and markdown cells
- `.ipynb` import and export
- project file tree with notebook-backed `.ipynb` files
- text-file editing, rename, move, duplicate, delete, and export flows
- offline Pyodide execution with bundled scientific packages
- explicit package loading from the UI
- variable inspection and terminal surfaces
- experimental debug mode
- startup splash screen, help/legal dialogs, version footer, and branded UI

## Current Build Paths

Build the single-file release:

```bash
bash scripts/build_single_html.sh
```

Build the lightweight debug single-file release:

```bash
bash scripts/build_debug_release.sh
```

Build the static web package for hosting:

```bash
bash scripts/build_static_web_package.sh
```

## Current Status

The project is beyond proof-of-concept. Core notebook, workspace, runtime, packaging, and hosting flows are implemented.

The most notable recent progress:

- notebook/workspace save behavior shifted from constant autosave to explicit save
- destructive deletes persist immediately
- `.ipynb` import, rename, and delete behavior were aligned with the workspace model
- offline `tqdm` and additional Pyodide packages were bundled
- syntax highlighting was added with a blur-state preview compromise
- startup branding, footer, help, and legal content were added
- a static-hostable package format was added for website deployment
- debugger work advanced substantially, but it is still intentionally framed as experimental rather than a full debugger

## Current Constraints

- most product logic still lives in `src/app.js`
- the experimental debugger is useful for lightweight breakpoint-oriented inspection, but it is not yet a full IDE-class debugger
- runtime restart still reloads the page
- local browser behavior, storage, and static-host MIME handling still matter for deployment validation

## Repo Notes

- version is sourced from `VERSION`
- the primary source files live in `src/`
- build scripts live in `scripts/`
- packaged outputs live in `dist/`
