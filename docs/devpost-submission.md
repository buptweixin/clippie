# Devpost Submission — Clippie (Kiroween 2026 · Resurrection Track)

> *Dead software, resurrected with a multimodal brain, layered OS execution, and manners.*

---

## 1. Inspiration & The Problem

Microsoft's original Office Assistant ("Clippy", 1997–2007) became infamous because it got three things wrong:
1. **Bad timing** — it interrupted steady work based on brittle keyword rules.
2. **Advice instead of work** — *"It looks like you're writing a letter"* told you what you already knew instead of drafting the hard paragraph.
3. **Zero memory** — dismissing it ten times never taught it to back off.

Twenty years later, modern AI assistants have the **exact opposite problem**: they are powerful, but trapped inside passive chat sidebars. When a researcher gets stuck bridging *Related Work* to *Method* while cross-referencing a PDF, they have to stop writing, copy paragraphs into a chat box, prompt-engineer a transition, copy the output back, and fix formatting.

**Clippie** resurrects the iconic desktop paperclip to solve that gap — keeping the nostalgic, lightweight companion form factor while replacing its brain with an event-driven, closed-loop multimodal agent.

---

## 2. What It Does & Potential Impact

Clippie runs quietly in the system tray alongside Word, Google Docs, TextEdit, or editors and executes a four-stage closed loop:

1. **Observe (Local & Cheap)**: Watches lightweight local signals — long idle on a blank page, rewriting the same paragraph 3+ times, bouncing 4+ times between a draft and a reference PDF, or dwelling on a selected passage. **Zero continuous screen recording; zero background LLM polling.**
2. **Decide (Restraint by Default)**: Classifies five real writing bottlenecks (`blank-page`, `missing-transition`, `missing-citation`, `needs-summary`, `no-outline`) weighted by per-app, per-task user history and a 64-bit perceptual hash (`dHash` / `SimHash`) snapshot deduper so unchanged windows never re-trigger model calls.
3. **Act (Finished Artifacts, 1-Click Insert)**: Offers **one finished, directly insertable draft** (never conversational filler) in a clean, non-modal bubble with three actions: **Insert at cursor**, **Another version**, or **Dismiss**. One click (or `Enter`) splices the text straight into the real document at the cursor.
4. **Learn (Feedback Closes the Loop)**: Over the next 30 seconds, `OutcomeObserver` checks what the writer actually did with the inserted text. Kept and written past → boosts weight; deleted → lowers weight; **3 consecutive dismissals → 30 minutes of automatic silence** for that stuck type in that app.

**Potential Impact**: Knowledge workers spend hours each week stalled at micro-friction points (transitions, citation anchors, summarizing a dense PDF paragraph) where opening a chatbot breaks flow. Clippie turns AI assistance from *context-switching conversation* into *ambient, respectful, one-click execution*.

---

## 3. Technological Implementation

- **Event-Driven Perception & On-Device OCR (`src/perception/`, `native/macos/Sidecar.swift`)**:
  - When (and only when) `detectStuck()` fires above threshold, the macOS Swift sidecar captures the single frontmost window via `ScreenCaptureKit` (`SCScreenshotManager`), runs Apple Vision `VNRecognizeTextRequest` (`.fast`, `< 100 ms`), computes a 64-bit `9×8` horizontal-gradient `dHash`, encodes a low-res JPEG crop in memory, and immediately frees the image — **no screenshot ever touches disk**.
  - `SnapshotDeduper` (`src/perception/perceptualHash.ts`) suppresses near-identical snapshots within Hamming distance `<= 5` bits.
- **Layered OS Execution with Honest Degradation (`src/adapters/`)**:
  - `LayeredDocumentAdapter` orchestrates **L1** (app-specific APIs) → **L2** (OS accessibility trees: macOS `AXUIElement` in Swift, Windows UI Automation `TextPattern`/`ValuePattern` in C# `.NET 8`) → **L3** (`ClipboardAdapter` saving the user's clipboard, synthesizing `Cmd+V`/`Ctrl+V`, and restoring the original clipboard even on error).
  - Every L2 mutation is backed by an in-memory `SnapshotStore` returning an `undoToken` that restores exact pre-insert text and cursor range.
  - On Windows (`native/windows/Program.cs`), Win32 `OpenProcessToken` + `TokenIntegrityLevel` detects UIPI-elevated target windows while running `asInvoker`, degrading cleanly to L3 paste and displaying an explicit amber capability note in the bubble.
- **Permission Verification State Machine (`src/main/permissions.ts`)**:
  - `MacPermissionWizard` deep-links to the exact macOS Privacy pane and refuses to mark permissions `verified` until a live `AX` + `ScreenCaptureKit` test read succeeds.
- **Cross-Platform Conformance & CI (`.github/workflows/ci.yml`, `tests/adapterConformance.ts`)**:
  - A shared 54+ test suite (Vitest) plus native builds (`swiftc` on `macos-latest`, `dotnet build` on `windows-latest`) verify every adapter, perceptual hash, outcome classifier, and Kiro steering invariant on every push.
  - Anyone can verify the full 4-act closed loop locally in one command: `npm run demo:loop`.

---

## 4. Design — Simple, Focused, Intuitive

Clippie's UI (`src/renderer/bubble.html`, `src/renderer/bubble.ts`) is deliberately **anti-chatbot**:
- **Zero chat input, zero message history**: One compact floating card (`348px` max) with a minimal vector paperclip mark, a human-readable task badge (*Section bridge*, *Passage summary*), a clean document-preview card showing the exact text to be inserted, and **three clear actions** (`Insert at cursor` / `Another version` / `Dismiss`) with `Enter` and `Esc` keyboard shortcuts.
- **Transparent state**: When L2 degrades to L3 paste or when 3 dismissals trigger a 30-minute quiet window, Clippie states it plainly in one line instead of failing silently.
- **Opt-in `'97` Classic Mode**: Nostalgic eager Clippy lives behind an explicit toggle for fun — never polluting the default restrained experience.

---

## 5. How We Used Kiro (Specs, Steering & Hooks)

*(Full engineering breakdown in [`docs/kiro-usage.md`](kiro-usage.md); all `.kiro/` artifacts are committed in the repo.)*

- **Specs (`.kiro/specs/clippie/{requirements,design,tasks}.md`)**: Decomposed OS accessibility risk into four milestones, establishing the `DocumentAdapter` L1/L2/L3 contract and native sidecar boundary before writing platform code so Milestone 1 (`MockDocumentAdapter` + `AgentLoop`) ran end-to-end from day one.
- **Steering (`.kiro/steering/product.md` & `tech.md`)**: Acted as permanent architectural guardrails across every generation — banning conversational *"You could try…"* advice in `modelClient.ts`, capping the bubble at 3 buttons with zero chat inputs, banning continuous screen capture, and requiring snapshot-backed `undoToken` support.
- **Hooks (`.kiro/hooks/on-save-summary.kiro.hook` & `spec-check.kiro.hook` + `scripts/spec-check.mjs`)**:
  - `on-save-summary` stages summary artifacts on Markdown saves without auto-inserting into user files (honoring our own restraint rule).
  - `spec-check` runs `scripts/spec-check.mjs` locally and in GitHub Actions CI, parsing `.kiro/specs/clippie/tasks.md` and `src/`/`native/` to verify automatically that completed tasks point to real files, `bubble.html` still has exactly 3 buttons and 0 chat inputs, and native sidecars contain zero continuous screen-streaming APIs.
