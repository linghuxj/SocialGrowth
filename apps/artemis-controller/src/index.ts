import { DevicePool } from "./device-pool.js";
import { TaskScheduler } from "./scheduler.js";
import { UnconfiguredExecutionAdapter } from "./execution-adapter.js";
import { InMemoryReceiptStore } from "./receipt-store.js";

export * from "./types.js";
export { DevicePool, TaskScheduler, UnconfiguredExecutionAdapter, InMemoryReceiptStore };

export function createArtemisController() {
  const devicePool = new DevicePool();
  const scheduler = new TaskScheduler(
    devicePool,
    new UnconfiguredExecutionAdapter(),
    new InMemoryReceiptStore(),
  );

  return {
    devicePool,
    scheduler,
  };
}
