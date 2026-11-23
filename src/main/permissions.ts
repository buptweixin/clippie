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

export interface VerificationResult {
  verified: boolean;
  report: PermissionReport;
  settingsUrl?: string;
  failureReason?: string;
}

export interface MacPermissionProbes {
  checkGrants(): Promise<{ accessibility: boolean; screenRecording: boolean }>;
  /**
   * Live test read required by docs/permissions.md before the UI is allowed
   * to claim the feature works.
   */
  liveTestRead(): Promise<{ axReadable: boolean; screenCapturable: boolean }>;
  openUrl?(url: string): Promise<void> | void;
}

/**
 * macOS TCC onboarding & verification wizard (Milestone 3).
 * Never claims "verified" on preflight flags alone — executes a real live read.
 */
export class MacPermissionWizard {
  constructor(private probes: MacPermissionProbes) {}

  async inspect(): Promise<VerificationResult> {
    const grants = await this.probes.checkGrants();
    const report = buildMacPermissionReport(
      grants.accessibility,
      grants.screenRecording,
    );
    return {
      verified: false,
      report,
      settingsUrl: this.pickSettingsUrl(report),
    };
  }

  async openRequiredSettings(): Promise<string | undefined> {
    const { settingsUrl } = await this.inspect();
    if (settingsUrl) {
      await this.probes.openUrl?.(settingsUrl);
    }
    return settingsUrl;
  }

  async verify(): Promise<VerificationResult> {
    const grants = await this.probes.checkGrants();
    if (!grants.accessibility || !grants.screenRecording) {
      const report = buildMacPermissionReport(
        grants.accessibility,
        grants.screenRecording,
      );
      return {
        verified: false,
        report,
        settingsUrl: this.pickSettingsUrl(report),
        failureReason: "OS permission flags are not yet granted.",
      };
    }

    const live = await this.probes.liveTestRead();
    const report = buildMacPermissionReport(
      live.axReadable,
      live.screenCapturable,
    );

    if (!live.axReadable || !live.screenCapturable) {
      return {
        verified: false,
        report,
        settingsUrl: this.pickSettingsUrl(report),
        failureReason: !live.axReadable
          ? "Live Accessibility test read failed — restart the sidecar after enabling Accessibility."
          : "Live Screen Recording capture failed — restart the sidecar after enabling Screen Recording.",
      };
    }

    return {
      verified: true,
      report,
    };
  }

  private pickSettingsUrl(report: PermissionReport): string | undefined {
    if (report.accessibility !== "granted") return MAC_SETTINGS_URLS.accessibility;
    if (report.screenCapture !== "granted") return MAC_SETTINGS_URLS.screenCapture;
    return undefined;
  }
}
