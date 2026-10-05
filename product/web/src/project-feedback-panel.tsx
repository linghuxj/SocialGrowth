import { ArrowClockwise, ChartLineUp, Info } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ProductApiError } from "./operator-api.js";
import { readProjectFeedback } from "./project-feedback-api.js";
import type { MetricSnapshot, ProjectFeedbackResponse } from "@socialgrowth/product-contracts";

type Props = {
  projectId: string;
  active: boolean;
  readOnly: boolean;
  onExpired: (error: unknown) => void;
};

const sourceStateLabel: Record<ProjectFeedbackResponse["sourceState"], string> = {
  available: "已读取权威快照",
  not_configured: "效果来源尚未接入",
  unavailable: "效果来源当前不可用",
  unknown: "暂无权威来源报告",
};

const sourceReasonLabel: Record<NonNullable<ProjectFeedbackResponse["sourceReasonCode"]>, string> = {
  source_not_configured: "可信来源解析器尚未配置。",
  no_authoritative_report: "当前没有可核验的来源报告；未知不能视为零。",
  source_unavailable: "来源故障已记录；当前没有可用的权威读取。",
};

const missingReasonLabel: Record<NonNullable<MetricSnapshot["missingReason"]>, string> = {
  permission_unavailable: "来源权限不可用",
  source_unavailable: "来源暂不可用",
  no_data: "来源报告未提供该指标",
  unknown_cutoff: "统计截止时间未知",
  unknown_coverage: "数据覆盖范围未知",
};

function timestamp(value: string | null): string {
  if (!value) return "未知";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "时间格式未知" : `${new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(parsed)} UTC`;
}

function metricStatus(metric: MetricSnapshot): string {
  if (metric.availability === "available") return "来源报告有数值";
  if (metric.availability === "delayed") return `采集延迟：${missingReasonLabel[metric.missingReason!]}`;
  return `缺少数据：${missingReasonLabel[metric.missingReason!]}`;
}

function MetricCard({ metric }: { metric: MetricSnapshot }) {
  const subject = metric.subject.kind === "account" ? "账号级汇总" : "已关联的发布内容";
  const definition = metric.metricDefinition;
  const displayValue = metric.value === null
    ? "来源未提供数值"
    : definition?.unit ? `${metric.value} ${definition.unit}` : metric.value;
  return <article className="project-feedback__metric">
    <div className="project-feedback__metric-heading">
      <div><h3>{definition?.name ?? "指标名称未提供"}</h3><p>{metric.platform === "facebook" ? "Facebook" : "YouTube"} · {subject}</p></div>
      <span className={`project-feedback__badge project-feedback__badge--${metric.availability}`}>
        {metric.availability === "available" ? "已读取" : metric.availability === "delayed" ? "延迟" : "缺失"}
      </span>
    </div>
    <dl className="project-feedback__facts">
      <div><dt>报告数值</dt><dd>{displayValue}</dd></div>
      <div><dt>单位</dt><dd>{definition?.unit ?? "来源未提供单位"}</dd></div>
      <div><dt>指标说明</dt><dd>{definition?.description ?? "来源未提供指标定义，暂不能解释该数值的含义。"}</dd></div>
      <div><dt>来源口径</dt><dd>{definition?.sourceDefinition ?? "来源未提供计算或统计口径。"}</dd></div>
      <div><dt>数据状态</dt><dd>{metricStatus(metric)}</dd></div>
      <div><dt>统计口径</dt><dd>{metric.measurement === "cumulative" ? "累计快照（不可与历史值相加）" : "区间值"}</dd></div>
      <div><dt>覆盖范围</dt><dd>{metric.coverage ? `${timestamp(metric.coverage.startsAt)} – ${timestamp(metric.coverage.endsAt)}` : "来源未提供覆盖范围"}</dd></div>
      <div><dt>统计截止</dt><dd>{timestamp(metric.statisticsCutoffAt)}</dd></div>
      <div><dt>采集时间</dt><dd>{timestamp(metric.collectedAt)}</dd></div>
    </dl>
    <p className="form-note">{!definition
      ? "来源尚未提供指标名称、定义与单位，暂不能将数值解释为播放、互动或收入，也不能用于效果比较。"
      : !definition.unit
        ? "来源提供了指标定义，但没有提供单位；此原始数值暂不能用于效果比较。"
        : "指标名称、定义和单位来自可信来源报告；不同定义、统计范围或截止时间的快照不可直接比较。"}</p>
    <details><summary>查看报告来源与记录编号</summary>
      <p>定义编号 {metric.definitionId} · 发布身份 {metric.identityId}</p>
      <p>来源报告 {metric.sourceReportId} · 修订 v{metric.revision}{metric.replacesSnapshotId ? ` · 更正 ${metric.replacesSnapshotId}` : " · 初始修订"}</p>
      <p>快照 {metric.snapshotId} · 来源 {metric.sourceId} · 来源时区 {metric.sourceTimeZone ?? "未知"}</p>
      {metric.subject.kind !== "account" && <p>任务 {metric.subject.taskId} · 内容 {metric.subject.contentUnitId} · 变体 {metric.subject.variantId} · 发布 {metric.subject.publicationId}</p>}
    </details>
  </article>;
}

export function ProjectFeedbackPanel(props: Props) {
  const { projectId, active, onExpired } = props;
  const [data, setData] = useState<ProjectFeedbackResponse | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestSequence = useRef(0);
  const currentProjectId = projectId.toLowerCase();

  useEffect(() => {
    const sequence = ++requestSequence.current;
    if (!active) return () => { requestSequence.current++; };
    let live = true;
    setLoading(true);
    setError(false);
    void readProjectFeedback(currentProjectId).then(next => {
      if (!live || sequence !== requestSequence.current) return;
      setData(next);
      setLoadedProjectId(currentProjectId);
    }).catch((reason: unknown) => {
      if (!live || sequence !== requestSequence.current) return;
      if (reason instanceof ProductApiError && reason.status === 401) onExpired(reason);
      setData(null);
      setLoadedProjectId(currentProjectId);
      setError(true);
    }).finally(() => {
      if (live && sequence === requestSequence.current) setLoading(false);
    });
    return () => { live = false; requestSequence.current++; };
  }, [active, currentProjectId, onExpired, refreshVersion]);

  const current = loadedProjectId === currentProjectId ? data : null;
  const retry = () => setRefreshVersion(value => value + 1);

  return <section hidden={!active} className="project-feedback" aria-label="项目效果与复盘">
    <div className="section-heading">
      <div><h2>效果与复盘</h2><p className="muted">只读取本项目保留账号的权威报告快照；缺失、延迟、累计值和未知归因分别保留。</p></div>
      <button className="outline-button" disabled={loading} onClick={retry}>
        <ArrowClockwise size={18} />{loading ? "读取中…" : "刷新反馈事实"}
      </button>
    </div>
    {loading && <p role="status">正在读取本项目效果事实…</p>}
    {error && <div className="project-feedback__state project-feedback__state--error" role="alert">
      <p>{"反馈事实暂时无法读取；没有把读取失败解释为零值或无效果。"}</p>
      <button className="outline-button" disabled={loading} onClick={retry}>重试读取</button>
    </div>}
    {current && <>
      <section className={`project-feedback__state project-feedback__state--${current.sourceState}`} aria-live="polite">
        <ChartLineUp size={22} aria-hidden="true" />
        <div><h3>{sourceStateLabel[current.sourceState]}</h3>
          <p>{current.sourceReasonCode ? sourceReasonLabel[current.sourceReasonCode] : "读取至少一条权威快照；这不表示预期指标齐全或效果已达标。"}</p>
          <small>项目 {current.projectId} · 读取时间 {timestamp(current.observedAt)}</small>
        </div>
      </section>
      <section className="project-feedback__attribution" aria-label="内容归因状态">
        <Info size={18} aria-hidden="true" />
        <p>{current.metrics.some(metric => metric.subject.kind !== "account") ? "已关联内容的快照保留其任务与发布来源；其他账号级数据不能拆分到单条内容。" : "当前快照仅有账号级数据或尚无快照，内容级效果归因未知。账号级数据不会拆分到单条内容。"}</p>
      </section>
      <section aria-label="效果指标快照">
        <h3>效果快照</h3>
        {current.metrics.length === 0
          ? <p className="project-feedback__empty">目前没有可展示的报告行；这不代表指标为零、内容无效果或采集完整。</p>
          : <div className="project-feedback__metrics">{current.metrics.map(metric => <MetricCard key={metric.snapshotId} metric={metric} />)}</div>}
      </section>
      <section className="project-feedback__review" aria-label="复盘和后续安排状态">
        <h3>复盘与后续安排</h3>
        <div><h4>复盘建议</h4><p>当前没有可信复盘建议读取来源；结论未知，不表示无需调整。</p></div>
        <div><h4>安排是否生效</h4><p>本反馈接口不记录安排生效状态；请按已批准计划事实核对。</p></div>
        <div><h4>后续任务实际执行</h4><p>本反馈接口不记录手机执行或发布回执；须以独立核验结果为准。</p></div>
      </section>
    </>}
  </section>;
}
