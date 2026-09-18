import type { PublishTaskDirective, ExecutionReceipt } from './types.js';
import type { DevicePool } from './device-pool.js';

/**
 * 任务调度与执行引擎
 */
export class TaskScheduler {
  private queue: PublishTaskDirective[] = [];
  private receipts = new Map<string, ExecutionReceipt>();

  constructor(private devicePool: DevicePool) {}

  public enqueueTask(task: PublishTaskDirective): void {
    this.queue.push(task);
  }

  public getPendingCount(): number {
    return this.queue.length;
  }

  public getReceipt(taskId: string): ExecutionReceipt | undefined {
    return this.receipts.get(taskId);
  }

  public async dispatchNext(): Promise<ExecutionReceipt | null> {
    if (this.queue.length === 0) return null;

    const task = this.queue[0];
    const device = this.devicePool.getAvailableDeviceForPlatform(task.platform);

    if (!device) {
      // 暂无可空闲设备，等待下一轮调度
      return null;
    }

    this.queue.shift();
    this.devicePool.updateStatus(device.deviceId, 'busy');

    const startedAt = new Date().toISOString();

    // 占位执行逻辑（对接 Artemis 驱动）
    const receipt: ExecutionReceipt = {
      taskId: task.taskId,
      deviceId: device.deviceId,
      status: 'completed',
      startedAt,
      finishedAt: new Date().toISOString(),
      publishedUrl: `https://${task.platform}.com/posts/${Date.now()}`,
      screenshotPaths: [`/tmp/screenshots/${task.taskId}_finish.png`],
      selfHealingLogs: ['Coordinate adjusted for resolution 1080x2340: offset +12px'],
    };

    this.receipts.set(task.taskId, receipt);
    this.devicePool.updateStatus(device.deviceId, 'idle');

    return receipt;
  }
}
