import assert from "node:assert/strict";
import test from "node:test";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { OperatorController } from "./operator.controller.js";
import type { OperatorAuthService } from "./operator-auth-service.js";
import type { InvitationManagementService } from "./invitation-management-service.js";
import { ProjectController } from "./project.controller.js";
import type { ProjectService } from "./project-service.js";
import { ProjectPlanningController } from "./project-planning.controller.js";
import type { ProjectPlanningService } from "./project-planning-service.js";
import { DeviceAssistanceFeedController } from "./device-assistance-feed.controller.js";
import type { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { DeviceAssistanceNotesController } from "./device-assistance-notes.controller.js";
import type { DeviceAssistanceNotesService } from "./device-assistance-notes-service.js";
import { MaterialUploadController } from "./material-upload.controller.js";
import type { MaterialRuntime } from "./material-runtime.js";
const name = "__Host-sg_operator_session", token = "A".repeat(43), id = "a0000000-0000-4000-8000-000000000001";
test("complete operator cookie permits only one exact base64url value and normal unrelated cookies/OWS", () => {
  for (const header of [`${name}=${token}`, `unrelated=a=b;\t${name}=${token}; another=x`, ` ${name}=${token}\t`]) assert.equal(operatorSessionTokenFrom(header), token);
  const invalid: (string | string[] | undefined)[] = [undefined, "", [`${name}=${token}`], `${name}=${token}; ${name}=${token}`,
    `${name}=${token}; ${name}`, `${name} =${token}`, `${name}=${token}=`, `${name}=${token}=extra`, `${name}=${token}==extra`,
    `${name}="${token}"`, `${name}=${token}/`, `${name}=${token}%`, `${name}=${token}\uFEFF`, `${name}=${token}\n`, `${name}=${token}\r`, `${name}=${token}\0`,
    `${name}=${token.slice(1)}`, `${name}=${token}A`, `${name}-other=${token}`];
  for (const header of invalid) assert.equal(operatorSessionTokenFrom(header), "");
});
test("all six operator controller families forward the same complete cookie and reject suffix/duplicate/array prefixes", async () => {
  let seen = "not-called"; const mark = async (value: string) => { seen = value; return "unit-forwarding-only"; };
  const operator = new OperatorController({ listOperators: mark } as unknown as OperatorAuthService, {} as InvitationManagementService);
  const projects = new ProjectController({ list: mark } as unknown as ProjectService);
  const planning = new ProjectPlanningController({ read: mark } as unknown as ProjectPlanningService);
  const feed = new DeviceAssistanceFeedController({ list: mark } as unknown as DeviceAssistanceFeedService);
  const notes = new DeviceAssistanceNotesController({ list: mark } as unknown as DeviceAssistanceNotesService);
  const material = new MaterialUploadController({ uploads: () => ({ read: async (value: string) => { seen = value; return { projectId: id, objectId: id,
    descriptor: { sha256: "a".repeat(64), bytes: 1, contentType: "video/mp4" }, status: "pending_bytes", preparedAt: "2026-10-01T00:00:00Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false }; } }) } as unknown as MaterialRuntime);
  const invoke = [(r: { headers: { cookie: string | string[] } }) => operator.list(r),
    (r: { headers: { cookie: string | string[] } }) => projects.list(r), (r: { headers: { cookie: string | string[] } }) => planning.read(id, r),
    (r: { headers: { cookie: string | string[] } }) => feed.list({}, r), (r: { headers: { cookie: string | string[] } }) => notes.list(id, {}, r),
    (r: { headers: { cookie: string | string[] } }) => material.read(id, id, r)];
  for (const run of invoke) {
    await run({ headers: { cookie: `${name}=${token}` } }); assert.equal(seen, token);
    for (const cookie of [`${name}=${token}=`, `${name}=${token}=extra`, `${name}=${token}==extra`, `${name}=${token}; ${name}=${token}`, [`${name}=${token}`]]) {
      await run({ headers: { cookie } }); assert.equal(seen, "");
    }
  }
});
