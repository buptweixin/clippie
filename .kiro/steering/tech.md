# Steering — tech rules

- TypeScript strict mode everywhere in `src/`; native code only inside
  `native/` sidecars behind the DocumentAdapter interface.
- No continuous screen capture, ever. Screenshots are trigger-time, active
  window only, cropped before OCR.
- Every document mutation is snapshot-backed and undoable.
- LLM calls are async and debounced; the typing path never blocks on them.
- Adapter conformance tests are the contract: a platform implementation is
  "done" only when the shared suite passes on its CI runner.
