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

## Status

Hackathon scaffold — core loop, adapter interfaces, stuck-state detector and
bubble UI are in `src/`; native sidecars for the accessibility layer are in
`native/`. Demo path is fixed to Word + Google Docs first; see
[demo/storyboard.md](demo/storyboard.md) for the <3-minute demo plan and
[.kiro/specs/clippie/tasks.md](.kiro/specs/clippie/tasks.md) for the build plan.

Submission deadline: **2026-12-04 14:00 PT**.

## Built with

- **Kiro** — spec-driven development: specs in `.kiro/specs/`, product rules
  in `.kiro/steering/`, automation in `.kiro/hooks/`.
  See [docs/kiro-usage.md](docs/kiro-usage.md).
- **Devin** — parallel implementation spikes for the macOS AX sidecar, the
  Windows UIA adapter, and the shared adapter conformance tests.
  See [docs/devin-plan.md](docs/devin-plan.md).

## License

MIT — see [LICENSE](LICENSE).
