import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface AdbDeviceInfo {
  serial: string;
  state: "device" | "offline" | "unauthorized" | "unknown";
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
}

export async function listAdbDevices(): Promise<AdbDeviceInfo[]> {
  try {
    const { stdout } = await exec("adb", ["devices", "-l"], { timeout: 10000 });
    const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    const devices: AdbDeviceInfo[] = [];

    for (const line of lines) {
      if (line.startsWith("List of devices") || line.startsWith("* daemon")) continue;
      // Line format: "RFCW40MYYCV            device usb:20-3 product:dm1qzcx model:SM_S9110 device:dm1q transport_id:1"
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const serial = parts[0];
        const state = (parts[1] as AdbDeviceInfo["state"]) || "unknown";
        const meta: Record<string, string> = {};

        for (let i = 2; i < parts.length; i++) {
          const [k, v] = parts[i].split(":");
          if (k && v) meta[k] = v;
        }

        devices.push({
          serial,
          state,
          model: meta["model"]?.replace(/_/g, "-") || undefined,
          product: meta["product"] || undefined,
          device: meta["device"] || undefined,
          transportId: meta["transport_id"] || undefined,
        });
      }
    }
    return devices;
  } catch {
    return [];
  }
}

export async function captureDeviceScreen(serial: string): Promise<Buffer | null> {
  try {
    const { stdout } = await exec("adb", ["-s", serial, "exec-out", "screencap", "-p"], {
      encoding: "buffer",
      timeout: 15000,
      maxBuffer: 15 * 1024 * 1024,
    });
    if (stdout && stdout.length > 100 && stdout.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
      return stdout;
    }
    return null;
  } catch {
    return null;
  }
}
