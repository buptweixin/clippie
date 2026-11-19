# Tasks — Clippie build plan (deadline 2026-12-04 14:00 PT)

## Milestone 1 — Loop skeleton (demoable without OS access)
- [x] Repo scaffold, specs, steering
- [x] Stuck detector over synthetic event streams + unit tests
- [x] Agent loop with thresholds, silence window, feedback weights
- [x] Bubble UI (non-modal, 3 actions) wired to the loop
- [ ] Mock DocumentAdapter + end-to-end loop test

## Milestone 2 — Execution layer (parallel spikes, see docs/devin-plan.md)
- [ ] L3 clipboard adapter (save/restore user clipboard, paste at cursor)
- [ ] L1 Google Docs path (browser extension content script)
- [ ] L1 Word path (Office JS add-in spike)
- [ ] macOS spike: Swift sidecar, AX read focused element/selection, set value
      — acceptance: read→insert→undo in TextEdit and Word
- [ ] Windows spike: C# UIA TextPattern, same four adapter methods
      — acceptance: same conformance suite as macOS
- [ ] Adapter conformance test suite running on macOS + Windows CI

## Milestone 3 — Perception & permissions
- [ ] Trigger-time screenshot + on-device OCR (Apple Vision / Windows OCR)
- [ ] Perceptual-hash dedupe of snapshots
- [ ] Permission wizard: macOS TCC detection + guided grant + live test read
- [ ] Windows integrity-level detection → honest L3 fallback messaging

## Milestone 4 — Submission
- [ ] Classic mode toggle
- [ ] Demo video < 3 min per demo/storyboard.md, public YouTube
- [ ] Devpost submission text (docs/kiro-usage.md as the Kiro-usage section)
- [ ] Launch post (docs/launch-post.md)
