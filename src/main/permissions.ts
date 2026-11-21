/**
 * Permission handling — two platforms, two completely different regimes.
 *
 * macOS: TCC. The app needs Accessibility + Screen Recording grants, held
 * by the signed native sidecar (not the Electron main process). Detection
 * is AXIsProcessTrusted() + a live test screenshot; the wizard deep-links
 * to the exact Settings pane and verifies with a real read before the UI
 * is allowed to claim the feature works.
 *
 * Windows: no TCC, but UIPI integrity isolation. A normal-integrity process
 * cannot write into an elevated window. We run asInvoker (no uiAccess —
 * that requires signing + a Program Files install, out of hackathon
 * scope), detect the target window's integrity level, and degrade to the
 * L3 clipboard adapter with an honest note in the bubble.
 */
export type PermissionState =
  | "granted"
  | "denied"
  | "not-determined"
  | "degraded-clipboard-only";

export interface PermissionReport {
  platform: "darwin" | "win32";
  accessibility: PermissionState;
  screenCapture: PermissionState;
  /** Human-readable next step for the wizard UI, if any. */
  nextStep?: string;
}

export const MAC_SETTINGS_URLS = {
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenCapture:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
} as const;

export function macNextStep(r: PermissionReport): string | undefined {
  if (r.accessibility !== "granted") {
    return "Open System Settings → Privacy & Security → Accessibility and enable Clippie, then press Verify.";
  }
  if (r.screenCapture !== "granted") {
    return "Open System Settings → Privacy & Security → Screen Recording and enable Clippie, then press Verify.";
  }
  return undefined;
}

export function buildMacPermissionReport(
  accessibilityGranted: boolean,
  screenCaptureGranted: boolean,
): PermissionReport {
  const report: PermissionReport = {
    platform: "darwin",
    accessibility: accessibilityGranted ? "granted" : "denied",
    screenCapture: screenCaptureGranted ? "granted" : "denied",
  };
  report.nextStep = macNextStep(report);
  return report;
}

export function windowsDegradation(targetIsElevated: boolean): PermissionState {
  return targetIsElevated ? "degraded-clipboard-only" : "granted";
}

export function buildWindowsPermissionReport(targetIsElevated: boolean): PermissionReport {
  const accessibility = windowsDegradation(targetIsElevated);
  return {
    platform: "win32",
    accessibility,
    screenCapture: "granted",
    nextStep: targetIsElevated
      ? "Target window is elevated (UIPI). Clippie will use L3 clipboard paste honestly."
      : undefined,
  };
}
