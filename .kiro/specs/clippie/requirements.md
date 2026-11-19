# Requirements — Clippie (Kiroween 2026, Resurrection)

## Problem

The original Office assistant interrupted at the wrong time, with generic
advice, and never learned. Modern AI assistants have the opposite problem:
they are powerful but passive — a chat box the user must remember to ask.

## Users

Writers and researchers working in Word / Google Docs / VS Code who get stuck
mid-document: transitions, summaries of material they just read, outlines,
blank-page starts.

## Functional requirements

1. Detect stuck states from observable signals only (idle at a paragraph,
   repeated rewrites, draft↔reference switching, long selection dwell).
2. On a confident stuck detection, offer ONE finished artifact in a
   non-modal bubble: [Insert at cursor] [Another version] [Dismiss].
3. Execute insertion into the real document through the layered
   DocumentAdapter (L1 app API → L2 accessibility API → L3 clipboard).
   Every insertion is snapshot-backed and undoable.
4. Record the outcome (kept / edited / deleted / dismissed) and adapt:
   3 dismissals → 30 min silence, higher threshold.
5. Classic mode: opt-in recreation of the original's eager personality.
6. Permission onboarding: detect accessibility / screen-recording grants,
   guide the user to the exact system settings page, verify with a live
   test read before claiming the feature works.

## Non-functional requirements

- No continuous screen capture. Screenshots only on trigger, active window
  only, cropped.
- Local OCR < 100 ms; LLM calls async, debounced, never blocking typing.
- All perception local except the semantic snapshot sent to the model.
- Demo path (Word + Google Docs) must work end-to-end by 2026-12-04 PT.
