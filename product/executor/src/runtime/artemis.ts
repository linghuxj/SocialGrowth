import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { requireFact } from "./contracts.js";

export interface ArtemisPort {
  call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}
export class ArtemisMcp implements ArtemisPort {
  private readonly client = new Client({ name: "socialgrowth-device-agent", version: "0.1.0" });
  private transport?: StdioClientTransport;
  constructor(
    private readonly root: string,
    private readonly assistance?: {
      url: string;
      token: string;
      deviceId?: string;
      serial?: string;
      workerId?: string;
    },
  ) {}
  async connect() {
    const adbServer = process.env.ADB_SERVER_SOCKET;
    let adbPort: string | undefined;
    if (adbServer !== undefined) {
      const match = /^tcp:127\.0\.0\.1:(\d{1,5})$/.exec(adbServer);
      requireFact(match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535, "ARTEMIS_ADB_SERVER_INVALID");
      adbPort = match![1];
    }
    const requestBudget = process.env.ARTEMIS_PROXY_MAX_BODY_BYTES;
    if (requestBudget !== undefined) requireFact(/^\d+$/.test(requestBudget) && Number(requestBudget) > 0 &&
      Number(requestBudget) <= 1_572_864, "ARTEMIS_PROXY_REQUEST_BUDGET_INVALID");
    if (this.assistance)
      requireFact(
        existsSync(resolve(this.root, "artemis/tools/socialgrowth_human_input.py")) &&
          existsSync(resolve(this.root, "artemis/tools/socialgrowth_supervision.py")) &&
          readFileSync(resolve(this.root, "artemis/mcp/action_session.py"), "utf8").includes(
            "await guard_action(self._socialgrowth_ctx, name, args)",
          ) &&
          readFileSync(resolve(this.root, "artemis/agents/operator/operator.py"), "utf8").includes(
            "filter_tools(all_tools, set(available_actions))",
          ),
        "ARTEMIS_HUMAN_INPUT_EXTENSION_REQUIRED",
      );
    // Use the operator's existing, pinned environment, including its own dotenv/config loading.
    this.transport = new StdioClientTransport({
      command: resolve(this.root, ".venv/bin/python"),
      args: ["-m", "artemis", "mcp"],
      cwd: this.root,
      // This runtime already provides durable one-shot scheduling and polling.
      // Force Artemis' standalone path so a separately running Artemis daemon
      // cannot accept the task with a daemon-only launch/result shape and leave
      // this process without a conclusive structured result. Artemis' shared
      // device lock still prevents concurrent access to the same serial.
      env: {
        ...getDefaultEnvironment(),
        ARTEMIS_STANDALONE: "1",
        ...(adbServer !== undefined ? { ADB_SERVER_SOCKET: adbServer, ADB_HOST: "127.0.0.1", ADB_PORT: adbPort! } : {}),
        ...(requestBudget !== undefined ? { ARTEMIS_PROXY_MAX_BODY_BYTES: requestBudget } : {}),
        ...(this.assistance
          ? {
              SG_ASSISTANCE_URL: this.assistance.url,
              SG_ASSISTANCE_TOKEN: this.assistance.token,
              SG_RUNTIME_URL: this.assistance.url,
              SG_DEVICE_ID: this.assistance.deviceId ?? process.env.SG_DEVICE_ID ?? "RFCW40MYYCV",
              SG_DEVICE_SERIAL: this.assistance.serial ?? process.env.SG_DEVICE_SERIAL ?? "RFCW40MYYCV",
              SG_WORKER_ID: this.assistance.workerId ?? process.env.SG_WORKER_ID ?? "worker01",
            }
          : {
              SG_RUNTIME_URL: process.env.SG_RUNTIME_URL ?? "http://127.0.0.1:4318",
              SG_DEVICE_ID: process.env.SG_DEVICE_ID ?? "RFCW40MYYCV",
              SG_DEVICE_SERIAL: process.env.SG_DEVICE_SERIAL ?? "RFCW40MYYCV",
              SG_WORKER_ID: process.env.SG_WORKER_ID ?? "worker01",
            }),
      },
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
