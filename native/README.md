# Native sidecars

OS-level access lives here, never in the Electron main process.

## macos/ — Swift sidecar
- Owns the TCC grants (Accessibility + Screen Recording) as a signed,
  notarized helper.
- AXUIElement / AXObserver: read the focused element, selection and text;
  set value where the tree allows it (L2 adapter).
- Trigger-time screenshot of the active window + Apple Vision OCR.
- Speaks to the main process over a local socket with the four
  DocumentAdapter operations.

## windows/ — C# helper
- UI Automation TextPattern implementation of the same four operations.
- Runs asInvoker; detects target-window integrity and reports
  `degraded-clipboard-only` for elevated windows (see
  `src/main/permissions.ts`).
- Windows OCR for the trigger-time snapshot.

Both sidecars are "done" only when the shared adapter conformance suite
passes against them — see `.kiro/specs/clippie/tasks.md`, Milestone 2.
