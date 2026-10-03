import assert from "node:assert/strict";
import { Socket } from "node:net";
import { HttpException } from "@nestjs/common";
import test from "node:test";
import { NetworkAdmissionController } from "./network-admission.controller.js";
import type { NetworkAdmissionApi } from "./network-admission-api.js";

test("network admission controller preserves fail-closed verifier errors", async () => {
  const socket = new Socket();
  let requestedRoute = "";
  const api = {
    handle: async (route: string) => {
      requestedRoute = route;
      return { status: 503, body: { error: { code: "VERIFIER_UNAVAILABLE", retryable: true } } };
    },
  } as unknown as NetworkAdmissionApi;
  const controller = new NetworkAdmissionController(api);
  await assert.rejects(controller.begin({ protocolVersion: "2026-09-30.admission-v1" }, "Bearer token", { socket }),
    error => error instanceof HttpException && error.getStatus() === 503
      && JSON.stringify(error.getResponse()) === JSON.stringify({ error: { code: "VERIFIER_UNAVAILABLE", retryable: true } }));
  assert.equal(requestedRoute, "begin");
});
