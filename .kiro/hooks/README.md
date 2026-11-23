# Kiro hooks

Hooks live here as the automation evidence for the Kiroween submission.
Planned hooks (implemented as the build progresses):

- **on-save-summary** — when a document in the demo workspace is saved,
  generate a one-paragraph summary suggestion and stage it (never insert
  automatically; staging only, per the restraint rule in steering).
- **spec-check** — on commit, verify that `.kiro/specs/clippie/tasks.md`
  checkboxes match the PR description's claimed milestone.

Hook definitions live next to this README:
- `on-save-summary.kiro.hook`
- `spec-check.kiro.hook`

`.kiro/` is intentionally NOT listed in `.gitignore`.
