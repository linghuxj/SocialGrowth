// Supplemental source-function concurrency checks, not browser acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import type { MaterialCurrentView } from "./material-api.js";
import { contractVersion, materialCurrentViewSchema } from "@socialgrowth/product-contracts";
import { ProductApiError } from "./operator-api.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function current(version: number, variant = id(3)): MaterialCurrentView {
  return materialCurrentViewSchema.parse({ projectId: id(1), contentUnitId: id(2), variantId: variant,
    sourceId: id(4), sourceRecordId: id(5), languageTag: "en", currentRevision: version,
    identity: { mediaKind: "image_text", businessKind: "product", businessEntityId: id(6), seriesId: null, episodeNumber: null },
    declaration: { name: "Synthetic concurrency fixture", description: "Source functions only", businessFacts: "Synthetic facts",
      sourceStatement: "Synthetic source", sourceEvidenceIds: [id(7)], firstUseDeclaration: "declared_not_previously_published",
      expectedApprovedDirectionId: null, expectedApprovedProjectVersion: null, contentRulesReviewed: false },
    objects: [{ objectId: id(8), sha256: "a".repeat(64), bytes: 3, contentType: "image/png" }],
    recordedAt: "2026-10-02T00:00:00Z", status: "pending_validation", candidateAllowed: false, eligibilityReason: "direction_not_approved", publicationAllowed: false,
    withdrawal: { state: "not_withdrawn", materialRevision: null, requestId: null, recordedAt: null } });
}
interface SourceRow { id: string; observed?: MaterialCurrentView; saved: MaterialCurrentView;
  input: { expectedCurrentRevision: number; metadata: { contractVersion: typeof contractVersion; requestId: string; idempotencyKey: string } }; }
interface Units { readCurrent(row: SourceRow): Promise<void>; adoptCurrent?(row: SourceRow): void; }
function harness(read: (projectId: string, variantId: string) => Promise<MaterialCurrentView>) {
  const source = readFileSync(new URL("./material-workspace.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("material-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const excerpts = new Map<string, string>();
  const names = ["update", "expired", "readCurrent", "adoptCurrent"];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) excerpts.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of names.slice(0, 3)) assert.ok(excerpts.has(name), `Missing actual source function ${name}`);
  const units = excerpts.has("adoptCurrent") ? "{readCurrent, adoptCurrent}" : "{readCurrent}";
  const code = ts.transpileModule([...excerpts.values()].join("\n") + `\nglobalThis.units = ${units};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const state = {
    rows: [id(3), id(9)].map<SourceRow>(variant => ({ id: variant, saved: current(1, variant),
      input: { expectedCurrentRevision: 1, metadata: { contractVersion, requestId: "synthetic-read", idempotencyKey: "synthetic-key" } } } satisfies SourceRow)),
    alive: { current: true }, revision: { current: 0 }, currentReads: { current: new Map<string, number>() },
    error: "", expiredCount: 0, units: {} as Units,
  };
  runInNewContext(code, { ...state, readOnly: false, busy: false, projectId: id(1), readProjectMaterial: read, ProductApiError, contractVersion, crypto,
    newIdempotencyKey: () => "synthetic-new-key", onExpired: () => { state.expiredCount++; },
    setRows: (fn: (rows: SourceRow[]) => SourceRow[]) => { state.rows = fn(state.rows); },
    setError: (error: string) => { state.error = error; },
    get units() { return state.units; }, set units(value: Units) { state.units = value; } });
  return state;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test("older v2 acknowledgement cannot downgrade a newer observed v3", async () => {
  const a = deferred<MaterialCurrentView>(), b = deferred<MaterialCurrentView>(); let calls = 0;
  const state = harness(() => ++calls === 1 ? a.promise : b.promise);
  const older = state.units.readCurrent(state.rows[0]!), newer = state.units.readCurrent(state.rows[0]!);
  b.resolve(current(3)); await newer;
  a.resolve(current(2)); await older;
  assert.equal(state.rows[0]!.observed?.currentRevision, 3);
  assert.equal(state.rows[0]!.input.expectedCurrentRevision, 1, "Reading must not silently adopt a version");
});
test("reads of different materials remain independent", async () => {
  const a = deferred<MaterialCurrentView>(), b = deferred<MaterialCurrentView>();
  const state = harness((_project, variant) => variant === id(3) ? a.promise : b.promise);
  const first = state.units.readCurrent(state.rows[0]!), second = state.units.readCurrent(state.rows[1]!);
  b.resolve(current(4, id(9))); await second; a.resolve(current(3)); await first;
  assert.equal(state.rows[0]!.observed?.currentRevision, 3); assert.equal(state.rows[1]!.observed?.currentRevision, 4);
});
test("adopting the current baseline retires an in-flight read without replacing human input", async () => {
  const a = deferred<MaterialCurrentView>(); const state = harness(() => a.promise);
  const before = state.rows[0]!.input;
  state.rows[0]!.observed = current(3);
  const pending = state.units.readCurrent(state.rows[0]!);
  assert.ok(state.units.adoptCurrent); state.units.adoptCurrent(state.rows[0]!);
  a.resolve(current(2)); await pending;
  assert.equal(state.rows[0]!.observed, undefined);
  assert.equal(state.rows[0]!.saved.currentRevision, 3);
  assert.equal(state.rows[0]!.input.expectedCurrentRevision, 3);
  assert.equal(before.expectedCurrentRevision, 1);
});
test("unmount and a save/refresh generation discard in-flight observations", async () => {
  for (const mode of ["unmount", "generation"]) {
    const a = deferred<MaterialCurrentView>(), state = harness(() => a.promise);
    const pending = state.units.readCurrent(state.rows[0]!);
    if (mode === "unmount") state.alive.current = false; else state.revision.current++;
    a.resolve(current(3)); await pending; assert.equal(state.rows[0]!.observed, undefined);
  }
});
test("late failure from an obsolete read cannot clear a newer observation or expire the session", async () => {
  const a = deferred<MaterialCurrentView>(), b = deferred<MaterialCurrentView>(); let calls = 0;
  const state = harness(() => ++calls === 1 ? a.promise : b.promise);
  const old = state.units.readCurrent(state.rows[0]!), next = state.units.readCurrent(state.rows[0]!);
  b.resolve(current(3)); await next;
  a.reject(new ProductApiError({ contractVersion, requestId: "synthetic-expired", error: {
    code: "AUTHENTICATION_REQUIRED", message: "Synthetic expired", retryable: false } }, 401));
  await old;
  assert.equal(state.rows[0]!.observed?.currentRevision, 3); assert.equal(state.error, ""); assert.equal(state.expiredCount, 0);
});
