# Clippie

> *It looks like you're trying to write a document...*

**Clippie** resurrects the discontinued Microsoft Office assistant (1997–2007) as a
modern multimodal desktop companion — built for the **Kiroween 2026** hackathon,
Resurrection track.

Same nostalgic paperclip and speech-bubble UI. Completely different brain: a
multimodal LLM that can see and understand what's on your screen and in your
document, and — unlike the original — knows when to act, when to offer, and
when to shut up.

## What it actually does

Clippie is not a chatbot in the corner. It runs a closed agent loop:

1. **Observe** — cheap, local, event-driven signals only: focus/window changes,
   document edits, idle time at the same paragraph, repeated rewrites of the
   same sentence, switching between a draft and a reference PDF. No continuous
   screen streaming.
2. **Decide** — classify the stuck state (no outline, missing transition,
   missing citation, blank-page paralysis). If confidence is low, do nothing.
3. **Act** — offer a *finished artifact*, not advice: a two-sentence transition
   paragraph with citation placeholders, a summary of the paragraph you just
   read, an outline for the next section. One click inserts it at your cursor
   in the real document — via app APIs, accessibility APIs, or a clipboard
   fallback (see [docs/permissions.md](docs/permissions.md)).
4. **Learn** — watch what you do with it. Kept and written past = positive
   signal. Deleted or heavily edited = negative signal. Dismissed three
   times = 30 minutes of silence and a higher intervention threshold.

The original Clippy died because it only did step 3 badly, at the wrong time,
with no step 4. Clippie is the fix.

An optional **classic mode** recreates the original's overly eager personality
— for nostalgia, and for the demo video.

## Architecture

```
┌────────────────┐  events   ┌──────────────────┐  snapshot  ┌───────────────┐
│ Perception     │ ────────► │ Agent loop       │ ─────────► │ Multimodal    │
│ (local daemon) │           │ observe→decide→  │  (OCR text │ LLM (remote)  │
│ triggers, OCR, │ ◄──────── │ act→learn        │   + crop)  │               │
│ hash dedupe    │  outcome  └───────┬──────────┘            └───────────────┘
└────────────────┘                   │ execute
                                     ▼
                          ┌──────────────────────┐
                          │ DocumentAdapter      │
                          │ L1 app APIs          │
                          │ L2 accessibility API │
                          │ L3 clipboard fallback│
                          └──────────────────────┘
```

- **Perception is local and cheap**: on-device OCR (Apple Vision / Windows
  OCR), perceptual-hash dedupe, screenshots only on trigger — never a stream.
- **Reasoning is remote**: only a semantic snapshot (OCR text + a low-res crop
  of the active window) leaves the machine, async and debounced.
- **Execution is layered**: L1 app-specific APIs (Office JS, Google Docs via
  browser extension, VS Code extension API) → L2 OS accessibility APIs
  (macOS AXUIElement, Windows UI Automation) → L3 clipboard paste fallback
  that always works. See [docs/architecture.md](docs/architecture.md).

## Quick Verify (Judges & Developers)

```bash
npm install --ignore-scripts
npm run spec:check   # Verify .kiro/specs & .kiro/steering invariants
npm test             # Run Vitest unit + cross-platform adapter conformance suite
npm run demo:loop    # Run the 4-act closed agent loop walkthrough in terminal
```

On macOS, build the native `AXUIElement` + `ScreenCaptureKit` + Apple Vision sidecar with:

```bash
npm run build && npm run sidecar:build:mac
```

## Status

Core closed agent loop, perceptual-hash snapshot deduper, outcome tracker, layered `L1 → L2 → L3` execution orchestrator, clean non-modal 3-action bubble UI, macOS Swift AX/Vision sidecar, and Windows C# UIA/UIPI helper are implemented and verified in CI (`.github/workflows/ci.yml`).
See [demo/storyboard.md](demo/storyboard.md) for the <3-minute problem-first demo script, [docs/devpost-submission.md](docs/devpost-submission.md) for the submission write-up, and [.kiro/specs/clippie/tasks.md](.kiro/specs/clippie/tasks.md) for the milestone checklist.

Submission deadline: **2026-12-04 14:00 PT** (2026-12-05 06:00 UTC+8).

## Built with

- **Kiro** — spec-driven development: specs in `.kiro/specs/`, always-on product & tech guardrails in `.kiro/steering/`, executable hooks in `.kiro/hooks/` + `scripts/spec-check.mjs`.
  See [docs/kiro-usage.md](docs/kiro-usage.md).
- **Devin** — parallel implementation spikes for the macOS AX sidecar, the
  Windows UIA adapter, and the shared adapter conformance tests.
  See [docs/devin-plan.md](docs/devin-plan.md).

## License

MIT — see [LICENSE](LICENSE).
