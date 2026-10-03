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
  return Number.isNaN(parsed.getTime()) ? "时间格式未知" : new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC", timeZoneName: "short",
  }).format(parsed);
}

function metricStatus(metric: MetricSnapshot): string {
  if (metric.availability === "available") return "来源报告有数值";
  if (metric.availability === "delayed") return `采集延迟：${missingReasonLabel[metric.missingReason!]}`;
  return `缺少数据：${missingReasonLabel[metric.missingReason!]}`;
}

function MetricCard({ metric }: { metric: MetricSnapshot }) {
  const subject = metric.subject.kind === "account"
    ? `账号级 · ${metric.platform} · ${metric.identityId}`
    : `已关联发布内容 · ${metric.platform} · 任务 ${metric.subject.taskId}`;
  return <article className="project-feedback__metric">
    <div className="project-feedback__metric-heading">
      <div><h3>指标定义 {metric.definitionId}</h3><p>{subject}</p></div>
      <span className={`project-feedback__badge project-feedback__badge--${metric.availability}`}>
        {metric.availability === "available" ? "已读取" : metric.availability === "delayed" ? "延迟" : "缺失"}
      </span>
    </div>
    <dl className="project-feedback__facts">
      <div><dt>当前快照值</dt><dd>{metric.value === null ? "无数值" : metric.value}</dd></div>
      <div><dt>数据状态</dt><dd>{metricStatus(metric)}</dd></div>
      <div><dt>口径</dt><dd>{metric.measurement === "cumulative" ? "累计快照（不可与历史值相加）" : "区间值"}</dd></div>
      <div><dt>覆盖范围</dt><dd>{metric.coverage ? `${timestamp(metric.coverage.startsAt)} – ${timestamp(metric.coverage.endsAt)}` : "未知覆盖范围"}</dd></div>
      <div><dt>统计截止</dt><dd>{timestamp(metric.statisticsCutoffAt)}</dd></div>
      <div><dt>采集时间</dt><dd>{timestamp(metric.collectedAt)}{metric.sourceTimeZone ? ` · 来源时区 ${metric.sourceTimeZone}` : " · 来源时区未知"}</dd></div>
      <div><dt>来源报告 / 修订</dt><dd>{metric.sourceReportId} · v{metric.revision}{metric.replacesSnapshotId ? `（更正 ${metric.replacesSnapshotId}）` : "（初始修订）"}</dd></div>
    </dl>
    <p className="project-feedback__footnote">{metric.snapshotId} · 来源 {metric.sourceId}</p>
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
        <p>内容级效果归因未知：尚缺已核验任务与平台实际发布内容的可信关联。账号级数据不会拆分到单条内容，也不会用于跨来源比较。</p>
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
