import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { DeviceAssistanceRecheckConsumer } from "./device-assistance-recheck-consumer.js";

/** Consume durable requests serially. An unavailable trusted recovery port
 * records unknown; it never restores participation or starts phone actions. */
@Injectable()
export class DeviceAssistanceRecheckLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  constructor(@Inject(DeviceAssistanceRecheckConsumer) private readonly consumer: DeviceAssistanceRecheckConsumer) {}
  onApplicationBootstrap(): void { this.schedule(0); }
  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.sweep().catch(() => {
        // Preserve original claims on database/consumer errors; log no private
        // task, credential, screenshot or operator data.
        console.warn(JSON.stringify({ event: "device_assistance_recheck_consumer_failed" }));
      }).finally(() => { this.running = undefined; this.schedule(30_000); });
    }, delay);
    this.timer.unref?.();
  }
  private async sweep(): Promise<void> {
    const deadline = Date.now() + 25_000;
    for (let count = 0; count < 5 && !this.stopped && Date.now() < deadline; count++) {
      const result = await this.consumer.runOnce();
      if (!result.consumed) return;
    }
  }
}
