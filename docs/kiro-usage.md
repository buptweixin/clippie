# How Kiro was used

- **Specs** — `.kiro/specs/clippie/` holds requirements / design / tasks for
  the whole build; the task list is the project's single source of truth and
  the demo path (Word + Google Docs, deadline 2026-12-04 PT) is fixed there.
- **Steering** — `.kiro/steering/product.md` encodes the product's core rule
  (restraint: artifacts not advice, three actions max, dismissals are data)
  so every generated change inherits it; `.kiro/steering/tech.md` encodes
  the hard technical constraints (no continuous capture, snapshot-backed
  mutations, adapter conformance as the definition of done).
- **Hooks** — `.kiro/hooks/` documents the planned automation (save-time
  summary staging, spec/task consistency check). Hooks stage suggestions;
  they never insert into a user's document automatically.
