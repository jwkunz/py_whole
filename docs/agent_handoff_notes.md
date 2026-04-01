# Agent Handoff Notes

## Current UI Shape

- The app now uses a true three-region workbench:
  - left rail: workspace and file management
  - center: notebook document and cells
  - right rail: session, variables, properties, watch, and help
- `Debug` and `Terminal` were moved out of the right rail and now render as bottom utility panels below the notebook document.
- `Packages` and `Runtime` were moved into the left rail.
- The notebook header now uses a top menubar with pull-down menus instead of visible button strips.
- The old hidden command-mirror system was removed. Visible controls are wired directly.

## Important Implementation Notes

- Main logic is still concentrated in `src/app.js`.
- The previous `wireCommandMirrors()` mechanism is gone. There are no remaining `data-command` attributes in `src/index.html`.
- Every `getElementById(...)` reference in `src/app.js` now points to a real DOM node in `src/index.html`.
- `updateActiveCellToolbar()` now only updates the active-cell indicator text. It no longer manages removed run-scope buttons.
- Status fields shown in the notebook header are:
  - `kernel-state`
  - `execution-state`
  - `interrupt-state`
  - `save-state`
- Those status updates are now null-safe in JS to avoid bootstrap failures during future layout refactors.

## Interaction Model

- Clicking a cell selects it even if the textarea is not focused.
- Per-cell execution remains on the cell itself via the compact run button and overflow menu.
- Top menubar cell actions currently provide:
  - `Run Cell`
  - `Run Above`
  - `Run Below`
  - `Run All Cells`
- `Shift+Enter` and `Cmd/Ctrl+Enter` still initialize the runtime automatically if needed.

## Layout Constraints To Preserve

- Desktop and normal laptop widths should remain in the three-column layout.
- Responsive collapse now happens only below `760px`.
- The center notebook column should remain visually dominant over both side rails.

## Runtime Notes

- Pyodide remains embedded and offline.
- `plt.show()` mitigation is still implemented by:
  - patching `plt.show`
  - patching `Figure.show`
  - reapplying the matplotlib patch inside `_pywhole_run_cell`
- This still needs verification with a multi-cell plotting workflow.

## What Still Needs Verification

1. Verify all top-menubar actions after the direct-wiring cleanup:
   - file actions
   - kernel actions
   - cell actions
   - help/runtime actions
2. Verify `Debug` and `Terminal` bottom panels behave well after moving them out of the right rail.
3. Verify `Packages` and `Runtime` controls still make sense in the left rail and do not crowd file management.
4. Re-test `.ipynb` import/export and workspace file import after removing the hidden legacy controls.
5. Re-test `plt.show()` across multiple cells.

## Suggested Next UX Pass

- Tighten notebook typography and vertical density in the center column.
- Reduce decorative framing in the side rails further.
- Decide whether `Watch` should stay in the right rail or move into the bottom utility area with `Debug`.
- Consider whether the launcher should be visually simplified now that the main workbench is much closer to the target interaction model.

## Last Relevant Commit Before Next Work

- Working tree after menubar refactor, three-column layout cleanup, and direct event wiring.
