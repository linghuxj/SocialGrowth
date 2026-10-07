import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretRight,
  DeviceMobile,
  Info,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import type {
  ListOperatorDeviceFactsResponse,
} from "@socialgrowth/product-contracts";

type DeviceFact = ListOperatorDeviceFactsResponse["devices"][number];
type DeviceStateFilter = "all" | DeviceFact["state"];

interface DeviceFactsPanelProps {
  facts: ListOperatorDeviceFactsResponse | null;
  loading: boolean;
  error: string;
  onRefresh(): void;
}

const stateLabels: Record<DeviceFact["state"], string> = {
  associated_pending_access: "已关联 · 待完成接入",
  access_ready: "接入已就绪",
  paused: "已暂停",
  exit_pending: "退出处理中",
  exited: "已退出",
};

function formatFactTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function stateClass(state: DeviceFact["state"]): string {
  if (state === "paused" || state === "exit_pending") return "attention";
  if (state === "exited") return "quiet";
  return "neutral";
}

export function DeviceFactsPanel({ facts, loading, error, onRefresh }: DeviceFactsPanelProps) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<DeviceStateFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const providers = useMemo(
    () => new Map(facts?.providers.map((provider) => [provider.providerId, provider]) ?? []),
    [facts],
  );
  const visibleDevices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return (facts?.devices ?? []).filter((device) => {
      if (providerFilter && device.providerId !== providerFilter) return false;
      if (stateFilter !== "all" && device.state !== stateFilter) return false;
      const provider = providers.get(device.providerId);
      return !normalized || [
        device.displayName,
        provider?.displayName ?? "",
        provider?.phoneLastFour ?? "",
      ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized));
    });
  }, [facts, providerFilter, providers, query, stateFilter]);
  const selected = visibleDevices.find((device) => device.deviceId === selectedDeviceId)
    ?? visibleDevices[0];
  const selectedProvider = selected ? providers.get(selected.providerId) : undefined;

  return <>
    <div className="device-filters" role="search" aria-label="筛选手机">
      <label>归属状态
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as DeviceStateFilter)}>
          <option value="all">全部</option>
          <option value="associated_pending_access">待完成接入</option>
          <option value="access_ready">接入已就绪</option>
          <option value="paused">已暂停</option>
          <option value="exit_pending">退出处理中</option>
          <option value="exited">已退出</option>
        </select>
      </label>
      <label className="device-search-label">搜索手机或提供者
        <span className="device-search-input"><MagnifyingGlass size={18} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索手机、提供者或手机号末四位" />
        </span>
      </label>
      <button className="outline-button device-refresh" type="button" disabled={loading}
        onClick={onRefresh}><ArrowClockwise size={18} />{loading ? "读取中…" : "刷新"}</button>
    </div>

    <p className="device-truth-note" role="note"><Info size={19} aria-hidden="true" />
      关联或接入状态不等于手机在线、授权有效或可以执行；连接确认目前没有权威来源。
    </p>

    {providerFilter && <div className="provider-filter-note">正在查看指定提供者的手机
      <button type="button" onClick={() => setProviderFilter(null)}>显示全部提供者</button></div>}

    <section className="panel device-list-panel" aria-labelledby="device-list-title">
      <div className="section-heading"><div><h2 id="device-list-title">手机资源</h2>
        <p className="muted">只显示当前归属；同一提供者的手机分别查看。</p></div>
        <span className="count-label">{visibleDevices.length} / {facts?.devices.length ?? 0} 台</span></div>
      {facts && <p className="device-read-time">权威事实读取于 {formatFactTime(facts.readAt)}；此时间不是连接确认时间。</p>}
      {error && <div className="device-error" role="alert"><p>{error}</p>
        <button type="button" className="outline-button" onClick={onRefresh}>重试读取</button></div>}
      {!facts && loading && <p className="device-placeholder" role="status">正在读取设备事实…</p>}
      {facts && visibleDevices.length === 0 && <div className="empty-state"><DeviceMobile size={34} />
        <h3>{providerFilter ? "该提供者暂无符合条件的手机" : facts.devices.length ? "没有符合条件的手机" : "尚无已关联手机"}</h3>
        <p>{facts.devices.length || providerFilter ? "调整提供者、状态或搜索条件后再查看。" : "提供者注册和手机关联是两个独立步骤。"}</p>
      </div>}
      {visibleDevices.length > 0 && <div className="table-wrap device-table-wrap"><table className="device-table">
        <thead><tr><th>手机</th><th>提供者</th><th>归属状态</th><th>连接确认</th><th>事实更新时间</th><th>操作</th></tr></thead>
        <tbody>{visibleDevices.map((device) => {
          const provider = providers.get(device.providerId);
          return <tr key={device.deviceId} className={selected?.deviceId === device.deviceId ? "device-row-selected" : ""}>
            <td data-label="手机"><span className="device-name"><DeviceMobile size={19} aria-hidden="true" />{device.displayName}</span></td>
            <td data-label="提供者"><strong>{provider?.displayName ?? "提供者事实缺失"}</strong><small>手机号尾号 {provider?.phoneLastFour ?? "未知"}</small></td>
            <td data-label="归属状态"><span className={`device-state ${stateClass(device.state)}`}>{stateLabels[device.state]}</span></td>
            <td data-label="连接确认"><span className="device-unknown">未知</span><small>最近确认：暂无</small></td>
            <td data-label="事实更新时间">{formatFactTime(device.updatedAt)}<small>事实版本 {device.factVersion}</small></td>
            <td data-label="操作"><button type="button" className="device-detail-button"
              aria-label={`查看 ${device.displayName} 详情`}
              onClick={() => setSelectedDeviceId(device.deviceId)}>查看详情<CaretRight size={16} /></button></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>

    {selected && <section className="panel device-detail-panel" aria-labelledby="selected-device-title">
      <div className="section-heading"><div><p className="device-detail-eyebrow">当前选中手机</p>
        <h2 id="selected-device-title">{selected.displayName} · 事实与接入状态</h2></div>
        <span className={`device-state ${stateClass(selected.state)}`}>{stateLabels[selected.state]}</span></div>
      <div className="device-detail-grid">
        <dl><div><dt>所属提供者</dt><dd>{selectedProvider?.displayName ?? "未知"}</dd></div>
          <div><dt>登录号码</dt><dd>尾号 {selectedProvider?.phoneLastFour ?? "未知"}</dd></div>
          <div><dt>权威状态</dt><dd>{stateLabels[selected.state]}</dd></div></dl>
        <dl><div><dt>连接确认</dt><dd>未知</dd></div>
          <div><dt>最近确认</dt><dd>暂无</dd></div>
          <div><dt>事实更新时间</dt><dd>{formatFactTime(selected.updatedAt)}</dd></div></dl>
      </div>
      <p className="device-detail-boundary">当前没有网络、调试授权、项目分配或发布身份的权威数据；查看此页不会申请控制或改变设备状态。</p>
    </section>}

    {facts && <section className="panel provider-overview" aria-labelledby="provider-overview-title">
      <div className="section-heading"><div><h2 id="provider-overview-title">提供者与当前设备</h2>
        <p className="muted">已注册提供者也可能尚未关联手机；点击可筛选对应设备。</p></div>
        <span className="count-label">{facts.providers.length} 位提供者</span></div>
      {facts.providers.length ? <div className="provider-grid">{facts.providers.map((provider) => {
        const deviceCount = facts.devices.filter((device) => device.providerId === provider.providerId).length;
        return <button type="button" key={provider.providerId}
          className={`provider-choice ${providerFilter === provider.providerId ? "active" : ""}`}
          aria-pressed={providerFilter === provider.providerId}
          onClick={() => { setProviderFilter(providerFilter === provider.providerId ? null : provider.providerId); setSelectedDeviceId(null); }}>
          <span><strong>{provider.displayName}</strong><small>手机号尾号 {provider.phoneLastFour} · {provider.status === "active" ? "身份有效" : "身份已停用"}</small></span>
          <span className="provider-device-count">{deviceCount} 台<CaretRight size={15} /></span>
        </button>;
      })}</div> : <p className="device-placeholder">尚无已注册提供者。</p>}
    </section>}
  </>;
}
