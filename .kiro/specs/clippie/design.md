# Design — Clippie

## Components

| Component | Lives in | Responsibility |
|---|---|---|
| Perception daemon | `src/perception/` + native sidecars | Focus/edit/idle events, trigger-time screenshot, on-device OCR, perceptual-hash dedupe |
| Stuck detector | `src/perception/stuckDetector.ts` | Signal window → stuck-state classification with confidence |
| Agent loop | `src/agent/loop.ts` | observe → decide → act → learn; owns thresholds, silence windows, feedback weights |
| DocumentAdapter | `src/adapters/` | Unified `getContext / getSelection / insertAtCursor / observeChanges`; L1/L2/L3 implementations with graceful degradation |
| Bubble UI | `src/renderer/` | Non-modal paperclip bubble; three actions only: Insert / Another / Dismiss |
| Permission wizard | `src/main/permissions.ts` | TCC (macOS) / integrity-level (Windows) detection and guided grant flow |

## Key decisions

1. **Event-driven, never polling the model.** The VLM is called only when the
   stuck detector fires, with a semantic snapshot (OCR text + low-res crop).
2. **Layered execution with honest degradation.** If L2 cannot write to a
   window (e.g. a high-integrity Windows window), fall back to L3 clipboard
   and *say so in the bubble* — never silently pretend.
3. **Feedback is the product.** The keep/delete/dismiss outcome of every
   intervention is a first-class signal that tunes future interventions.
4. **Native sidecars own OS access.** Electron's main process never touches
   AX/UIA directly; a signed Swift sidecar (macOS) and a C# helper (Windows)
   do, so TCC grants and integrity behaviour stay predictable.

## Data flow (writing-a-paper example)

User rewrites the same transition sentence 3× and alt-tabs to a reference PDF
4× → detector classifies `missing-transition` (conf 0.82) → agent builds a
snapshot (current section text + OCR of the PDF paragraph last viewed) →
model returns a 2-sentence bridge with citation placeholders → bubble offers
it → user clicks Insert → adapter writes it at the cursor (snapshot saved
for undo) → loop observes the next 30 s: user keeps writing past it →
positive feedback recorded for `missing-transition` in this document type.
