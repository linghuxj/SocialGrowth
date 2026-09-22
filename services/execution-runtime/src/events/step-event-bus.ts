import { EventEmitter } from "node:events";
import { z } from "zod";

export const stepEventSchema = z.object({
  eventId: z.string().optional(),
  workerId: z.string(),
  deviceId: z.string(),
  serial: z.string().optional(),
  sessionId: z.string(),
  step: z.number().int().nonnegative(),
  totalSteps: z.number().int().positive().optional(),
  type: z.enum(["post", "preflight", "verify_identity", "idle", "recovery"]).default("post"),
  status: z.enum(["running", "idle", "blocked", "completed", "failed"]).default("running"),
  action: z.string().default("observe_screen"),
  actionDesc: z.string().default(""),
  imageKey: z.string().optional(),
  timestamp: z.number().int().positive().default(() => Date.now()),
  platform: z.enum(["facebook", "youtube", "unknown"]).optional(),
  platformIdentity: z.string().optional(),
  failureReason: z.string().optional(),
});

export type StepEvent = z.infer<typeof stepEventSchema>;

export class StepEventBus {
  private readonly emitter = new EventEmitter();
  private readonly latestEvents = new Map<string, StepEvent>();
  private readonly deviceHistories = new Map<string, StepEvent[]>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(raw: unknown): StepEvent {
    const parsed = stepEventSchema.parse({
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...((typeof raw === "object" && raw !== null) ? raw : {}),
    });

    this.latestEvents.set(parsed.deviceId, parsed);
    if (parsed.serial) {
      this.latestEvents.set(parsed.serial, parsed);
    }

    const history = this.deviceHistories.get(parsed.deviceId) ?? [];
    history.push(parsed);
    if (history.length > 50) history.shift();
    this.deviceHistories.set(parsed.deviceId, history);

    this.emitter.emit("step", parsed);
    return parsed;
  }

  getLatest(deviceId: string): StepEvent | undefined {
    return this.latestEvents.get(deviceId);
  }

  getAllLatest(): StepEvent[] {
    return Array.from(this.latestEvents.values());
  }

  getHistory(deviceId: string): StepEvent[] {
    return this.deviceHistories.get(deviceId) ?? [];
  }

  onStep(listener: (event: StepEvent) => void): () => void {
    this.emitter.on("step", listener);
    return () => this.emitter.off("step", listener);
  }
}

export const globalStepEventBus = new StepEventBus();
