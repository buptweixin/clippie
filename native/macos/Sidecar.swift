// Clippie macOS sidecar — scaffold entry point.
//
// Owns the TCC grants (Accessibility + Screen Recording) and implements
// the L2 DocumentAdapter operations over a local socket:
//   - AXUIElement: read focused element / selection / text, set value
//   - Trigger-time screenshot of the active window + Vision OCR
//
// Acceptance (Milestone 2): read → insert → undo in TextEdit and Word,
// verified by the shared adapter conformance suite.

import ApplicationServices
import Foundation

@main
struct ClippieSidecar {
    static func main() {
        let trusted = AXIsProcessTrusted()
        FileHandle.standardError.write(
            "clippie-sidecar: accessibility trusted = \(trusted)\n".data(using: .utf8)!
        )
        // Socket server + AX observers land in the macOS spike
        // (see docs/devin-plan.md, spike 1).
        RunLoop.main.run()
    }
}
