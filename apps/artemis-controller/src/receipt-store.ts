import { readFileSync, writeFileSync } from "node:fs";
import type { ExecutionReceipt, ReceiptStore } from "./types.js";

const key = (taskId: string, attemptId: string) => `${taskId}:${attemptId}`;

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
    super.save(receipt);
    writeFileSync(this.path, JSON.stringify([...this.receipts.values()], null, 2));
  }
}
