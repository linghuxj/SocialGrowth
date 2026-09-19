import type { DeviceInfo, PlatformType } from "./types.js";

export class DevicePool {
  private devices = new Map<string, DeviceInfo>();

  public registerDevice(device: DeviceInfo): void {
    if (device.deviceType !== "physical") throw new Error("PHYSICAL_DEVICE_REQUIRED");
    this.devices.set(device.deviceId, structuredClone(device));
  }

  public getDevice(deviceId: string): DeviceInfo | undefined {
    const device = this.devices.get(deviceId);
    return device ? structuredClone(device) : undefined;
  }

  public listDevices(): DeviceInfo[] {
    return Array.from(this.devices.values(), (device) => structuredClone(device));
  }

  public getAvailableBoundDevice(
    platform: PlatformType,
    accountId: string,
    requiredDeviceId: string,
  ): DeviceInfo | undefined {
    const device = this.devices.get(requiredDeviceId);
    if (!device || device.status !== "idle" || device.deviceType !== "physical") return undefined;
    if (!device.platformBound.includes(platform) || !device.boundAccounts.includes(accountId))
      return undefined;
    return structuredClone(device);
  }

  public updateStatus(deviceId: string, status: DeviceInfo["status"]): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      device.lastHeartbeat = new Date().toISOString();
    }
  }
}
