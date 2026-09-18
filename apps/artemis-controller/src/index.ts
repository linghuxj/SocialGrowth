import { DevicePool } from './device-pool.js';
import { TaskScheduler } from './scheduler.js';

export * from './types.js';
export { DevicePool, TaskScheduler };

export function createArtemisController() {
  const devicePool = new DevicePool();
  const scheduler = new TaskScheduler(devicePool);

  return {
    devicePool,
    scheduler,
  };
}
