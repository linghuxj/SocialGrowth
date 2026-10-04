import { useEffect, useRef, useState } from "react";
import { projectPlanningInputsSchema, type ProjectCycleConfigurationReadResponse, type ProjectCycleOrigin, type SaveProjectCycleConfigurationReceipt } from "@socialgrowth/product-contracts";
import { ArrowClockwise } from "@phosphor-icons/react";
import { currentOperatorSessionContext, isDefinitiveProjectRejection, ProductApiError } from "./operator-api.js";
import {
  PreparedProjectCycleConfiguration,
  ProjectCycleConfigurationApiError,
  clearProjectCycleConfigurationPending,
  persistProjectCycleConfigurationPending,
  readProjectCycleConfigurationPending,
  readProjectCycleConfiguration,
  readProjectCycleConfigurationCommand,
} from "./project-cycle-config-api.js";

const zones = projectPlanningInputsSchema.shape.businessTimeZone.unwrap().options;
type CycleView = ProjectCycleConfigurationReadResponse;
type ConfigForm = { businessTimeZone: string; reviewIntervalDays: string; trafficMinimumPerCycle: string };
const reasonText: Record<string, string> = {
  current_cycle_missing: "没有可配置的当前周期。",
  current_cycle_stale: "当前周期事实已变化，服务未保存新配置。",
  previous_window_elapsed: "当前周期窗口已结束，服务未保存新配置。",
  calendar_runtime_unavailable: "周期日历运行时不可用，服务未保存新配置。",
  outside_verified_calendar_range: "目标结束时间超出已验证日历范围，服务未保存新配置。",
  civil_boundary_ambiguous: "时区边界存在歧义，服务未保存新配置。",
  predecessor_missing: "缺少可核实的前序周期，服务未猜测应用配置。",
  source_missing: "缺少可核实的配置来源，服务未猜测应用配置。",
  configuration_already_consumed: "该配置已被周期消费，服务未重复应用。",
  window_preview_mismatch: "周期窗口与确认时预览不一致，服务未猜测应用配置。",
  project_ended: "项目已结束，不再猜测新的周期窗口。",
  tail_window_unconfigured: "结束后的观察窗口尚无权威配置，服务未猜测新周期。",
};

function formatInstant(value: string | null | undefined): string {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间格式未知";
  return `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

function formFrom(view: CycleView): ConfigForm {
  const values = view.nextConfiguration ?? view.currentCycle;
  return values ? {
    businessTimeZone: values.businessTimeZone,
    reviewIntervalDays: String(values.reviewIntervalDays),
    trafficMinimumPerCycle: String(values.trafficMinimumPerCycle),
  } : { businessTimeZone: "", reviewIntervalDays: "", trafficMinimumPerCycle: "" };
}

function formFromReceipt(receipt: SaveProjectCycleConfigurationReceipt, view: CycleView | null): ConfigForm {
  const values = receipt.nextConfiguration ?? view?.currentCycle;
  return values ? {
    businessTimeZone: values.businessTimeZone,
    reviewIntervalDays: String(values.reviewIntervalDays),
    trafficMinimumPerCycle: String(values.trafficMinimumPerCycle),
  } : { businessTimeZone: "", reviewIntervalDays: "", trafficMinimumPerCycle: "" };
}

function originDescription(origin: ProjectCycleOrigin): string {
  switch (origin.kind) {
    case "initial_direction_approval": return `首次方向批准 · ${origin.approvalId}`;
    case "confirmed_next_configuration": return `运营确认配置版本 ${origin.configurationRevision}`;
    case "carry_forward": return `沿用前序周期 · ${origin.predecessorCycleId}`;
  }
}

export function ProjectCycleConfigPanel({ projectId, active, readOnly, onExpired, onFactsChanged }: {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (error: unknown) => void; onFactsChanged: () => void;
}) {
  const [view, setView] = useState<CycleView | null>(null);
  const [form, setForm] = useState<ConfigForm>({ businessTimeZone: "", reviewIntervalDays: "", trafficMinimumPerCycle: "" });
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PreparedProjectCycleConfiguration | null>(null);
  const [pendingActorMatches, setPendingActorMatches] = useState(true);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [keyConflict, setKeyConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const pendingRef = useRef<PreparedProjectCycleConfiguration | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current++; };
  }, []);

  useEffect(() => {
    const stored = readProjectCycleConfigurationPending(projectId);
    if (stored.status === "invalid") {
      setStorageBlocked(true);
      setError("检测到未能安全解析的本地周期配置请求记录；记录未删除，禁止发起新配置。 ");
      return;
    }
    if (stored.status === "missing") { setStorageBlocked(false); return; }
    try {
      const command = PreparedProjectCycleConfiguration.fromFrozen(projectId, stored.value.body);
      const identity = currentOperatorSessionContext();
      setPendingCommand(command);
      const sameOperator = identity !== null && identity.operatorId === stored.value.operatorId;
      setPendingActorMatches(sameOperator);
      const rawBody = JSON.parse(stored.value.body) as { businessTimeZone: string; reviewIntervalDays: number; trafficMinimumPerCycle: number };
      setForm({ businessTimeZone: rawBody.businessTimeZone, reviewIntervalDays: String(rawBody.reviewIntervalDays), trafficMinimumPerCycle: String(rawBody.trafficMinimumPerCycle) });
      dirtyRef.current = true;
      setDirty(true);
      setStorageBlocked(false);
      setError(sameOperator
        ? "已恢复冻结的原请求；请只读核对原回执，或在同一运营账号下明确接续同一请求。 "
        : "本地保留了另一运营账号发起的未知请求；仅展示并保留原事实，不向当前账号提交或查询该命令。请由原运营账号登录后核对。 ");
    } catch {
      setStorageBlocked(true);
      setError("本地周期配置请求记录无法校验；记录未删除，禁止发起新配置。 ");
    }
  }, [projectId]);

  function setPendingCommand(command: PreparedProjectCycleConfiguration | null) {
    pendingRef.current = command;
    setPending(command);
  }

  function consumePending(command: PreparedProjectCycleConfiguration): boolean {
    if (!clearProjectCycleConfigurationPending(command.projectId, command.idempotencyKey)) {
      setError("请求已有回执，但本地冻结记录无法安全更新；继续保留原请求以便核对。 ");
      return false;
    }
    setPendingCommand(null);
    setPendingActorMatches(true);
    setKeyConflict(false);
    return true;
  }

  function pendingBelongsToCurrentOperator(command: PreparedProjectCycleConfiguration): boolean {
    const stored = readProjectCycleConfigurationPending(command.projectId);
    const identity = currentOperatorSessionContext();
    const matches = stored.status === "valid" && identity !== null
      && stored.value.idempotencyKey === command.idempotencyKey && stored.value.body === command.body
      && stored.value.operatorId === identity.operatorId;
    setPendingActorMatches(matches);
    return matches;
  }

  async function refresh(options: { preserveError?: boolean } = {}) {
    const current = ++generation.current;
    setLoading(true);
    if (!options.preserveError) setError("");
    try {
      const next = await readProjectCycleConfiguration(projectId);
      if (!alive.current || current !== generation.current) return;
      setView(next);
      if (!dirtyRef.current && !pendingRef.current) setForm(formFrom(next));
    } catch (cause) {
      if (!alive.current || current !== generation.current) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("周期配置事实读取失败；当前周期与待生效配置保持未知，请重试。 ");
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (active) {
      if (pendingRef.current) pendingBelongsToCurrentOperator(pendingRef.current);
      void refresh();
    }
  }, [active, projectId]);

  function edit(key: keyof ConfigForm, value: string) {
    if (readOnly || busyRef.current || pendingRef.current) return;
    setForm(current => ({ ...current, [key]: value }));
    dirtyRef.current = true;
    setDirty(true);
    setMessage("");
  }

  function reportFailure(cause: unknown, writing: boolean) {
    if (cause instanceof ProductApiError && cause.status === 401) { onExpired(cause); return; }
    if (cause instanceof ProductApiError && cause.response.error.code === "IDEMPOTENCY_KEY_REUSED") {
      setKeyConflict(true);
      setError("服务拒绝了已占用的原请求键；原输入与键继续冻结，请勿改键或自动重发。 ");
      return;
    }
    if (cause instanceof ProjectCycleConfigurationApiError && cause.code === "CYCLE_CONFIG_INPUT_INVALID") {
      setError("输入未通过本地校验，没有发送请求。 ");
      return;
    }
    setError(writing
      ? "保存回执未确认，结果未知；原请求内容与请求键已冻结，可先核对回执或明确接续原请求。 "
      : "周期配置事实读取失败；没有把未知当作未配置。 ");
  }

  async function verifyPending() {
    const command = pendingRef.current;
    if (!command || busyRef.current || storageBlocked || !pendingBelongsToCurrentOperator(command)) {
      if (command && !storageBlocked) setError("当前运营身份无法核对这条未知命令；原请求仍安全保留。 ");
      return;
    }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await readProjectCycleConfigurationCommand(projectId, command.idempotencyKey);
      if (!alive.current || pendingRef.current !== command) return;
      if (result.status === "found" && result.receipt) {
        const receipt = result.receipt;
        if (result.requestId !== command.requestId || receipt.requestId !== command.requestId) {
          setKeyConflict(true);
          setError("原请求键读回的请求编号与冻结命令不一致；继续保持未知并冻结原输入。 ");
          return;
        }
        if (!consumePending(command)) return;
        if (receipt.outcome !== "unresolved") { dirtyRef.current = false; setDirty(false); setForm(formFromReceipt(receipt, view)); }
        onFactsChanged();
        await refresh();
        if (receipt.outcome === "unresolved") setMessage(reasonText[receipt.reason ?? ""] ?? "服务记录了未解决结果，原配置未改变。 ");
        else setMessage(receipt.outcome === "confirmed"
          ? `已核对原请求回执：运营已确认配置版本 ${receipt.configurationRevision}。该回执只证明配置确认，不表示周期窗口已经物化或复盘已运行。`
          : `已核对原请求回执：配置未变化，当前配置版本 ${receipt.configurationRevision}。`);
      } else {
        setMessage("当前运营身份下未找到原请求回执；这不证明原请求未执行。原请求内容和键保持冻结，可明确接续同一请求。 ");
      }
    } catch (cause) { reportFailure(cause, false); }
    finally { if (alive.current) { busyRef.current = false; setBusy(false); } }
  }

  async function save() {
    const existingCommand = pendingRef.current;
    if (readOnly || busyRef.current || keyConflict || storageBlocked
      || (!dirty && !existingCommand) || (!existingCommand && !view?.currentCycle)) return;
    let command = existingCommand;
    let identity = currentOperatorSessionContext();
    if (command) {
      if (!pendingBelongsToCurrentOperator(command) || !identity) {
        setError("当前运营身份无法接续这条未知命令；原请求仍冻结保留。 ");
        return;
      }
      try { command = PreparedProjectCycleConfiguration.fromFrozen(projectId, command.body); }
      catch { setError("原请求无法安全重建；仍保留本地冻结记录，没有发送。 "); return; }
      if (!persistProjectCycleConfigurationPending(command, identity)) {
        setError("当前请求上下文无法安全保存；仍保留原请求，没有发送。 ");
        return;
      }
      setPendingCommand(command);
    }
    if (!command) {
      const currentCycle = view?.currentCycle;
      if (!view || !currentCycle) return;
      if (!identity) { setError("当前登录缺少可验证的运营身份上下文；未发送请求。请重新登录后再确认。 "); return; }
      const integer = (value: string) => /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
      const interval = integer(form.reviewIntervalDays), minimum = integer(form.trafficMinimumPerCycle);
      if (interval === null || interval < 1 || interval > 366 || minimum === null) {
        setError("请提供受支持的业务时区、1–366 天间隔及非负整数最低数；输入保留。 ");
        return;
      }
      try {
        command = new PreparedProjectCycleConfiguration(projectId, {
          expectedConfigurationRevision: view.configurationRevision,
          businessTimeZone: form.businessTimeZone,
          reviewIntervalDays: interval,
          trafficMinimumPerCycle: minimum,
        });
      } catch {
        setError("请提供受支持的业务时区、1–366 天间隔及非负整数最低数；输入保留。 ");
        return;
      }
      const confirmed = window.confirm(`确认保存下周期配置？当前周期及历史不变；新配置仅待生效，起点沿用当前周期结束时刻 ${formatInstant(currentCycle.endsAt)}。这不会创建周期、任务或打开执行/发布权限。`);
      if (!confirmed) return;
      if (!persistProjectCycleConfigurationPending(command, identity)) {
        setError("浏览器无法安全保存本次冻结请求；尚未发送，输入保留。请启用会话存储后重试。 ");
        return;
      }
      setPendingCommand(command);
      setPendingActorMatches(true);
      setKeyConflict(false);
    }
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const receipt = await command.send();
      if (!alive.current) return;
      if (!consumePending(command)) return;
      if (receipt.outcome !== "unresolved") { dirtyRef.current = false; setDirty(false); setForm(formFromReceipt(receipt, view)); }
      onFactsChanged();
      await refresh();
      if (receipt.outcome === "unresolved") setMessage(reasonText[receipt.reason ?? ""] ?? "服务记录了未解决结果，原配置未改变。 ");
      else if (receipt.outcome === "confirmed") setMessage(`运营已确认配置版本 ${receipt.configurationRevision}。此回执只证明配置确认，不表示周期窗口已经物化或复盘已运行；当前历史、执行和发布权限未改变。`);
      else setMessage(`配置未变化，当前配置版本 ${receipt.configurationRevision}。没有创建后继周期。`);
    } catch (cause) {
      if (cause instanceof ProductApiError && cause.response.error.code === "FACT_VERSION_STALE") {
        if (pendingRef.current === command && !consumePending(command)) return;
        await refresh({ preserveError: true });
        const stale = "配置版本已过期；服务拒绝了本次写入。请核对刷新后的当前事实后再明确确认。 ";
        setError(current => current.includes("周期配置事实读取失败")
          ? `${stale}刷新未能读取当前周期事实，当前状态保持未知。 ` : stale);
      } else if (isDefinitiveProjectRejection(cause)) {
        if (pendingRef.current === command && !consumePending(command)) return;
        dirtyRef.current = true;
        setError("服务明确拒绝了本次输入；输入保留，可以修正后重新确认。 ");
      } else reportFailure(cause, true);
    } finally { if (alive.current) { busyRef.current = false; setBusy(false); } }
  }

  const current = view?.currentCycle ?? null;
  const next = view?.nextConfiguration ?? null;
  const locked = readOnly || busy || !!pending || storageBlocked;
  return <section className="panel planning-cycle-config" aria-label="下周期配置确认">
    <div className="section-heading"><div><h3>运行周期：下周期配置</h3><p className="muted">保存回执只证明配置已确认；下方读取服务提供的窗口来源与应用事实，不代表复盘、任务、执行或发布已经运行。</p></div>
      <button className="outline-button" disabled={loading || busy} onClick={() => void refresh()}><ArrowClockwise size={18} />刷新周期事实</button>
    </div>
    {error && <p role="alert" className="feedback">{error}</p>}{message && <p role="status" className="feedback">{message}</p>}
    {loading && <p role="status">正在读取周期事实…</p>}
    {!view ? <p>周期配置尚未读取，不能推定当前周期或待生效配置不存在。</p> : <>
      <div className="project-direction-note">
        <h4>当前周期（不可修改）</h4>
        {current ? <dl>
          <dt>周期</dt><dd>#{current.cycleNumber} · {current.cycleId}</dd>
          <dt>配置版本</dt><dd>{current.configVersion}</dd>
          <dt>业务时区 / 间隔</dt><dd>{current.businessTimeZone} · {current.reviewIntervalDays} 天</dd>
          <dt>每周期引流最低数</dt><dd>{current.trafficMinimumPerCycle}</dd>
          <dt>实际起止时刻</dt><dd>{formatInstant(current.startsAt)} – {formatInstant(current.endsAt)}</dd>
          <dt>周期来源</dt><dd>{originDescription(current.origin)}</dd>
          <dt>窗口记录时间</dt><dd>{formatInstant(current.recordedAt)}（数据库记录时间，不是周期边界）</dd>
        </dl> : <p>服务已确认当前无活动周期；下周期配置不能在此状态下提交。</p>}
      </div>
      <div className="project-direction-note">
        <h4>已确认的周期配置</h4>
        {next ? <dl>
          <dt>配置版本 / 确认时来源周期</dt><dd>{next.configurationRevision} / {next.basedOnCycleId}</dd>
          <dt>时区 / 间隔</dt><dd>{next.businessTimeZone} · {next.reviewIntervalDays} 天</dd>
          <dt>每周期引流最低数</dt><dd>{next.trafficMinimumPerCycle}</dd>
          <dt>原确认边界起点</dt><dd>{formatInstant(next.effectiveStartsAt)}</dd>
          <dt>确认时预览的结束时刻</dt><dd>{formatInstant(next.projectedEndsAt)}</dd>
          <dt>确认事实</dt><dd>{next.confirmedAt} · 运营 {next.confirmedByOperatorId} · 请求 {next.requestId}</dd>
          <dt>配置应用状态</dt><dd>{next.application.state === "pending" ? "待后继周期消费" : next.application.state === "applied"
            ? `已由周期 ${next.application.materializedCycleId} 唯一消费（只证明窗口事实，不表示复盘已运行）`
            : `未解决：${reasonText[next.application.reason ?? ""] ?? "周期来源或窗口无法确认，服务未猜测应用。"}`}</dd>
        </dl> : <p>{current ? "尚无独立运营确认的下周期配置；后续窗口沿用当前周期配置。" : "尚无独立运营确认的下周期配置，且当前没有活动周期；不能推定存在可沿用的后继窗口。"}</p>}
        <p>{current ? "当前周期之后尚无已物化的下一个周期（nextCycle=null）。" : "当前没有活动周期，服务未返回后继周期窗口（nextCycle=null）。"}已物化窗口只代表周期边界和来源事实，不代表复盘、指标采集、策略、任务或发布已经运行。</p>
      </div>
      <fieldset disabled={locked || !current} className="planning-form-grid">
        <label>下周期业务时区<select aria-label="下周期业务时区" value={form.businessTimeZone} onChange={e => edit("businessTimeZone", e.target.value)}><option value="">请选择</option>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        <label>下周期复盘间隔（1–366 天）<input aria-label="下周期复盘间隔（天）" inputMode="numeric" min="1" max="366" value={form.reviewIntervalDays} onChange={e => edit("reviewIntervalDays", e.target.value)} /></label>
        <label>下周期每周期引流最低数<input aria-label="下周期每周期引流最低数" inputMode="numeric" min="0" value={form.trafficMinimumPerCycle} onChange={e => edit("trafficMinimumPerCycle", e.target.value)} /></label>
      </fieldset>
    </>}
    {pending && <p className="form-note" aria-label="冻结的原请求">原请求编号 {pending.requestId} · 请求键 <code>{pending.idempotencyKey}</code>{!pendingActorMatches && " · 当前登录身份不同，仅保留未知事实"}</p>}
    {(!readOnly || pending) && <div className="project-save-actions">
      {!readOnly && !pending && <><button disabled={busy || keyConflict || storageBlocked || loading || !current || !dirty || !pendingActorMatches} onClick={() => void save()}>确认下周期配置</button>
        <button className="outline-button" disabled={busy || storageBlocked || !!pending || !dirty} onClick={() => { if (view) setForm(formFrom(view)); dirtyRef.current = false; setDirty(false); setError(""); }}>放弃本次修改</button></>}
      {pending && <>
        <button className="outline-button" disabled={busy || !pendingActorMatches || storageBlocked} onClick={() => void verifyPending()}>只读核对原请求回执</button>
        {!readOnly && <button className="outline-button" disabled={busy || keyConflict || !pendingActorMatches || storageBlocked} onClick={() => void save()}>{keyConflict ? "请求键冲突，停止重发" : "明确接续同一请求"}</button>}
      </>}
    </div>}
  </section>;
}
