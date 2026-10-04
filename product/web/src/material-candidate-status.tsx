const reasons: Record<string, string> = {
  direction_not_approved: "项目尚无已确认的方向与范围。",
  approved_direction_stale: "已确认方向与当前项目或周期草案不一致，请重新核对。",
  language_not_targeted: "素材语言不在当前已确认范围内。",
  no_approved_content_form: "素材形式不在当前已确认范围内。",
  scope_confirmation_missing: "请先读取并确认当前方向范围。",
  scope_confirmation_stale: "保存时使用的方向范围已变化，请重新核对。",
  content_rules_need_human_check: "请确认已按当前方向范围检查内容规则。",
  source_record_conflict: "来源记录与其他素材冲突，需人工核对。",
  exact_sha_collision: "文件内容与已登记的其他素材重复，需人工核对。",
};

export function materialEligibilityLabel(reason: string | null): string {
  return reason ? reasons[reason] ?? "素材状态需要重新读取核对。" : "候选条件已满足。";
}

export function MaterialCandidateStatus({ status, candidateAllowed, eligibilityReason, publicationAllowed }: {
  status: string; candidateAllowed: boolean; eligibilityReason: string | null; publicationAllowed: false;
}) {
  const candidate = status === "candidate" && candidateAllowed && eligibilityReason === null;
  const reason = candidate ? materialEligibilityLabel(null) : eligibilityReason ? materialEligibilityLabel(eligibilityReason)
    : "素材状态字段不一致，请重新读取核对。";
  return <section className="panel" aria-label="素材候选状态">
    <h4>{candidate ? "当前为素材候选" : "当前待检查"}</h4>
    <p>{reason}</p>
    <p className="form-note">发布许可：{publicationAllowed ? "已开启" : "未开启"}。候选状态不派发任务，也不代表外部来源或权利已验证。</p>
  </section>;
}
