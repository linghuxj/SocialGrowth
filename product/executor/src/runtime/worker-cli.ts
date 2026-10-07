import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";
import { runAgentOnce } from "./agent-cli.js";

/** Foreground worker: operator starts it explicitly. Server leases serialize each device;
 * polling does not imply permission to retry a started publication attempt. */
export async function runWorker(options: {
  once: () => Promise<unknown>;
  signal: AbortSignal;
  intervalMs?: number;
  cycles?: number;
}) {
  let cycles = 0;
  while (!options.signal.aborted && cycles++ < (options.cycles ?? Infinity)) {
    try {
      await options.once();
    } catch {
      console.error(
        JSON.stringify({ status: "worker_check_failed", retryPolicy: "preparation_only" }),
      );
    }
    if (options.signal.aborted || cycles >= (options.cycles ?? Infinity)) break;
    const interval =
      Number(process.env.SG_WORKER_INTERVAL_MS) || options.intervalMs || 15000;
    await setTimeout(interval, undefined, { signal: options.signal }).catch(
      () => {},
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const options = {
    runtimeUrl: process.env.SG_RUNTIME_URL ?? "http://127.0.0.1:4318",
    token: process.env.SG_AGENT_TOKEN ?? "",
    deviceId: process.env.SG_DEVICE_ID ?? "",
    artemisRoot: process.env.SG_ARTEMIS_ROOT ?? "",
    ledgerPath: resolve(process.env.SG_AGENT_LEDGER ?? ".runtime/agent.sqlite"),
  };
  let previous = "";
  await runWorker({
    signal: controller.signal,
    once: async () => {
      const result = JSON.stringify(await runAgentOnce(options));
      if (result !== previous) {
        console.info(result);
        previous = result;
      }
    },
  });
}
