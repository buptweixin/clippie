// Clippie macOS sidecar — demo core.
//
// Owns the TCC grants (Accessibility + Screen Recording) and implements
// the L2 DocumentAdapter operations for the frontmost app:
//   - read the focused element's text and selection via AXUIElement
//   - insert at the cursor by setting the AX value around the selection
//   - fall back to clipboard + synthetic Cmd-V when the AX tree of the
//     target app is not writable (the L3 path, used honestly)
//
// Acceptance (Milestone 2): read → insert → undo in TextEdit and Word,
// verified by the shared adapter conformance suite.

import ApplicationServices
import AppKit
import Foundation

// MARK: - AX helpers

func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        system, kAXFocusedUIElementAttribute as CFString, &ref
    ) == .success, let ref else { return nil }
    return (ref as! AXUIElement)
}

func stringAttr(_ el: AXUIElement, _ attr: String) -> String? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success
    else { return nil }
    return ref as? String
}

func selectedRange(_ el: AXUIElement) -> CFRange? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        el, kAXSelectedTextRangeAttribute as CFString, &ref
    ) == .success, let ref else { return nil }
    var range = CFRange()
    AXValueGetValue(ref as! AXValue, .cfRange, &range)
    return range
}

// MARK: - DocumentAdapter (L2) operations

/// getContext + getSelection: text around the cursor in the focused element.
func readContext() -> (before: String, selected: String, after: String)? {
    guard let el = focusedElement(),
          let value = stringAttr(el, kAXValueAttribute),
          let range = selectedRange(el) else { return nil }
    let ns = value as NSString
    let loc = max(0, min(range.location, ns.length))
    let len = max(0, min(range.length, ns.length - loc))
    let beforeStart = max(0, loc - 2000)
    let afterEnd = min(ns.length, loc + len + 500)
    return (
        before: ns.substring(with: NSRange(location: beforeStart, length: loc - beforeStart)),
        selected: ns.substring(with: NSRange(location: loc, length: len)),
        after: ns.substring(with: NSRange(location: loc + len, length: afterEnd - loc - len))
    )
}

/// insertAtCursor (L2): splice the artifact into the AX value at the
/// selection, then place the cursor right after the inserted text.
/// Returns false when the element is not settable — caller degrades to L3.
@discardableResult
func insertViaAX(_ text: String) -> Bool {
    guard let el = focusedElement(),
          let value = stringAttr(el, kAXValueAttribute),
          let range = selectedRange(el) else { return false }
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
    guard settable.boolValue else { return false }

    let ns = value as NSString
    let loc = max(0, min(range.location, ns.length))
    let len = max(0, min(range.length, ns.length - loc))
    let newValue = ns.replacingCharacters(
        in: NSRange(location: loc, length: len), with: text)
    guard AXUIElementSetAttributeValue(
        el, kAXValueAttribute as CFString, newValue as CFTypeRef
    ) == .success else { return false }

    var newRange = CFRange(location: loc + (text as NSString).length, length: 0)
    if let axRange = AXValueCreate(.cfRange, &newRange) {
        AXUIElementSetAttributeValue(
            el, kAXSelectedTextRangeAttribute as CFString, axRange)
    }
    return true
}

// MARK: - L3 fallback: clipboard + synthetic paste

/// insertAtCursor (L3): save the user's pasteboard, put the artifact on
/// it, post a synthetic Cmd-V, then restore the original contents.
func insertViaPasteboard(_ text: String) {
    let pb = NSPasteboard.general
    let saved = pb.string(forType: .string)
    pb.clearContents()
    pb.setString(text, forType: .string)

    let src = CGEventSource(stateID: .hidSystemState)
    let vKey: CGKeyCode = 9 // 'v'
    for down in [true, false] {
        let ev = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: down)
        ev?.flags = .maskCommand
        ev?.post(tap: .cghidEventTap)
    }
    // Restore after the target app has consumed the paste.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
        pb.clearContents()
        if let saved { pb.setString(saved, forType: .string) }
    }
}

/// Adapter entry point: L2 first, honest degradation to L3.
func insertAtCursor(_ text: String) -> String {
    if insertViaAX(text) { return "L2" }
    insertViaPasteboard(text)
    return "L3"
}

// MARK: - Main

@main
struct ClippieSidecar {
    static func main() {
        guard AXIsProcessTrusted() else {
            FileHandle.standardError.write(
                "clippie-sidecar: Accessibility not granted — run the permission wizard first.\n"
                    .data(using: .utf8)!)
            exit(2)
        }
        FileHandle.standardError.write(
            "clippie-sidecar: ready (AX trusted)\n".data(using: .utf8)!)
        // Socket server bridging these operations to the main process
        // lands next in Milestone 2; the adapter core above is the demo.
        RunLoop.main.run()
    }
}
