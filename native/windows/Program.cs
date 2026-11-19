// Clippie Windows helper — scaffold entry point.
//
// Implements the L2 DocumentAdapter operations with UI Automation
// (TextPattern): read focused element / selection / text, insert where the
// tree allows. Runs asInvoker; when the target window is elevated (UIPI),
// reports degraded-clipboard-only so the loop falls back to L3 honestly.
//
// Acceptance (Milestone 2): the shared adapter conformance suite passes
// against this helper on a Windows CI runner (see docs/devin-plan.md,
// spike 2).

namespace Clippie.Windows;

internal static class Program
{
    private static void Main()
    {
        // UIA event registration + local socket server land in the
        // Windows spike. See src/main/permissions.ts for the integrity
        // policy this helper enforces.
    }
}
