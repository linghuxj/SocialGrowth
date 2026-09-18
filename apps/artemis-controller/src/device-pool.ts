import type { DeviceInfo, PlatformType } from './types.js';

/**
 * Google Artemis 设备连接与管理池
 */
export class DevicePool {
  private devices = new Map<string, DeviceInfo>();

  public registerDevice(device: DeviceInfo): void {
    this.devices.set(device.deviceId, device);
  }

  public getDevice(deviceId: string): DeviceInfo | undefined {
    return this.devices.get(deviceId);
  }

  public listDevices(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }

  public getAvailableDeviceForPlatform(platform: PlatformType): DeviceInfo | undefined {
    for (const dev of this.devices.values()) {
      if (dev.status === 'idle' && dev.platformBound.includes(platform)) {
        return dev;
      }
    }
    return undefined;
  }

  public updateStatus(deviceId: string, status: DeviceInfo['status']): void {
    const dev = this.devices.get(deviceId);
    if (dev) {
      dev.status = status;
      dev.lastHeartbeat = new Date().toISOString();
    }
  }
}
