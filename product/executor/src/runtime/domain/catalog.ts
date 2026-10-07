/** Business choices shared by the Web and authoritative command engine. */
// Preparation templates do not generate content drafts, schedules or publication approval.
export const deviceInitializationTemplate = {
  id: 'device_initialize',
  name: '手机初始化',
  action: 'initialize',
  scope: '当前手机的指定平台：可信应用、指定登录账号、Page / 频道及管理权限',
} as const;

export const strategyTemplates = [
  {
    id: 'daily_clip',
    name: '日常切片发布',
    destinationRequired: false,
    rationale:
      '将已核对权利的独占切片发布到指定账号；先核验身份，结果未知时停止重发。',
  },
  {
    id: 'serial',
    name: '剧集连载',
    destinationRequired: false,
    rationale:
      '按剧集顺序逐条排期；每条内容独立核对并只发布一次，不自动补发未知结果。',
  },
  {
    id: 'traffic',
    name: '站外导流',
    destinationRequired: true,
    rationale:
      '发布独占内容并使用已获维护授权的导流目的地；目的地失效时停止执行。',
  },
  {
    id: 'experiment',
    name: '小规模策略试验',
    destinationRequired: false,
    rationale:
      '在人工批准的单次范围内验证假设；试验前固定主指标、观察窗口与停止条件。',
  },
] as const;
export type StrategyTemplateId = (typeof strategyTemplates)[number]['id'];
export const ruleTemplates = [
  {
    id: 'identity',
    name: '账号身份核验',
    category: 'internal_rule',
    statement:
      '执行前核验指定 Facebook Page / YouTube 频道的完整身份；不符时停止并提交人工待办，禁止运营轮换账号。',
    sourceRef: 'CLAUDE.md#核心架构五大铁律',
  },
  {
    id: 'exclusive',
    name: '切片独占与禁止重发',
    category: 'internal_rule',
    statement:
      '同一内容各语言版本共用身份，只选一个版本在独占账号发布一次；结果未知时不得重发。',
    sourceRef: 'docs/handoff/2026-09-19-business-flow-proposal.md#G-03',
  },
  {
    id: 'rights',
    name: '素材权利与期限',
    category: 'internal_rule',
    statement:
      '发布前核对素材、配乐权利与有效期；缺少依据或过期时停止，不能以文件哈希代替权利证明。',
    sourceRef: 'CLAUDE.md#核心架构五大铁律',
  },
  {
    id: 'human',
    name: '登录及人工协助边界',
    category: 'internal_rule',
    statement:
      '密码、验证码通过专用安全待办提交；人工回复后重新观察核验，封禁或连续失败时停止，不绕过平台限制。',
    sourceRef: 'docs/specs/2026-09-20-agent-supervision.md',
  },
] as const;
export const goals = [
  { id: 'views', name: '内容曝光 / 播放' },
  { id: 'followers', name: '关注增长' },
  { id: 'traffic', name: '站外导流' },
];
export const dataScopes = [
  { id: 'none', name: '仅发布，不采集指标' },
  { id: 'public_metrics', name: '公开播放与互动指标' },
  { id: 'owned_analytics', name: '本账号后台分析（须另外核实平台权限）' },
];
