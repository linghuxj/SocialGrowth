import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ExecutionReceipt, ReceiptStore } from "./types.js";

const key = (taskId: string, attemptId: string) => JSON.stringify([taskId, attemptId]);

export class InMemoryReceiptStore implements ReceiptStore {
  protected readonly receipts = new Map<string, ExecutionReceipt>();
  public get(taskId: string, attemptId: string): ExecutionReceipt | undefined {
    const receipt = this.receipts.get(key(taskId, attemptId));
    return receipt ? structuredClone(receipt) : undefined;
  }
  public save(receipt: ExecutionReceipt): void {
    this.receipts.set(key(receipt.taskId, receipt.attemptId), structuredClone(receipt));
  }
}

export class JsonFileReceiptStore extends InMemoryReceiptStore {
  constructor(private readonly path: string) {
    super();
    try {
      const values = JSON.parse(readFileSync(path, "utf8")) as ExecutionReceipt[];
      for (const receipt of values) super.save(receipt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  public override save(receipt: ExecutionReceipt): void {
    const next = new Map(this.receipts);
    next.set(key(receipt.taskId, receipt.attemptId), structuredClone(receipt));
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify([...next.values()], null, 2), {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    renameSync(temporary, this.path);
    super.save(receipt);
  }
}
