import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MetricFeedbackController } from "./metric-feedback.controller.js";
import { MetricSnapshotStore } from "./metric-snapshot-store.js";
import { PageMetricSource } from "./page-metric-source.js";

// Supplementary HTTP serialization regression; this is not phone/business acceptance.
test("no original metric collection remains a JSON response, not an empty HTTP body", async () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  @Module({ controllers: [MetricFeedbackController], providers: [
    { provide: MetricSnapshotStore, useValue: {} },
    { provide: PageMetricSource, useValue: { readLatest: async (token: string, project: string) => {
      assert.equal(token, "A".repeat(43)); assert.equal(project, projectId); return null;
    } } },
  ] })
  class HttpRegressionModule {}
  const app = await NestFactory.create(HttpRegressionModule, { logger: false });
  try {
    await app.listen(0, "127.0.0.1");
    const response = await fetch(`${await app.getUrl()}/api/operator/projects/${projectId}/feedback/collection`, {
      headers: { cookie: `__Host-sg_operator_session=${"A".repeat(43)}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), { collection: null });
  } finally { await app.close(); }
});
