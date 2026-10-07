import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { OperatorAuthService } from "./operator-auth-service.js";
import { PageMetricSource } from "./page-metric-source.js";

test("native reports keep observed zero distinct from missing and reject unmatched or unarchived Page facts", () => {
  const pool = new Pool(); const source = new PageMetricSource(pool, new OperatorAuthService(pool, "isolated-native-metric-test-pepper-00001"), null);
  const row: Parameters<PageMetricSource["reports"]>[0] = {
    operationId: randomUUID(), projectId: randomUUID(), identityId: randomUUID(), accountId: randomUUID(), state: "completed",
    pageId: "123456789", pageUrl: "https://www.facebook.com/profile.php?id=123456789", pageName: "Bound Test Page",
    collectedAt: "2026-10-06T08:00:00Z", traceId: randomUUID(), evidenceVerified: true, evidenceRefs: [randomUUID(), randomUUID(), randomUUID()], errorCode: null,
    facts: { pageId: "123456789", pageUrl: "https://www.facebook.com/profile.php?id=123456789", pageName: "Bound Test Page", managementVerified: true,
      finalSubmitClicked: false, mutationsPerformed: 0, screenTitle: "Insights", metrics: [
        { key: "views", label: "Views", unit: null, sourceDefinition: null, value: "0", availability: "available", missingReason: null,
          measurement: "interval", coverage: null, statisticsCutoffAt: null, sourceTimeZone: null },
        { key: "reach", label: null, unit: null, sourceDefinition: null, value: null, availability: "missing", missingReason: "no_data",
          measurement: "interval", coverage: null, statisticsCutoffAt: null, sourceTimeZone: null },
      ] },
  };
  const reports = source.reports(row);
  assert.equal(reports[0]!.value, "0"); assert.equal(reports[0]!.availability, "available");
  assert.equal(reports[0]!.metricDefinition?.unit, null); assert.equal(reports[0]!.coverage, null);
  assert.equal(reports[1]!.value, null); assert.equal(reports[1]!.availability, "missing");
  assert.deepEqual(source.reports({ ...row, evidenceVerified: false }), []);
  assert.deepEqual(source.reports({ ...row, pageId: "999999999" }), []);
  assert.throws(() => source.reports({ ...row, facts: { ...row.facts!, metrics: [{ ...row.facts!.metrics[1]!, value: "0" }] } }));
});
