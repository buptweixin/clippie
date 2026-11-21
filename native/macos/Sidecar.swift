// Clippie macOS sidecar — demo core + NDJSON stdio IPC.
//
// Owns the TCC grants (Accessibility + Screen Recording) and implements
// the L2 DocumentAdapter operations for the frontmost app:
//   - read the focused element's text and selection via AXUIElement
//   - insert at the cursor by setting the AX value around the selection
//     (snapshot-backed so undo restores the pre-insert value & range)
//   - fall back to clipboard + synthetic Cmd-V when the AX tree of the
//     target app is not writable (the L3 path, used honestly)
//
// Acceptance (Milestone 2): read → insert → undo in TextEdit and Word,
// verified by the shared adapter conformance suite.

import ApplicationServices
import AppKit
import CoreGraphics
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

func frontmostAppName() -> String {
    return NSWorkspace.shared.frontmostApplication?.localizedName ?? "Unknown"
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

// MARK: - Snapshot store for undo

struct AXSnapshot {
    let element: AXUIElement
    let previousValue: String
    let previousRange: CFRange
}

final class SnapshotStore {
    private var nextId = 1
    private var items: [String: AXSnapshot] = [:]

    func save(_ snap: AXSnapshot) -> String {
        let token = "ax:\(nextId)"
        nextId += 1
        items[token] = snap
        return token
    }

    func take(_ token: String) -> AXSnapshot? {
        return items.removeValue(forKey: token)
    }
}

let snapshots = SnapshotStore()

// MARK: - DocumentAdapter (L2) operations

/// getContext + getSelection: text around the cursor in the focused element.
func readContext() -> (appName: String, before: String, selected: String, after: String)? {
    guard let el = focusedElement(),
          let value = stringAttr(el, kAXValueAttribute),
          let range = selectedRange(el) else { return nil }
    let ns = value as NSString
    let loc = max(0, min(range.location, ns.length))
    let len = max(0, min(range.length, ns.length - loc))
    let beforeStart = max(0, loc - 2000)
    let afterEnd = min(ns.length, loc + len + 500)
    return (
        appName: frontmostAppName(),
        before: ns.substring(with: NSRange(location: beforeStart, length: loc - beforeStart)),
        selected: ns.substring(with: NSRange(location: loc, length: len)),
        after: ns.substring(with: NSRange(location: loc + len, length: afterEnd - loc - len))
    )
}

/// insertAtCursor (L2): save pre-insert snapshot, splice the artifact into
/// the AX value at the selection, then place the cursor right after it.
/// Returns nil when the element is not settable — caller degrades to L3.
func insertViaAX(_ text: String) -> String? {
    guard let el = focusedElement(),
          let value = stringAttr(el, kAXValueAttribute),
          let range = selectedRange(el) else { return nil }
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
    guard settable.boolValue else { return nil }

    let ns = value as NSString
    let loc = max(0, min(range.location, ns.length))
    let len = max(0, min(range.length, ns.length - loc))
    let newValue = ns.replacingCharacters(
        in: NSRange(location: loc, length: len), with: text)
    guard AXUIElementSetAttributeValue(
        el, kAXValueAttribute as CFString, newValue as CFTypeRef
    ) == .success else { return nil }

    let token = snapshots.save(AXSnapshot(
        element: el,
        previousValue: value,
        previousRange: CFRange(location: loc, length: len)
    ))

    var newRange = CFRange(location: loc + (text as NSString).length, length: 0)
    if let axRange = AXValueCreate(.cfRange, &newRange) {
        AXUIElementSetAttributeValue(
            el, kAXSelectedTextRangeAttribute as CFString, axRange)
    }
    return token
}

func undoViaAX(_ token: String) -> Bool {
    guard let snap = snapshots.take(token) else { return false }
    guard AXUIElementSetAttributeValue(
        snap.element, kAXValueAttribute as CFString, snap.previousValue as CFTypeRef
    ) == .success else { return false }

    var prevRange = snap.previousRange
    if let axRange = AXValueCreate(.cfRange, &prevRange) {
        AXUIElementSetAttributeValue(
            snap.element, kAXSelectedTextRangeAttribute as CFString, axRange)
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

struct SidecarInsertResult {
    let ok: Bool
    let level: String
    let degradationNote: String?
    let undoToken: String?
}

/// Adapter entry point: L2 first, honest degradation to L3.
func insertAtCursor(_ text: String) -> SidecarInsertResult {
    if let token = insertViaAX(text) {
        return SidecarInsertResult(
            ok: true,
            level: "L2",
            degradationNote: nil,
            undoToken: token
        )
    }
    insertViaPasteboard(text)
    return SidecarInsertResult(
        ok: true,
        level: "L3",
        degradationNote: "Inserted by paste — this window doesn't expose a writable accessibility tree.",
        undoToken: nil
    )
}

// MARK: - Permissions & NDJSON stdio RPC

func permissionStatus() -> [String: Bool] {
    return [
        "accessibility": AXIsProcessTrusted(),
        "screenRecording": CGPreflightScreenCaptureAccess(),
    ]
}

func writeJSONLine(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func handleRPC(id: Any, method: String, params: [String: Any]) {
    switch method {
    case "ping":
        writeJSONLine(["id": id, "ok": true, "result": ["pong": true]])
    case "check_permissions":
        writeJSONLine(["id": id, "ok": true, "result": permissionStatus()])
    case "get_context":
        if let ctx = readContext() {
            writeJSONLine([
                "id": id,
                "ok": true,
                "result": [
                    "appName": ctx.appName,
                    "before": ctx.before,
                    "after": ctx.after,
                ],
            ])
        } else {
            writeJSONLine([
                "id": id,
                "ok": true,
                "result": [
                    "appName": frontmostAppName(),
                    "before": "",
                    "after": "",
                ],
            ])
        }
    case "get_selection":
        let selected = readContext()?.selected ?? ""
        writeJSONLine(["id": id, "ok": true, "result": ["selected": selected]])
    case "insert_at_cursor":
        guard let text = params["text"] as? String else {
            writeJSONLine(["id": id, "ok": false, "error": "Missing params.text"])
            return
        }
        let res = insertAtCursor(text)
        var result: [String: Any] = ["ok": res.ok, "level": res.level]
        if let note = res.degradationNote { result["degradationNote"] = note }
        if let token = res.undoToken { result["undoToken"] = token }
        writeJSONLine(["id": id, "ok": true, "result": result])
    case "undo":
        guard let token = params["undoToken"] as? String else {
            writeJSONLine(["id": id, "ok": false, "error": "Missing params.undoToken"])
            return
        }
        writeJSONLine(["id": id, "ok": true, "result": ["ok": undoViaAX(token)]])
    default:
        writeJSONLine(["id": id, "ok": false, "error": "Unknown method: \(method)"])
    }
}

func runStdioLoop() {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        guard let data = line.data(using: .utf8),
              let req = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = req["id"],
              let method = req["method"] as? String else {
            continue
        }
        let params = req["params"] as? [String: Any] ?? [:]
        handleRPC(id: id, method: method, params: params)
    }
}

// MARK: - Main

@main
struct ClippieSidecar {
    static func main() {
        let args = CommandLine.arguments
        if args.contains("--check-permissions") {
            let status = permissionStatus()
            writeJSONLine(status)
            exit((status["accessibility"] == true) ? 0 : 2)
        }
        if args.contains("--stdio") {
            runStdioLoop()
            return
        }

        guard AXIsProcessTrusted() else {
            FileHandle.standardError.write(
                "clippie-sidecar: Accessibility not granted — run the permission wizard first.\n"
                    .data(using: .utf8)!)
            exit(2)
        }
        FileHandle.standardError.write(
            "clippie-sidecar: ready (AX trusted)\n".data(using: .utf8)!)
        RunLoop.main.run()
    }
}
