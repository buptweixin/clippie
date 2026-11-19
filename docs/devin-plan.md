# How Devin is used — three parallel spikes

Devin's job is the unglamorous platform work, split into three independent
spikes with explicit acceptance criteria, run in parallel sessions:

1. **macOS spike** — Swift sidecar: AX read of focused element/selection,
   set-value writes. *Acceptance:* read → insert → undo in TextEdit and Word.
2. **Windows spike** — C# UI Automation TextPattern implementation of the
   same four DocumentAdapter methods. *Acceptance:* the shared conformance
   suite passes on a Windows CI runner.
3. **Shared layer** — L3 clipboard adapter hardening, the permission state
   machine, and the cross-platform conformance test fixtures (one suite,
   both platforms must pass).

Each spike is timeboxed and degrades independently: if L2 stalls on one
platform, L1 + L3 still demo. That parallelism — three platform lines at
once instead of one developer serially fighting AX and UIA — is what makes
the 2026-12-04 deadline reachable.
