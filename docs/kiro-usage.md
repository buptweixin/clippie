# How Kiro Shaped Clippie (Specs, Steering & Hooks)

Clippie was built spec-first inside `.kiro/` (never gitignored). Rather than treating Kiro as a one-off code generator, we used **Specs** to decompose cross-OS risk, **Steering** to enforce product restraint and privacy invariants on every edit, and **Hooks** to automate artifact staging and spec-to-code verification.

---

## 1. Specs (`.kiro/specs/clippie/`) — Architectural Decomposition Before Code

Resurrecting Clippy as an OS-wide desktop agent has a classic hackathon trap: spending all week fighting macOS TCC permissions and Windows UIPI elevation before proving the core agent loop works.

- **[requirements.md](../.kiro/specs/clippie/requirements.md)** locked down six testable functional requirements and strict non-functional bounds (`< 100 ms` local OCR, trigger-only window crops, snapshot-backed undo, 3 dismissals → 30-minute silence).
- **[design.md](../.kiro/specs/clippie/design.md)** translated those requirements into two key boundaries:
  1. A unified `DocumentAdapter` contract (`getContext`, `getSelection`, `insertAtCursor`, `undo`, `observeOutcome`) across **L1** (app APIs), **L2** (macOS `AXUIElement` / Windows UI Automation), and **L3** (clipboard paste with save/restore).
  2. Strict separation between Electron's main process (UI + tray only) and native sidecars (`native/macos/Sidecar.swift`, `native/windows/Program.cs`) that hold OS permissions.
- **[tasks.md](../.kiro/specs/clippie/tasks.md)** sequenced the build into four milestones so Milestone 1 (`MockDocumentAdapter` + `AgentLoop` + shared `adapterConformance.ts`) was 100% green and runnable before touching native APIs.

---

## 2. Steering (`.kiro/steering/`) — Guardrails That Prevented "Chatbot Drift"

Every AI coding session naturally drifts toward adding a chat input box, streaming screenshots, or hiding OS failures behind silent fallbacks. Our two always-on steering files stopped all three:

- **[product.md](../.kiro/steering/product.md)** (*Restraint is the brand*):
  - **Artifacts, not advice**: shaped the system prompt in `src/agent/modelClient.ts` so the model returns strictly insertable JSON (`{ text, rationale }`), never *"You could try…"*.
  - **Three actions max**: constrained `src/renderer/bubble.html` to `[Insert at cursor]`, `[Another version]`, and `[Dismiss]` with zero free-text chat inputs.
  - **Dismissals are data**: drove the per-app, per-stuck-type weight decay and 30-minute silence window in `src/agent/loop.ts`.
  - **Honesty about capability**: forced `LayeredDocumentAdapter` and both native sidecars to surface an explicit amber `degradationNote` whenever Windows UIPI or a read-only AX tree forces L3 paste fallback.
- **[tech.md](../.kiro/steering/tech.md)** (*Hard technical constraints*):
  - **No continuous screen capture, ever**: in `native/macos/Sidecar.swift`, `SCScreenshotManager.captureImage` fires only when a stuck trigger hits, crops to the frontmost window, computes a 64-bit `dHash` + Apple Vision `.fast` OCR in memory, and discards the `CGImage` without touching disk.
  - **Snapshot-backed mutations**: required `SnapshotStore` in `Sidecar.swift` and `Program.cs` so every L2 insertion returns an `undoToken` capable of restoring exact pre-insert text and cursor selection.
  - **Conformance suite as Definition of Done**: `tests/adapterConformance.ts` runs the exact same contract tests against `MockDocumentAdapter`, `SidecarDocumentAdapter`, and `LayeredDocumentAdapter` on macOS and Windows CI.

---

## 3. Hooks (`.kiro/hooks/`) — Restraint-Preserving Automation & CI Invariants

- **[on-save-summary.kiro.hook](../.kiro/hooks/on-save-summary.kiro.hook)**: triggers when Markdown drafts in `demo/` or `docs/` are saved, staging a concise two-sentence `needs-summary` artifact candidate. Crucially, the hook obeys `.kiro/steering/product.md` — it **stages** a suggestion and never auto-mutates the user's file.
- **[spec-check.kiro.hook](../.kiro/hooks/spec-check.kiro.hook)** + **[scripts/spec-check.mjs](../scripts/spec-check.mjs)**: runs `npm run spec:check && npm run typecheck && npm test` (also enforced in `.github/workflows/ci.yml` on both macOS and Windows). `spec-check.mjs` parses `.kiro/specs/clippie/tasks.md` and `.kiro/steering/*` to verify programmatically that:
  1. Every file cited in `[x]` completed tasks exists in the repository.
  2. `bubble.html` still has **exactly 3 action buttons** and **zero chat inputs**.
  3. Neither native sidecar imports continuous screen-streaming APIs (`CGDisplayStream` / live `SCStream`).
