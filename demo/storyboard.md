# Demo Storyboard (< 3 minutes — Problem First, Then Live Working Demo)

> Judging alignment (**Presentation** + **Design** + **Tech Implementation**):
> Spend the first 25 seconds making the two-sided problem unmistakable, then run a real, unedited closed-loop demo on screen.

1. **0:00–0:25 — The Problem (Why Clippy Died & Why Chat Sidebars Still Fail).**
   - *Visual*: Split shot — 1997 Clippy interrupting a blank page with generic advice vs. a 2026 writer alt-tabbing between a paper draft, a reference PDF, and a passive AI chat box, copy-pasting context back and forth.
   - *Voiceover*: "1997 Clippy died because it interrupted at the wrong time, gave generic advice, and never learned. Modern AI assistants have the opposite flaw: they're passive chat boxes you have to stop writing to prompt. Writers don't need another chat sidebar — they need an assistant that notices when they're genuinely stuck, offers one finished draft, inserts it in one click, and shuts up when dismissed."

2. **0:25–0:45 — Restraint First (Clean UI & Silence on Normal Work).**
   - *Visual*: Live desktop writing in a real document. Steady typing and normal edits. Tray shows `📎`, bubble stays completely hidden (`npm run demo:loop` / debug telemetry overlay in corner shows `detectStuck -> null`, `0 LLM calls`).
   - *Point*: Restraint is the first feature — zero continuous screen streaming, zero model polling.

3. **0:45–1:35 — The Stuck Moment → One-Click Insertion.**
   - *Visual*: Writing the *Related Work → Method* transition. The same paragraph is rewritten 3× while alt-tabbing to a reference PDF 4×.
   - *Action*: Local detector classifies `missing-transition (conf 0.82)` → macOS Swift sidecar captures a single active-window snapshot (`ScreenCaptureKit` + Apple Vision `< 100 ms` OCR + `dHash` dedupe) → clean non-modal bubble appears with **Section bridge** badge, exact 2-sentence artifact preview, and 3 focused buttons: **[Insert at cursor]** **[Another version]** **[Dismiss]**.
   - Click **Another version** once to show instant re-drafting, then click **Insert at cursor** (`Enter`) — spliced straight into the document at the cursor via L2 `AXUIElement` with snapshot-backed undo.

4. **1:35–2:15 — Closing the Loop (Outcome Learning & 30-Minute Silence).**
   - *Visual*: Writer keeps the bridge and keeps typing past it → `OutcomeObserver` records `kept`, boosting `Word:missing-transition` weight (`1.00 → 1.10`).
   - Next, trigger `blank-page` and click **Dismiss** (`Esc`) 3 times → Clippie surfaces `"Going quiet for 30 minutes on blank-page in Word"` and goes silent.

5. **2:15–2:40 — Honest Capability Degradation (L2 → L3 Paste Fallback).**
   - *Visual*: Focus a window without a writable accessibility tree (or elevated Windows UIPI window). Click **Insert at cursor** → `LayeredDocumentAdapter` falls back cleanly to L3 clipboard paste (saving & restoring the user's clipboard) and displays the amber pill: *"Inserted by paste — this window doesn't expose a writable accessibility tree."*

6. **2:40–2:55 — Classic '97 Toggle & Kiro Wrap-up.**
   - *Visual*: Toggle `'97` mode for 6 seconds (*"It looks like you're trying to write a document…"*), toggle OFF. Flash `.kiro/specs/`, `.kiro/steering/`, and `.kiro/hooks/spec-check.kiro.hook` passing in CI.
   - *Close*: "Clippie — dead software, back with a multimodal brain, real OS execution, and manners."
