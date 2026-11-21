import { describe, expect, it } from "vitest";
import {
  MAC_SETTINGS_URLS,
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
});
