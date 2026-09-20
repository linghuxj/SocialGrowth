import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { requireFact } from "./contracts.ts";

export interface ArtemisPort {
  call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}
export class ArtemisMcp implements ArtemisPort {
  private readonly client = new Client({ name: "socialgrowth-device-agent", version: "0.1.0" });
  private transport?: StdioClientTransport;
  constructor(private readonly root: string) {}
  async connect() {
    // Use the operator's existing, pinned environment, including its own dotenv/config loading.
    this.transport = new StdioClientTransport({
      command: resolve(this.root, ".venv/bin/python"),
      args: ["-m", "artemis", "mcp"],
      cwd: this.root,
      stderr: "pipe",
    });
    await this.client.connect(this.transport);
    const { tools } = await this.client.listTools();
    for (const name of ["mobile_run_task", "mobile_manage_task", "mobile_get_device_state"])
      requireFact(
        tools.some((t) => t.name === name),
        "ARTEMIS_CONTRACT_UNSUPPORTED",
      );
  }
  async call(name: string, args: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: timeoutMs,
    });
    requireFact(!result.isError, "ARTEMIS_TOOL_FAILED");
    if (result.structuredContent) {
      const structured = result.structuredContent;
      // FastMCP wraps scalar return values in {result: ...}; dictionary tools are already objects.
      return typeof structured === "object" &&
        Object.keys(structured).length === 1 &&
        "result" in structured
        ? structured.result
        : structured;
    }
    const text = Array.isArray(result.content)
      ? result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n")
      : "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  async close() {
    await this.client.close();
  }
}
