# Architecture

## The loop

Perception is **event-driven, never polling**. The local daemon subscribes to
focus changes, edit events and idle timers. A screenshot exists only in the
moment a trigger fires, of the active window only, cropped before OCR.
On-device OCR (Apple Vision / Windows OCR) plus a perceptual hash (to dedupe
near-identical snapshots) produce a *semantic snapshot*: OCR text + a low-res
crop. Only that snapshot goes to the multimodal model, asynchronously and
debounced — the typing path never blocks on a model call. Target local
latency: < 100 ms for OCR; the bubble appears when the model answers, never
as a modal.

## Execution layers

| Level | Mechanism | Can read | Can write | Failure mode |
|---|---|---|---|---|
| L1 | Office JS (Word), Docs browser extension, VS Code extension API | cursor, selection, doc structure | insert/replace at cursor | app not supported → L2 |
| L2 | macOS AXUIElement / Windows UI Automation | focused element, selection, text | set value where the tree allows | tree read-only or target elevated (Windows UIPI) → L3 |
| L3 | Clipboard + synthetic paste | via OCR only | paste at cursor (clipboard saved & restored) | always works; undo is the host app's own stack |

Every insert is snapshot-backed where the level supports it, and any
degradation is surfaced in the bubble ("Inserted by paste — this window
doesn't expose a writable accessibility tree").

## Feedback

After an insert, the loop observes the outcome window (~30 s):
kept-and-written-past → weight ↑ · deleted → weight ↓ · heavily edited →
neutral (engagement counts) · dismissed ×3 → 30 min silence + threshold ↑.
Weights are per stuck-type and per app; they are the difference between an
assistant and an interruption machine.
