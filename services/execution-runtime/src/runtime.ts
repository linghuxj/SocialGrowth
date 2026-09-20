import { randomUUID, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { FirstLoopEngine } from "../../../apps/web-console/lib/first-loop/engine.ts";
import type {
  CommandContext,
  CommandResult,
  FirstLoopState,
} from "../../../apps/web-console/lib/first-loop/types.ts";
import type {
  ExecutionReceipt,
  PublishTaskDirective,
} from "../../../apps/artemis-controller/src/types.ts";
import { RuntimeStore } from "./store.ts";
import { z } from "zod";
import {
  bindingSchema,
  commandSchema,
  receiptSchema,
  settingsSchema,
  requireFact,
  RuntimeError,
  type Binding,
  type PublishSettings,
} from "./contracts.ts";

export interface RuntimeTask {
  directive: PublishTaskDirective;
  settings: PublishSettings;
  binding: Binding;
}
export class ExecutionRuntime {
  constructor(
    readonly store: RuntimeStore,
    private readonly options: {
      mediaBaseUrl: string;
      signingKey: string;
      now?: () => string;
      hasAsset: (sha: string) => boolean;
      canExecuteAsset?: (sha: string) => boolean;
    },
  ) {}
  now() {
    return this.options.now?.() ?? new Date().toISOString();
  }
  reconcile() {
    this.store.transaction(() => this.expireClaims());
  }
  importLegacy(raw: unknown, actor: string) {
    const shape = Object.fromEntries(
      Object.keys(this.store.snapshot().state).map((key) => [
        key,
        z.array(z.object({ id: z.string().min(1) }).passthrough()),
      ]),
    );
    const state = z.object(shape).strict().parse(raw) as unknown as FirstLoopState;
    return this.store.transaction(() => {
      requireFact(
        Object.values(this.store.snapshot().state).every((rows) => rows.length === 0),
        "IMPORT_REQUIRES_EMPTY_RUNTIME",
      );
      for (const rows of Object.values(state) as { id: string }[][])
        requireFact(new Set(rows.map((r) => r.id)).size === rows.length, "DUPLICATE_LEGACY_ID");
      for (const asset of state.sliceAssets) {
        requireFact(
          typeof asset.sha256 === "string" &&
            /^[a-f0-9]{64}$/.test(asset.sha256) &&
            this.options.hasAsset(asset.sha256),
          "LEGACY_ASSET_UPLOAD_REQUIRED",
        );
        asset.fileRef = `runtime-asset:${asset.sha256}`;
      }
      for (const approval of state.executionApprovals) {
        approval.status = "invalidated";
        approval.invalidationReason = "LEGACY_IMPORT_REAPPROVAL_REQUIRED";
      }
      for (const schedule of state.publicationSchedules) schedule.status = "cancelled";
      this.audit(
        state,
        actor,
        "workspace.legacy_imported",
        "workspace",
        { approvalPolicy: "reapproval_required" },
        [],
      );
      this.store.save(state);
      return this.store.snapshot();
    });
  }
  private context(actor: string): CommandContext {
    return { actorId: actor, correlationId: randomUUID() };
  }
  bindings(): Binding[] {
    return this.store.db
      .prepare("SELECT body FROM bindings")
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  tasks() {
    return this.store.db
      .prepare("SELECT id,status,body,receipt FROM tasks ORDER BY rowid DESC")
      .all()
      .map((r) => ({
        taskId: r.id as string,
        status: r.status as string,
        task: JSON.parse(r.body as string) as RuntimeTask,
        receipt: r.receipt ? (JSON.parse(r.receipt as string) as ExecutionReceipt) : null,
      }));
  }
  command(raw: unknown, actor: string) {
    const input = commandSchema.parse(raw);
    return this.store.transaction(() => {
      const payload = JSON.stringify({ actor, ...input });
      const old = this.store.db.prepare("SELECT * FROM commands WHERE id=?").get(input.requestId);
      if (old) {
        requireFact(old.payload === payload, "ID_CONFLICT");
        return JSON.parse(old.result as string);
      }
      const snapshot = this.store.snapshot();
      requireFact(snapshot.revision === input.revision, "REVISION_CONFLICT");
      const engine = new FirstLoopEngine(snapshot.state, { now: () => this.now() });
      // The last argument is always a CommandContext. Actor and correlation are server-owned.
      const suppliedContext = input.args.at(-1);
      requireFact(suppliedContext && typeof suppliedContext === "object", "INVALID_CONTEXT");
      const evidenceRefs = (suppliedContext as CommandContext).evidenceRefs;
      requireFact(
        !evidenceRefs ||
          (Array.isArray(evidenceRefs) && evidenceRefs.every((r) => typeof r === "string")),
        "INVALID_EVIDENCE",
      );
      const args = [...input.args.slice(0, -1), { ...this.context(actor), evidenceRefs }];
      const callable = engine[input.method] as (...args: unknown[]) => CommandResult<unknown>;
      const result = callable.apply(engine, args);
      this.store.save(engine.snapshot());
      for (const record of this.tasks()) {
        if (
          record.status === "queued" &&
          !engine
            .snapshot()
            .publicationSchedules.some(
              (s) => s.id === record.task.settings.scheduleId && s.status === "scheduled",
            )
        )
          this.store.db
            .prepare("UPDATE tasks SET status='cancelled' WHERE id=?")
            .run(record.taskId);
      }
      const response = { result, ...this.store.snapshot() };
      this.store.db
        .prepare("INSERT INTO commands VALUES (?,?,?)")
        .run(input.requestId, payload, JSON.stringify(response));
      return response;
    });
  }
  bind(raw: unknown, actor: string) {
    const binding = bindingSchema.parse(raw);
    return this.store.transaction(() => {
      const { state } = this.store.snapshot();
      const account = state.accounts.find((a) => a.id === binding.accountId);
      requireFact(account?.platform === binding.platform, "ACCOUNT_PLATFORM_MISMATCH");
      requireFact(!account.deviceRef || account.deviceRef === binding.deviceId, "DEVICE_MISMATCH");
      requireFact(
        Date.parse(binding.verifiedAt) <= Date.parse(this.now()) &&
          Date.parse(binding.validUntil) > Date.parse(this.now()),
        "BINDING_EXPIRED",
      );
      requireFact(
        !this.tasks().some(
          (t) =>
            t.task.binding.deviceId === binding.deviceId &&
            ["queued", "running", "unknown"].includes(t.status),
        ),
        "DEVICE_HAS_UNRESOLVED_TASK",
      );
      const sameId = this.bindings().find((b) => b.id === binding.id);
      requireFact(
        !sameId ||
          (sameId.accountId === binding.accountId &&
            sameId.platform === binding.platform &&
            sameId.deviceId === binding.deviceId),
        "BINDING_ID_CONFLICT",
      );
      this.store.db
        .prepare(
          "INSERT INTO bindings VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        )
        .run(
          binding.id,
          binding.deviceId,
          binding.platform,
          binding.accountId,
          JSON.stringify(binding),
        );
      this.audit(
        state,
        actor,
        "device.binding_verified",
        binding.id,
        { accountId: binding.accountId, deviceId: binding.deviceId },
        [binding.authorizationRef, binding.automationScopeRef],
      );
      this.store.save(state);
      return binding;
    });
  }
  private qualify(
    state: FirstLoopState,
    settings: PublishSettings,
    binding: Binding,
    excludeTask?: string,
  ) {
    const now = Date.parse(this.now());
    const schedule = state.publicationSchedules.find((s) => s.id === settings.scheduleId);
    const approval = state.executionApprovals.find((a) => a.id === schedule?.approvalId);
    requireFact(
      schedule &&
        (schedule.status === "scheduled" || (excludeTask && schedule.status === "started")),
      "SCHEDULE_INVALID",
    );
    requireFact(Date.parse(schedule.expiresAt) > now, "SCHEDULE_EXPIRED");
    requireFact(
      approval?.status === "active" &&
        Date.parse(approval.validUntil) >= Date.parse(schedule.expiresAt) &&
        Date.parse(approval.validFrom) <= Date.parse(schedule.scheduledFor),
      "APPROVAL_INVALID",
    );
    requireFact(
      state.projects.some((p) => p.id === approval.projectId && p.status === "active"),
      "PROJECT_INACTIVE",
    );
    requireFact(
      state.accountServiceRelations.some(
        (r) =>
          r.projectId === approval.projectId &&
          r.accountId === approval.accountId &&
          !r.revokedAt &&
          r.allowedActions.includes("publish") &&
          Date.parse(r.validFrom) <= now &&
          (!r.validUntil || Date.parse(r.validUntil) >= Date.parse(schedule.expiresAt)),
      ),
      "AUTHORIZATION_INVALID",
    );
    const currentBinding = this.bindings().find((b) => b.id === binding.id);
    requireFact(
      currentBinding &&
        JSON.stringify(currentBinding) === JSON.stringify(binding) &&
        binding.accountId === approval.accountId &&
        Date.parse(binding.validUntil) >= Date.parse(schedule.expiresAt),
      "BINDING_INVALID",
    );
    const identity = state.contentIdentities.find((i) => i.id === approval.contentIdentityId);
    requireFact(
      identity?.assignedAccountId === approval.accountId &&
        identity.allocationStatus === "assigned_locked" &&
        !identity.firstPublishedAt,
      "CONTENT_UNAVAILABLE",
    );
    requireFact(
      !state.publicationAttempts.some(
        (a) =>
          a.contentIdentityId === identity.id &&
          ["published", "unknown", "in_progress"].includes(a.publishStatus) &&
          !this.tasks().some(
            (t) => t.taskId === excludeTask && t.task.directive.attemptId === a.id,
          ),
      ),
      "CONTENT_RESULT_UNRESOLVED",
    );
    const asset = state.sliceAssets.find(
      (a) => a.id === settings.sliceId && a.contentIdentityId === identity.id,
    );
    requireFact(
      asset?.destinationFit === "eligible" &&
        asset.rightsRef === settings.rightsRef &&
        (!asset.rightsValidUntil ||
          Date.parse(asset.rightsValidUntil) >= Date.parse(schedule.expiresAt)),
      "ASSET_RIGHTS_INVALID",
    );
    requireFact(this.options.hasAsset(asset.sha256), "ASSET_NOT_UPLOADED");
    requireFact(
      !this.options.canExecuteAsset || this.options.canExecuteAsset(asset.sha256),
      "EXECUTION_REQUIRES_MP4",
    );
    const destination = state.destinationVersions.find(
      (d) => d.id === approval.destinationVersionId && d.isActive && d.health === "available",
    );
    requireFact(destination, "DESTINATION_INVALID");
    requireFact(
      settings.mode !== "publish" || settings.publishAuthorizationRef,
      "PUBLISH_AUTHORIZATION_REQUIRED",
    );
    requireFact(
      binding.platform !== "youtube" || typeof settings.madeForKids === "boolean",
      "CHILD_AUDIENCE_REQUIRED",
    );
    requireFact(
      !this.tasks().some(
        (t) =>
          t.taskId !== excludeTask &&
          t.task.directive.contentIdentityId === identity.id &&
          !["cancelled", "blocked"].includes(t.status) &&
          !(
            ["not_submitted", "confirmed_not_published"].includes(t.receipt?.publishStatus ?? "") &&
            t.status === "completed"
          ),
      ),
      "CONTENT_ALREADY_QUEUED",
    );
    return { schedule, approval, identity, asset, destination };
  }
  enqueue(raw: unknown, actor: string) {
    const settings = settingsSchema.parse(raw);
    return this.store.transaction(() => {
      const existing = this.tasks().find((t) => t.task.settings.scheduleId === settings.scheduleId);
      if (existing) {
        requireFact(
          JSON.stringify(existing.task.settings) === JSON.stringify(settings),
          "ID_CONFLICT",
        );
        return existing.task;
      }
      const { state } = this.store.snapshot();
      const binding = this.bindings().find((b) => b.id === settings.bindingId);
      requireFact(binding, "BINDING_REQUIRED");
      const { schedule, approval, identity, asset, destination } = this.qualify(
        state,
        settings,
        binding,
      );
      const taskId = randomUUID(),
        attemptId = randomUUID();
      const directive: PublishTaskDirective = {
        schemaVersion: "design-v1",
        taskId,
        attemptId,
        projectId: approval.projectId,
        strategyVersionId: approval.strategyDraftId,
        approvalId: approval.id,
        bindingId: binding.id,
        deviceId: binding.deviceId,
        accountId: binding.accountId,
        platform: binding.platform,
        targetAppPackage:
          binding.platform === "facebook" ? "com.facebook.katana" : "com.google.android.youtube",
        contentIdentityId: identity.id,
        sliceId: asset.id,
        media: {
          url: this.mediaUrl(asset.sha256, taskId, schedule.expiresAt),
          sha256: asset.sha256,
          expiresAt: schedule.expiresAt,
        },
        captionText: settings.captionText,
        destinationVersionId: destination.id,
        shortLinkUrl: destination.url,
        scheduledAt: schedule.scheduledFor,
        expiresAt: schedule.expiresAt,
        timeZone: schedule.businessTimezone,
        steps: [
          { stepIndex: 0, action: "open_app" },
          { stepIndex: 1, action: "select_media" },
          { stepIndex: 2, action: "input_text", value: settings.captionText },
        ],
        taskTimeoutMs: settings.taskTimeoutMs,
      };
      const task = { directive, settings, binding };
      directive.previousAttemptId = this.tasks().find(
        (t) => t.task.directive.contentIdentityId === identity.id,
      )?.task.directive.attemptId;
      this.store.db
        .prepare(
          "INSERT INTO tasks (id,schedule,attempt,identity,device,status,body) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          taskId,
          schedule.id,
          attemptId,
          identity.id,
          binding.deviceId,
          "queued",
          JSON.stringify(task),
        );
      this.audit(
        state,
        actor,
        "execution.queued",
        taskId,
        { scheduleId: schedule.id, mode: settings.mode },
        [
          settings.rightsRef,
          settings.musicRightsRef,
          ...(settings.publishAuthorizationRef ? [settings.publishAuthorizationRef] : []),
        ],
      );
      this.store.save(state);
      return task;
    });
  }
  pull(deviceId: string): RuntimeTask | null {
    return this.store.transaction(() => {
      this.expireClaims();
      const { state } = this.store.snapshot();
      const records = this.tasks().reverse();
      if (this.store.db.prepare("SELECT 1 FROM pauses WHERE scope=?").get(`device:${deviceId}`))
        return null;
      if (records.some((t) => t.task.binding.deviceId === deviceId && t.status === "running"))
        return null;
      for (const record of records) {
        const task = record.task;
        if (record.status !== "queued" || task.binding.deviceId !== deviceId) continue;
        if (Date.parse(task.directive.scheduledAt) > Date.parse(this.now())) continue;
        try {
          this.qualify(state, task.settings, task.binding, record.taskId);
        } catch (error) {
          this.store.db.prepare("UPDATE tasks SET status='blocked' WHERE id=?").run(record.taskId);
          this.audit(
            state,
            "controller",
            "execution.dispatch_rejected",
            record.taskId,
            { reason: error instanceof RuntimeError ? error.code : "QUALIFICATION_INVALID" },
            [],
          );
          this.store.save(state);
          continue;
        }
        if (
          this.store.db
            .prepare("SELECT 1 FROM pauses WHERE scope IN (?,?,?)")
            .get(
              `account:${task.binding.accountId}`,
              `project:${task.directive.projectId}`,
              `content:${task.directive.contentIdentityId}`,
            )
        )
          continue;
        this.store.db
          .prepare("UPDATE tasks SET status='running',claimed_at=? WHERE id=? AND status='queued'")
          .run(this.now(), record.taskId);
        const schedule = state.publicationSchedules.find((s) => s.id === task.settings.scheduleId)!;
        schedule.status = "started";
        const engine = new FirstLoopEngine(state, { now: () => this.now() });
        engine.recordExecutionReceipt(
          {
            attemptId: task.directive.attemptId,
            contentIdentityId: task.directive.contentIdentityId,
            sliceId: task.directive.sliceId,
            accountId: task.directive.accountId,
            publishStatus: "in_progress",
            evidenceRefs: [],
          },
          this.context("controller"),
        );
        this.store.save(engine.snapshot());
        return task;
      }
      return null;
    });
  }
  private expireClaims() {
    for (const record of this.tasks()) {
      if (record.status !== "running") continue;
      const row = this.store.db
        .prepare("SELECT claimed_at FROM tasks WHERE id=?")
        .get(record.taskId)!;
      if (
        Date.parse(row.claimed_at as string) + record.task.directive.taskTimeoutMs >
        Date.parse(this.now())
      )
        continue;
      this.applyReceipt(record.task, {
        schemaVersion: "design-v1",
        eventId: randomUUID(),
        taskId: record.taskId,
        attemptId: record.task.directive.attemptId,
        deviceId: record.task.binding.deviceId,
        accountId: record.task.binding.accountId,
        occurredAt: this.now(),
        executionStatus: "failed",
        publishStatus: "unknown",
        evidenceRefs: [],
        failureCode: "TECHNICAL_FAILURE",
        resourceStatus: "error",
      });
    }
  }
  receive(raw: unknown, deviceId: string) {
    const receipt = receiptSchema.parse(raw);
    return this.store.transaction(() => {
      const record = this.tasks().find((t) => t.taskId === receipt.taskId);
      requireFact(
        record && record.status !== "queued" && record.task.binding.deviceId === deviceId,
        "RECEIPT_SCOPE_INVALID",
      );
      const task = record.task;
      requireFact(
        receipt.deviceId === deviceId &&
          receipt.attemptId === task.directive.attemptId &&
          receipt.accountId === task.binding.accountId,
        "RECEIPT_SCOPE_INVALID",
      );
      requireFact(
        receipt.evidenceRefs.every((ref) =>
          this.store.db
            .prepare("SELECT 1 FROM evidence WHERE id=? AND task=?")
            .get(ref, receipt.taskId),
        ),
        "EVIDENCE_NOT_ARCHIVED",
      );
      requireFact(
        receipt.publishStatus !== "not_submitted" ||
          receipt.evidenceRefs.length > 0 ||
          receipt.failureCode === "EXECUTOR_NOT_CONFIGURED",
        "ACTION_PROGRESS_EVIDENCE_REQUIRED",
      );
      const old = this.store.db.prepare("SELECT body FROM events WHERE id=?").get(receipt.eventId);
      if (old) {
        requireFact(old.body === JSON.stringify(receipt), "ID_CONFLICT");
        return record.receipt;
      }
      return this.applyReceipt(task, receipt);
    });
  }
  private applyReceipt(task: RuntimeTask, incoming: ExecutionReceipt) {
    const old = this.tasks().find((t) => t.taskId === task.directive.taskId)?.receipt;
    this.store.db
      .prepare("INSERT INTO events VALUES (?,?,?)")
      .run(incoming.eventId, incoming.taskId, JSON.stringify(incoming));
    // Published is monotonic; uncertain outcomes cannot be cleared by an agent saying "not submitted".
    let retained = incoming;
    if (old?.publishStatus === "published") retained = old;
    else if (
      old &&
      ["unknown", "in_progress"].includes(old.publishStatus) &&
      incoming.publishStatus === "not_submitted"
    )
      retained = {
        ...incoming,
        publishStatus: "unknown",
        failureCode: "RECEIPT_CONFLICT",
        resourceStatus: "error",
      };
    const status = ["unknown", "in_progress"].includes(retained.publishStatus)
      ? "unknown"
      : retained.executionStatus === "blocked" ? "blocked" : "completed";
    this.store.db
      .prepare("UPDATE tasks SET status=?,receipt=? WHERE id=?")
      .run(status, JSON.stringify(retained), incoming.taskId);
    if (
      status === "unknown" ||
      incoming.failureCode === "IDENTITY_CHALLENGE" ||
      (task.settings.mode === "preflight" && incoming.publishStatus === "published")
    ) {
      for (const scope of [
        `device:${task.binding.deviceId}`,
        `account:${task.binding.accountId}`,
        `project:${task.directive.projectId}`,
        `content:${task.directive.contentIdentityId}`,
      ])
        this.store.db
          .prepare("INSERT OR REPLACE INTO pauses VALUES (?,?)")
          .run(scope, incoming.failureCode ?? retained.publishStatus);
    }
    const { state } = this.store.snapshot();
    if (["not_submitted", "confirmed_not_published"].includes(retained.publishStatus)) {
      const schedule = state.publicationSchedules.find((s) => s.id === task.settings.scheduleId);
      if (schedule) schedule.status = "cancelled";
      const approval = state.executionApprovals.find((a) => a.id === task.directive.approvalId);
      if (approval) {
        approval.status = "invalidated";
        approval.invalidationReason = "ATTEMPT_FINISHED_REAPPROVAL_REQUIRED";
      }
    }
    const engine = new FirstLoopEngine(state, { now: () => this.now() });
    const result = engine.recordExecutionReceipt(
      {
        attemptId: task.directive.attemptId,
        contentIdentityId: task.directive.contentIdentityId,
        sliceId: task.directive.sliceId,
        accountId: task.binding.accountId,
        publishStatus: retained.publishStatus,
        evidenceRefs: retained.evidenceRefs,
      },
      this.context(`agent:${task.binding.deviceId}`),
    );
    requireFact(result.ok, "RECEIPT_BUSINESS_CONFLICT");
    this.store.save(engine.snapshot());
    return retained;
  }
  review(raw: unknown, actor: string) {
    const input = z
      .object({
        taskId: z.string(),
        publishStatus: z.enum(["published", "confirmed_not_published", "not_submitted"]),
        evidenceRefs: z.array(z.string()).min(1),
        publishedUrl: z.string().url().optional(),
        publishedPostId: z.string().optional(),
        reason: z.string().trim().min(1),
        relatedScopeReviewed: z.literal(true),
        authorizationRechecked: z.literal(true),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const record = this.tasks().find((t) => t.taskId === input.taskId);
      requireFact(
        record && ["unknown", "completed", "blocked"].includes(record.status),
        "TASK_NOT_REVIEWABLE",
      );
      requireFact(
        input.publishStatus !== "not_submitted" ||
          (record.status === "blocked" && record.receipt?.publishStatus === "not_submitted" && !!record.receipt.actionRequired),
        "NON_SUBMISSION_NOT_ESTABLISHED",
      );
      requireFact(
        input.evidenceRefs.every((ref) =>
          this.store.db
            .prepare("SELECT 1 FROM evidence WHERE id=? AND task=?")
            .get(ref, input.taskId),
        ),
        "EVIDENCE_NOT_ARCHIVED",
      );
      const d = record.task.directive;
      const receipt = receiptSchema.parse({
        schemaVersion: "design-v1",
        eventId: randomUUID(),
        taskId: d.taskId,
        attemptId: d.attemptId,
        deviceId: d.deviceId,
        accountId: d.accountId,
        occurredAt: this.now(),
        executionStatus: "completed",
        publishStatus: input.publishStatus,
        evidenceRefs: input.evidenceRefs,
        publishedUrl: input.publishedUrl,
        publishedPostId: input.publishedPostId,
        resourceStatus: "available",
      });
      requireFact(
        record.receipt?.publishStatus !== "published" || input.publishStatus === "published",
        "PUBLISHED_FACT_IMMUTABLE",
      );
      this.applyReceipt(record.task, receipt);
      const outstanding = this.tasks().filter(
        (t) => t.status === "unknown" || t.status === "running" ||
          (t.status === "blocked" && t.receipt?.failureCode === "IDENTITY_CHALLENGE"),
      );
      for (const [kind, value] of [
        ["device", d.deviceId],
        ["account", d.accountId],
        ["project", d.projectId],
        ["content", d.contentIdentityId],
      ]) {
        const property = {
          device: "deviceId",
          account: "accountId",
          project: "projectId",
          content: "contentIdentityId",
        }[kind] as keyof PublishTaskDirective;
        if (!outstanding.some((t) => t.task.directive[property] === value))
          this.store.db.prepare("DELETE FROM pauses WHERE scope=?").run(`${kind}:${value}`);
      }
      const { state } = this.store.snapshot();
      const schedule = state.publicationSchedules.find(
        (s) => s.id === record.task.settings.scheduleId,
      );
      if (schedule) schedule.status = "cancelled";
      const approval = state.executionApprovals.find((a) => a.id === d.approvalId);
      if (approval) {
        approval.status = "invalidated";
        approval.invalidationReason = "MANUAL_REVIEW_REAPPROVAL_REQUIRED";
      }
      this.audit(
        state,
        actor,
        "execution.manually_reviewed",
        d.taskId,
        { reason: input.reason, publishStatus: input.publishStatus },
        input.evidenceRefs,
      );
      this.store.save(state);
      return receipt;
    });
  }
  observe(raw: unknown, actor: string) {
    const input = z
      .object({
        taskId: z.string().min(1),
        source: z.string().min(1),
        capturedAt: z.string().datetime({ offset: true }),
        publiclyVisible: z.boolean(),
        processing: z.enum(["processing", "ready", "failed", "unknown"]),
        restrictionNotices: z.array(z.string()),
        evidenceRefs: z.array(z.string()).min(1),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const task = this.tasks().find((t) => t.taskId === input.taskId);
      requireFact(task && task.status !== "queued", "TASK_NOT_OBSERVABLE");
      requireFact(
        Date.parse(input.capturedAt) <= Date.parse(this.now()),
        "OBSERVATION_FROM_FUTURE",
      );
      requireFact(
        input.evidenceRefs.every((ref) =>
          this.store.db
            .prepare("SELECT 1 FROM evidence WHERE id=? AND task=?")
            .get(ref, input.taskId),
        ),
        "EVIDENCE_NOT_ARCHIVED",
      );
      const observation = { id: randomUUID(), ...input };
      this.store.db
        .prepare("INSERT INTO observations VALUES (?,?,?)")
        .run(observation.id, input.taskId, JSON.stringify(observation));
      const { state } = this.store.snapshot();
      this.audit(
        state,
        actor,
        "publication.observed",
        input.taskId,
        {
          processing: input.processing,
          publiclyVisible: String(input.publiclyVisible),
          source: input.source,
        },
        input.evidenceRefs,
      );
      this.store.save(state);
      return observation;
    });
  }
  archiveEvidence(taskId: string, deviceId: string, mime: string, bytes: Buffer) {
    requireFact(
      bytes.length > 0 &&
        bytes.length <= 8 * 1024 * 1024 &&
        ["image/png", "application/json", "text/plain"].includes(mime),
      "EVIDENCE_INVALID",
    );
    const record = this.tasks().find((t) => t.taskId === taskId);
    requireFact(
      record && record.status !== "queued" && record.task.binding.deviceId === deviceId,
      "EVIDENCE_SCOPE_INVALID",
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    const id = `evidence:${taskId}:${digest}`;
    this.store.db
      .prepare("INSERT OR IGNORE INTO evidence VALUES (?,?,?,?,?)")
      .run(id, taskId, digest, mime, bytes);
    return id;
  }
  mediaUrl(sha: string, task: string, expires: string) {
    const signature = createHmac("sha256", this.options.signingKey)
      .update(`${sha}\n${task}\n${expires}`)
      .digest("hex");
    return `${this.options.mediaBaseUrl}/api/runtime/media/${sha}?${new URLSearchParams({ task, expires, signature })}`;
  }
  verifyMedia(sha: string, query: URLSearchParams) {
    const task = query.get("task") ?? "",
      expires = query.get("expires") ?? "",
      signature = query.get("signature") ?? "";
    requireFact(Date.parse(expires) > Date.parse(this.now()), "MEDIA_URL_EXPIRED");
    const expected = new URL(this.mediaUrl(sha, task, expires)).searchParams.get("signature")!;
    requireFact(
      /^[a-f0-9]{64}$/.test(signature) &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
      "MEDIA_SIGNATURE_INVALID",
    );
    requireFact(
      this.tasks().some((t) => t.taskId === task && t.task.directive.media.sha256 === sha),
      "MEDIA_TASK_INVALID",
    );
  }
  private audit(
    state: FirstLoopState,
    actor: string,
    action: string,
    entityId: string,
    facts: Record<string, string>,
    evidenceRefs: string[],
  ) {
    state.auditLogs.push({
      id: randomUUID(),
      timestamp: this.now(),
      correlationId: randomUUID(),
      actorId: actor,
      action,
      entityType: "execution",
      entityId,
      result: "accepted",
      reasonCode: "OK",
      facts,
      evidenceRefs,
    });
  }
}
