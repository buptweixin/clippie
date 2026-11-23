import { describe, expect, it, vi } from "vitest";
import {
  MAC_SETTINGS_URLS,
  MacPermissionWizard,
  buildMacPermissionReport,
  buildWindowsPermissionReport,
  macNextStep,
  windowsDegradation,
} from "../src/main/permissions";

describe("permissions", () => {
  it("guides macOS users to Accessibility first, then Screen Recording", () => {
    const missingAx = buildMacPermissionReport(false, false);
    expect(missingAx.accessibility).toBe("denied");
    expect(missingAx.nextStep).toContain("Accessibility");

    const missingScreen = buildMacPermissionReport(true, false);
    expect(missingScreen.accessibility).toBe("granted");
    expect(missingScreen.screenCapture).toBe("denied");
    expect(missingScreen.nextStep).toContain("Screen Recording");

    const allGranted = buildMacPermissionReport(true, true);
    expect(allGranted.nextStep).toBeUndefined();
    expect(macNextStep(allGranted)).toBeUndefined();
    expect(MAC_SETTINGS_URLS.accessibility).toContain("Privacy_Accessibility");
    expect(MAC_SETTINGS_URLS.screenCapture).toContain("Privacy_ScreenCapture");
  });

  it("reports honest clipboard-only degradation for elevated Windows windows", () => {
    expect(windowsDegradation(true)).toBe("degraded-clipboard-only");
    expect(windowsDegradation(false)).toBe("granted");

    const elevated = buildWindowsPermissionReport(true);
    expect(elevated.accessibility).toBe("degraded-clipboard-only");
    expect(elevated.nextStep).toContain("L3 clipboard paste");

    const normal = buildWindowsPermissionReport(false);
    expect(normal.accessibility).toBe("granted");
    expect(normal.nextStep).toBeUndefined();
  });

  it("refuses to mark macOS permissions verified until live test read passes", async () => {
    const openUrl = vi.fn();
    let liveReady = false;

    const wizard = new MacPermissionWizard({
      checkGrants: async () => ({ accessibility: true, screenRecording: true }),
      liveTestRead: async () => ({
        axReadable: true,
        screenCapturable: liveReady,
      }),
      openUrl,
    });

    const failed = await wizard.verify();
    expect(failed.verified).toBe(false);
    expect(failed.settingsUrl).toBe(MAC_SETTINGS_URLS.screenCapture);
    expect(failed.failureReason).toContain("Screen Recording");

    liveReady = true;
    const passed = await wizard.verify();
    expect(passed.verified).toBe(true);
    expect(passed.report.accessibility).toBe("granted");
    expect(passed.report.screenCapture).toBe("granted");
  });
});
