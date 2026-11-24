import * as fs from "node:fs";
import * as path from "node:path";
import type { DocumentAdapter } from "../adapters/DocumentAdapter";
import { LayeredDocumentAdapter } from "../adapters/LayeredDocumentAdapter";
import { MockDocumentAdapter } from "../adapters/MockDocumentAdapter";
import {
  SidecarDocumentAdapter,
  StdioSidecarTransport,
} from "../adapters/SidecarDocumentAdapter";
import type { SnapshotProvider } from "../agent/loop";

export interface PlatformRuntime {
  adapter: DocumentAdapter;
  snapshotProvider?: SnapshotProvider;
  close(): Promise<void>;
}

/**
 * Resolves the native OS sidecar binary when compiled (`dist/clippie-sidecar`
 * on macOS or `ClippieSidecar.exe` on Windows) and wraps it in a
 * LayeredDocumentAdapter; degrades cleanly to MockDocumentAdapter in dev/test
 * environments where native binaries have not been built yet.
 */
export function createPlatformRuntime(
  distDir: string,
  platform: NodeJS.Platform = process.platform,
): PlatformRuntime {
  const candidates =
    platform === "darwin"
      ? [path.join(distDir, "clippie-sidecar")]
      : platform === "win32"
        ? [
            path.join(distDir, "ClippieSidecar.exe"),
            path.join(
              distDir,
              "../native/windows/bin/Release/net8.0-windows/ClippieSidecar.exe",
            ),
          ]
        : [];

  const binary = candidates.find((p) => fs.existsSync(p));
  if (!binary) {
    return {
      adapter: new MockDocumentAdapter({ appName: "Desktop" }),
      async close() {},
    };
  }

  const transport = new StdioSidecarTransport(binary, ["--stdio"]);
  const sidecar = new SidecarDocumentAdapter(transport);
  const layered = new LayeredDocumentAdapter([sidecar]);

  return {
    adapter: layered,
    snapshotProvider: sidecar,
    async close() {
      await transport.close();
    },
  };
}
