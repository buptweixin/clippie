# Permissions — the honest version

## macOS (TCC)

Two grants, both held by the signed native sidecar:

1. **Accessibility** — read/write the focused element via AX.
2. **Screen Recording** — trigger-time screenshots for OCR.

First run is a wizard, not a hope: detect (`AXIsProcessTrusted` + test
capture) → deep-link to the exact Settings pane → user grants → **Verify**
button performs a live test read. If verification fails, the feature shows
as unavailable — never silently "working".

## Windows (integrity, not TCC)

No permission prompts, but UIPI blocks writes from a normal-integrity
process into an elevated window. Policy:

- Run `asInvoker`. We deliberately do **not** request uiAccess (requires
  signing + Program Files install; out of scope for the hackathon).
- Detect the target window's integrity level; if elevated, degrade to the
  L3 clipboard adapter and say so in the bubble.

## Privacy posture

- Perception and OCR are local. Only the semantic snapshot (OCR text +
  low-res crop of the active window) is sent to the model, only on trigger.
- Per-app toggles and a global mute are visible in the tray at all times.
- No screenshot is stored after its snapshot is consumed.
