export function MaterialScopeConfirmation({ state, directionId, projectVersion, direction, languages, contentForms, reviewed, disabled, onReviewedChange }: {
  state: "unavailable" | "none" | "stale" | "current";
  directionId: string | null;
  projectVersion: number | null;
  direction: string | null;
  languages: string[];
  contentForms: string[];
  reviewed: boolean;
  disabled: boolean;
  onReviewedChange: (checked: boolean) => void;
}) {
  const approved = directionId !== null && projectVersion !== null && direction !== null && state === "current";
  const forms: Record<string, string> = { facebook_video: "Facebook 视频", youtube_shorts: "YouTube Shorts", youtube_video: "YouTube 常规视频", facebook_image_text: "Facebook 图文" };
  return <section className="panel" aria-label="当前已确认方向范围">
    <h4>当前已确认方向范围</h4>
    {!approved ? <><p>{state === "unavailable" ? "当前方向或周期草案未能读取；资料仍可保存为待检查。"
      : state === "stale" ? "已确认方向与当前项目或周期草案不一致；请先核对并重新确认方向。"
        : "尚无可用于素材核验的已确认方向；资料仍可保存为待检查。"}</p>
      {state === "stale" && <label className="material-inline-check"><input type="checkbox" checked={false} disabled />我已按上述当前范围检查这份成品及其内容规则</label>}
    </> : <>
      <p>{direction}</p>
      <p className="form-note">当前项目版本 {projectVersion}。语言：{languages.length ? languages.join("、") : "未配置"}。形式：{contentForms.length ? contentForms.map(form => forms[form] ?? "其他").join("、") : "未配置"}。</p>
      <label className="material-inline-check"><input type="checkbox" checked={reviewed} disabled={disabled}
        onChange={event => onReviewedChange(event.target.checked)} />我已按上述当前范围检查这份成品及其内容规则</label>
    </>}
  </section>;
}
