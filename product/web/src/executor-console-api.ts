import { executorConsoleSchema, executorMutationResponseSchema } from "@socialgrowth/product-contracts";
import { prepareOperatorPost, readOperatorResource } from "./operator-api.js";

export const readExecutorConsole = () => readOperatorResource("/api/operator/executor/status", executorConsoleSchema);
export const prepareExecutorMutation = (path: "bootstrap-handoff" | "bootstrap-initialization-resume" | "bootstrap-verifications" | "verifications" | "stop" | "respond" | "credential" | "cancel-credential" | "hold", input: unknown) =>
  prepareOperatorPost(`/api/operator/executor/${path}`, JSON.stringify(input), executorMutationResponseSchema);
export const executorScreenshot = (kind: "supervision" | "verifications" | "assistance", id: string, result = false) =>
  `/api/operator/executor/screenshots/${kind}/${encodeURIComponent(id)}${result ? "?result=1" : ""}`;
