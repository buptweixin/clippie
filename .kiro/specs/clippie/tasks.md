# Tasks — Clippie build plan (deadline 2026-12-04 14:00 PT)

## Milestone 1 — Loop skeleton (demoable without OS access)
- [x] Repo scaffold, specs, steering
- [x] Stuck detector over synthetic event streams + unit tests
- [x] Agent loop with thresholds, silence window, feedback weights
- [x] Bubble UI (non-modal, 3 actions) wired to the loop
- [x] Mock DocumentAdapter + end-to-end loop test

## Milestone 2 — Execution layer (parallel spikes, see docs/devin-plan.md)
- [x] L3 clipboard adapter (save/restore user clipboard, paste at cursor)
- [x] Layered DocumentAdapter fallback orchestrator (`src/adapters/LayeredDocumentAdapter.ts`)
- [ ] L1 Google Docs path (browser extension content script)
- [ ] L1 Word path (Office JS add-in spike)
- [ ] macOS spike: Swift sidecar, AX read focused element/selection, set value + undo + NDJSON stdio bridge (`native/macos/Sidecar.swift`, `src/adapters/SidecarDocumentAdapter.ts`)
      — acceptance: read→insert→undo in TextEdit and Word
- [ ] Windows spike: C# UIA TextPattern + UIPI check (`native/windows/Program.cs`), same four adapter methods
      — acceptance: same conformance suite as macOS
- [x] Adapter conformance test suite (`tests/adapterConformance.ts`) running on macOS + Windows CI (`.github/workflows/ci.yml`)

## Milestone 3 — Perception & permissions
- [ ] Trigger-time screenshot + on-device OCR (macOS ScreenCaptureKit + Apple Vision in `native/macos/Sidecar.swift`; Windows OCR pending)
- [x] Perceptual-hash dedupe of snapshots (`src/perception/perceptualHash.ts`)
- [x] Permission wizard: macOS TCC detection + guided grant + live test read (`src/main/permissions.ts`)
- [x] Windows integrity-level detection → honest L3 fallback messaging (`native/windows/Program.cs`, `src/main/permissions.ts`)

## Milestone 4 — Submission
- [x] Classic mode toggle (`src/agent/loop.ts`, `src/main/main.ts`, `src/renderer/bubble.ts`)
- [ ] Demo video < 3 min per demo/storyboard.md, public YouTube
- [x] Devpost submission text (`docs/devpost-submission.md`, `docs/kiro-usage.md`)
- [x] Launch post (`docs/launch-post.md`)
