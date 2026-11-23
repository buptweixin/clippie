// Clippie Windows helper — UI Automation (L2) + UIPI detection + NDJSON stdio IPC.
//
// Implements the same NDJSON RPC protocol as native/macos/Sidecar.swift:
//   ping, check_permissions, get_context, get_selection, insert_at_cursor, undo
// Runs asInvoker; when the foreground target window has a higher integrity
// level (UIPI), reports targetIsElevated=true and degrades honestly to L3
// clipboard + synthetic Ctrl+V paste.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using System.Windows.Forms;

namespace Clippie.Windows;

internal static class Program
{
    private sealed record Snapshot(AutomationElement Element, string PreviousValue);

    private static int _nextUndoId = 1;
    private static readonly Dictionary<string, Snapshot> Snapshots = new();

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        if (args.Contains("--check-permissions"))
        {
            bool elevated = IsForegroundWindowHigherIntegrity();
            WriteJson(new Dictionary<string, object?>
            {
                ["accessibility"] = !elevated,
                ["screenRecording"] = true,
                ["targetIsElevated"] = elevated,
            });
            return 0;
        }

        while (Console.ReadLine() is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if (!root.TryGetProperty("id", out var idProp) ||
                    !root.TryGetProperty("method", out var methodProp))
                {
                    continue;
                }

                object id = idProp.ValueKind == JsonValueKind.Number
                    ? idProp.GetInt64()
                    : idProp.GetString() ?? "";
                string method = methodProp.GetString() ?? "";
                JsonElement? @params = root.TryGetProperty("params", out var p) ? p : null;

                HandleRpc(id, method, @params);
            }
            catch
            {
                // Ignore malformed lines on stdio stream.
            }
        }

        return 0;
    }

    private static void HandleRpc(object id, string method, JsonElement? @params)
    {
        switch (method)
        {
            case "ping":
                WriteOk(id, new Dictionary<string, object?> { ["pong"] = true });
                break;

            case "check_permissions":
            {
                bool elevated = IsForegroundWindowHigherIntegrity();
                WriteOk(id, new Dictionary<string, object?>
                {
                    ["accessibility"] = !elevated,
                    ["screenRecording"] = true,
                    ["targetIsElevated"] = elevated,
                });
                break;
            }

            case "get_context":
            {
                var (appName, before, _, after) = ReadFocusedContext();
                WriteOk(id, new Dictionary<string, object?>
                {
                    ["appName"] = appName,
                    ["before"] = before,
                    ["after"] = after,
                });
                break;
            }

            case "get_selection":
            {
                var (_, _, selected, _) = ReadFocusedContext();
                WriteOk(id, new Dictionary<string, object?> { ["selected"] = selected });
                break;
            }

            case "insert_at_cursor":
            {
                string? text = @params?.TryGetProperty("text", out var t) == true
                    ? t.GetString()
                    : null;
                if (text is null)
                {
                    WriteError(id, "Missing params.text");
                    return;
                }

                if (!IsForegroundWindowHigherIntegrity() && TryInsertViaUia(text, out string? token))
                {
                    WriteOk(id, new Dictionary<string, object?>
                    {
                        ["ok"] = true,
                        ["level"] = "L2",
                        ["undoToken"] = token,
                    });
                    return;
                }

                InsertViaClipboardPaste(text);
                WriteOk(id, new Dictionary<string, object?>
                {
                    ["ok"] = true,
                    ["level"] = "L3",
                    ["degradationNote"] = IsForegroundWindowHigherIntegrity()
                        ? "Inserted by paste — target window is elevated (UIPI)."
                        : "Inserted by paste — this window doesn't expose a writable accessibility tree.",
                });
                break;
            }

            case "undo":
            {
                string? token = @params?.TryGetProperty("undoToken", out var u) == true
                    ? u.GetString()
                    : null;
                if (token is null)
                {
                    WriteError(id, "Missing params.undoToken");
                    return;
                }
                WriteOk(id, new Dictionary<string, object?> { ["ok"] = TryUndoViaUia(token) });
                break;
            }

            default:
                WriteError(id, $"Unknown method: {method}");
                break;
        }
    }

    private static (string AppName, string Before, string Selected, string After) ReadFocusedContext()
    {
        string appName = ForegroundAppName();
        try
        {
            var el = AutomationElement.FocusedElement;
            if (el is null) return (appName, "", "", "");

            if (el.TryGetCurrentPattern(TextPattern.Pattern, out object? tpObj) &&
                tpObj is TextPattern tp)
            {
                var docRange = tp.DocumentRange;
                var selections = tp.GetSelection();
                if (selections.Length > 0)
                {
                    var sel = selections[0];
                    string selected = sel.GetText(500) ?? "";

                    var beforeRange = docRange.Clone();
                    beforeRange.MoveEndpointByRange(
                        System.Windows.Automation.Text.TextPatternRangeEndpoint.End,
                        sel,
                        System.Windows.Automation.Text.TextPatternRangeEndpoint.Start);
                    string fullBefore = beforeRange.GetText(-1) ?? "";
                    string before = fullBefore.Length > 2000
                        ? fullBefore[^2000..]
                        : fullBefore;

                    var afterRange = docRange.Clone();
                    afterRange.MoveEndpointByRange(
                        System.Windows.Automation.Text.TextPatternRangeEndpoint.Start,
                        sel,
                        System.Windows.Automation.Text.TextPatternRangeEndpoint.End);
                    string after = afterRange.GetText(500) ?? "";

                    return (appName, before, selected, after);
                }
            }

            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object? vpObj) &&
                vpObj is ValuePattern vp)
            {
                string val = vp.Current.Value ?? "";
                string before = val.Length > 2000 ? val[^2000..] : val;
                return (appName, before, "", "");
            }
        }
        catch
        {
            // Fall through to empty context when focus changes mid-query.
        }

        return (appName, "", "", "");
    }

    private static bool TryInsertViaUia(string text, out string? undoToken)
    {
        undoToken = null;
        try
        {
            var el = AutomationElement.FocusedElement;
            if (el is null) return false;

            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object? vpObj) &&
                vpObj is ValuePattern vp &&
                !vp.Current.IsReadOnly)
            {
                string prev = vp.Current.Value ?? "";
                vp.SetValue(prev + text);
                string token = $"uia:{_nextUndoId++}";
                Snapshots[token] = new Snapshot(el, prev);
                undoToken = token;
                return true;
            }
        }
        catch
        {
            return false;
        }
        return false;
    }

    private static bool TryUndoViaUia(string token)
    {
        if (!Snapshots.Remove(token, out var snap)) return false;
        try
        {
            if (snap.Element.TryGetCurrentPattern(ValuePattern.Pattern, out object? vpObj) &&
                vpObj is ValuePattern vp &&
                !vp.Current.IsReadOnly)
            {
                vp.SetValue(snap.PreviousValue);
                return true;
            }
        }
        catch
        {
            return false;
        }
        return false;
    }

    private static void InsertViaClipboardPaste(string text)
    {
        string? saved = Clipboard.ContainsText() ? Clipboard.GetText() : null;
        try
        {
            Clipboard.SetText(text);
            SendKeys.SendWait("^v");
            Thread.Sleep(120);
        }
        finally
        {
            if (saved is not null)
            {
                Clipboard.SetText(saved);
            }
            else
            {
                Clipboard.Clear();
            }
        }
    }

    private static string ForegroundAppName()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return "Unknown";
        GetWindowThreadProcessId(hwnd, out uint pid);
        try
        {
            return Process.GetProcessById((int)pid).ProcessName;
        }
        catch
        {
            return "Unknown";
        }
    }

    private static bool IsForegroundWindowHigherIntegrity()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return false;
        GetWindowThreadProcessId(hwnd, out uint targetPid);
        int selfIl = GetProcessIntegrityRid((uint)Environment.ProcessId);
        int targetIl = GetProcessIntegrityRid(targetPid);
        // If we cannot open the target process token (ERROR_ACCESS_DENIED),
        // treat it conservatively as elevated.
        if (targetIl < 0) return true;
        return targetIl > selfIl;
    }

    private static int GetProcessIntegrityRid(uint pid)
    {
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        const uint TOKEN_QUERY = 0x0008;
        const int TokenIntegrityLevel = 25;

        IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (hProc == IntPtr.Zero) return -1;
        try
        {
            if (!OpenProcessToken(hProc, TOKEN_QUERY, out IntPtr hToken)) return -1;
            try
            {
                GetTokenInformation(hToken, TokenIntegrityLevel, IntPtr.Zero, 0, out uint len);
                if (len == 0) return -1;
                IntPtr buf = Marshal.AllocHGlobal((int)len);
                try
                {
                    if (!GetTokenInformation(hToken, TokenIntegrityLevel, buf, len, out _))
                        return -1;
                    IntPtr pSid = Marshal.ReadIntPtr(buf);
                    IntPtr pCount = GetSidSubAuthorityCount(pSid);
                    byte count = Marshal.ReadByte(pCount);
                    IntPtr pRid = GetSidSubAuthority(pSid, (uint)(count - 1));
                    return Marshal.ReadInt32(pRid);
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
            finally
            {
                CloseHandle(hToken);
            }
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    private static void WriteOk(object id, Dictionary<string, object?> result)
    {
        WriteJson(new Dictionary<string, object?>
        {
            ["id"] = id,
            ["ok"] = true,
            ["result"] = result,
        });
    }

    private static void WriteError(object id, string error)
    {
        WriteJson(new Dictionary<string, object?>
        {
            ["id"] = id,
            ["ok"] = false,
            ["error"] = error,
        });
    }

    private static void WriteJson(Dictionary<string, object?> obj)
    {
        Console.WriteLine(JsonSerializer.Serialize(obj));
        Console.Out.Flush();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        IntPtr TokenHandle,
        int TokenInformationClass,
        IntPtr TokenInformation,
        uint TokenInformationLength,
        out uint ReturnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr pSid);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr pSid, uint nSubAuthority);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);
}
