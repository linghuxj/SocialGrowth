'use strict';
// Design-only state. No network, device, publishing, or payment APIs are used.
const initial = {
  version: 1, page: 'home', filter: 'all', selected: 'verify', taskFilter: 'all',
  control: 'none', verified: false, deviceReady: false, notes: '', noteSubmitted: false,
  project: 'running', stopConfirmed: false, direction: false,
  language: '', materialChecked: false, pendingSettings: false,
  interval: '14', timezone: 'Asia/Bangkok', commissionNote: '',
  logs: ['演示初始状态：PUB-YT-003 结果待核实，SG-012 待检查。'],
};
/** @type {typeof initial} */
let state = { ...initial, logs: [...initial.logs] };
const key = 'socialgrowth-design-prototype-v1';
try {
  const stored = JSON.parse(localStorage.getItem(key) || 'null');
  if (stored?.version === 1) state = { ...state, ...stored };
} catch (error) { console.info('Prototype storage unavailable', error); }
let dirty = false;
let pendingNavigation = null;
let dialogInvoker = null;
let buttonIndex = 0;
let toastTimer;
/** @type {{page:string, scroll:number, focus:string}[]} */
const trail = [];
const drafts = {};
try { Object.assign(drafts, JSON.parse(localStorage.getItem(`${key}-drafts`) || '{}')); } catch { /* Empty local draft on unavailable storage. */ }
const draftKeysFor = (page) => ({ home: ['notes'], device: ['notes'], materials: ['language'], settings: ['interval', 'timezone'], commission: ['commissionNote'] })[page] || [];
const main = document.getElementById('main');
const dialog = document.getElementById('dialog');
const mobile = () => matchMedia('(max-width:760px)').matches;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const badge = (text, color = '') => `<span class="badge ${color}">${esc(text)}</span>`;
const button = (label, action, value = '', style = '', mutation = false, disabled = false) => `<button id="b-${++buttonIndex}" data-action="${action}" data-value="${esc(value)}" class="${style}" ${mutation ? 'data-mutation="true"' : ''} ${disabled || (mutation && mobile()) ? 'disabled' : ''}>${esc(label)}</button>`;
const go = (label, page, style = '') => button(label, 'nav', page, style);
const projectLabel = () => ({ running: '运行中', paused: '暂停中', resuming: '恢复检查中', ending: '结束处理中', ended: '已结束 · 收尾中' })[state.project];
const verification = () => state.verified ? badge('发布已核验', 'good') : badge('结果待核实', 'warn');
function persist() { try { localStorage.setItem(key, JSON.stringify(state)); localStorage.setItem(`${key}-drafts`, JSON.stringify(drafts)); } catch (error) { console.info('Prototype state is session-only', error); } }
function log(message) { state.logs.push(message); persist(); }
function toast(message) {
  document.getElementById('toast').textContent = message;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { document.getElementById('toast').textContent = ''; }, 5500);
}
function heading(title, subtitle = '', actions = '') {
  return `<div class="crumb">SocialGrowth / ${state.page === 'home' ? '全部项目' : '演示工作区'}</div><header class="heading"><div><h1>${title}</h1><div class="muted">${subtitle}</div></div><div class="actions">${actions}</div></header>`;
}
function back() { return `<div class="backline">${button('← 返回来源页面', 'back', '', 'quiet')}</div>`; }
function tabs(selected, draft = false) {
  const items = draft ? [['概览', 'readiness'], ['素材', 'materials'], ['方向摘要', 'direction']] : [['概览', 'project'], ['发布安排', 'publications'], ['效果与复盘', 'effects'], ['设置', 'settings']];
  return `<div class="tabs">${items.map(([label, page]) => go(label, page, page === selected ? 'selected' : '')).join('')}${draft ? '' : button('素材（查看设计说明）', 'info', '运行项目的批量素材交互见静态设计稿；本版可操作的资料补全示例位于“短剧出海·二期”，不会跳转到另一个项目冒充本项目素材。')}</div>`;
}
function table(headers, rows, cls = '') { return `<div class="table-wrap"><table class="${cls}"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function demos(content) { return `<details class="demo-controls"><summary>原型演示控制 · 非产品操作</summary><p>以下按钮仅模拟外部回传，用于查看不同界面状态，不代表实际验证通过。</p><div class="actions">${content}</div></details>`; }
function formStatus() { return `<div class="dirty ${dirty ? '' : 'clean'}" id="dirty-state">${dirty ? '有未保存修改' : '没有未保存修改'}</div>`; }
function noteField(name, label, saved) {
  return `<label class="formrow">${label}<textarea data-draft="${name}" id="${name}" placeholder="请勿填写真实密码、验证码或令牌">${esc(drafts[name] ?? saved)}</textarea></label>`;
}
function home() {
  const available = state.filter === 'none' ? [] : ['verify', 'device', 'window'];
  const titles = { verify: state.verified ? '第 3 集发布核验记录' : '第 3 集发布结果需要核实', device: state.deviceReady ? 'SG-012 恢复复核记录' : 'SG-012 恢复条件待检查', window: state.project === 'ended' ? '过窗安排已取消' : '一项安排已超出有效窗口' };
  const resolved = id => id === 'verify' ? state.verified : id === 'device' ? state.deviceReady : state.project === 'ended';
  const descriptions = { verify: state.verified ? '已关联核验依据，效果仍待采集' : '已有提交动作，缺少平台核验依据', device: state.deviceReady ? '复核通过，后续任务逐项判断' : '频道与当前界面需要核对', window: state.project === 'ended' ? '未提交安排已取消，原记录保留' : '原窗口已过，不自动补发' };
  return heading('工作台', '先处理需要行动的事项，再进入项目查看全貌。', go('查看项目', 'projects')) +
  `<div class="inbox"><section class="queue"><div class="summaryline"><h2>待办与跟进</h2><span class="muted small">${available.filter(id => !resolved(id)).length} 待办 / ${available.length} 记录</span></div><label>查看范围<select id="inbox-filter"><option value="all" ${state.filter === 'all' ? 'selected' : ''}>全部项目</option><option value="mine" ${state.filter === 'mine' ? 'selected' : ''}>我负责的 · 短剧出海</option><option value="none" ${state.filter === 'none' ? 'selected' : ''}>家居产品 · 无匹配待办</option></select></label>${available.map(id => `<button id="queue-${id}" class="queue-item ${state.selected === id ? 'selected' : ''}" data-action="select" data-value="${id}" aria-pressed="${state.selected === id}"><strong>${titles[id]}</strong>${badge(resolved(id) ? '已处理 · 可追溯' : '需要跟进', resolved(id) ? '' : 'warn')}<small>短剧出海 · ${descriptions[id]}</small></button>`).join('')}${!available.length ? '<p class="empty">当前筛选无匹配事项<br>不代表其他项目没有待办。</p>' : ''}</section><div>${available.length ? inboxDetail(titles[state.selected], descriptions[state.selected]) : '<section class="panel empty">选择其他查看范围以继续。</section>'}</div></div>`;
}
function inboxDetail(title, description) {
  const verify = state.selected === 'verify';
  if (!verify) return `<section class="panel"><div class="summaryline"><h2>${title}</h2>${badge(state.selected === 'device' && state.deviceReady ? '复核通过' : state.selected === 'window' && state.project === 'ended' ? '已取消' : '待跟进')}</div><p class="muted">${description}</p><dl class="kv"><dt>项目</dt><dd>短剧出海</dd><dt>关联对象</dt><dd>${state.selected === 'device' ? 'SG-012 · CostaDrama' : 'PUB-FB-005 · 独立宣传片'}</dd><dt>下一步</dt><dd>${state.selected === 'device' ? '进入设备页查看独占控制与恢复复核事实。' : '原窗口已过，保留阻断；恢复不自动补发。'}</dd></dl><div class="actions details">${go(state.selected === 'device' ? '查看设备与协助' : '查看关联安排', state.selected === 'device' ? 'device' : 'publications')}${go('查看项目', 'project')}</div></section>`;
  return `<section class="panel"><div class="summaryline"><h2>${title}</h2>${verify ? verification() : badge('跟进中', 'warn')}</div><p class="muted">${description}</p><dl class="kv"><dt>项目</dt><dd>短剧出海</dd><dt>关联对象</dt><dd>${verify ? 'PUB-YT-003 · 海岸来信第 3 集' : state.selected === 'device' ? 'SG-012 · CostaDrama' : 'PUB-FB-005 · 独立宣传片'}</dd><dt>实际处理</dt><dd>${state.noteSubmitted ? (state.verified ? '处理记录已提交；平台已核验，设备另行判断' : '处理记录已提交；结果仍以复核为准') : '尚未提交处理结果'}</dd></dl><div class="actions details">${go('查看关联任务', 'task')}${go('查看设备与协助', 'device')}${go('查看项目', 'project')}</div></section><section class="panel"><h2>处理记录</h2><p class="muted">说明保存与平台核验分开。需要操作手机时，另行申请独占控制。</p>${noteField('notes', '本次实际观察', state.notes)}${formStatus()}<div class="actions">${button('提交处理结果', 'save-note', '', 'primary', true)}</div><p class="footnote">原型不收集真实证据；示例输入仅保存在本机。</p></section>`;
}
function projects() {
  return heading('项目', '同一客户可有多个项目；资源和历史按项目追溯。') + `<section class="panel">${table(['项目', '阶段与条件', '当前关注', '操作'], [
    ['短剧出海', badge(projectLabel(), 'blue'), state.verified ? '设备条件与后续安排' : '发布核实与设备复核', go('进入运行项目', 'project', 'primary')],
    ['短剧出海·二期', badge('筹备中'), state.direction ? '方向已确认，资源待就绪' : '方向草案待确认', go('进入准备清单', 'readiness')],
  ])}</section>`;
}
function project() {
  const ending = ['ending', 'ended'].includes(state.project);
  return heading('短剧出海', `${projectLabel()} · Asia/Shanghai · 林运营负责提醒`, go('返回项目列表', 'projects')) + tabs('project') +
  `<div class="metrics"><div class="metric">项目发布状态<strong>${projectLabel()}</strong></div><div class="metric">第 3 集平台结果<strong>${state.verified ? '已核验' : '待核实'}</strong></div><div class="metric">设备复核<strong>${state.deviceReady ? '条件通过' : '待处理'}</strong></div></div><section class="panel"><h2>当前需要关注</h2><p>${ending ? '新发布停止启动；已确认未提交安排按结束流程取消，未知发布仍核实。' : '设备、任务、项目暂停分别判断；一个条件通过不代表全部工作完成。'}</p><div class="actions">${go('查看发布安排', 'publications')}${go('查看核实事项', 'task')}${go('查看复盘落实', 'review')}</div></section><section class="panel"><h2>项目操作</h2><p class="muted">查看影响摘要后再确认，操作仅演示本地状态。</p><div class="actions">${button('暂停项目发布', 'pause-dialog', '', '', true, state.project !== 'running')}${button('恢复并检查任务', 'resume-dialog', '', '', true, state.project !== 'paused')}${go('查看正式结束影响', 'end', 'danger')}${['paused', 'resuming'].includes(state.project) ? go('查看控制进展', 'progress') : ''}</div>${ending ? '<p class="footnote">已结束的安排不能通过普通恢复重新启用。</p>' : ''}</section>`;
}
function taskRows() {
  const ended = state.project === 'ended';
  return [
    ['PUB-YT-003', '海岸来信 · 第3集', 'YT · CostaDrama', '提交动作已记录', state.verified ? '发布已核验' : '结果待核实'],
    ['PUB-YT-004', '海岸来信 · 第4集', 'YT · CostaDrama', ended ? '已取消（演示）' : state.project === 'ending' ? '结束处理中，等待取消确认' : state.project === 'resuming' ? '恢复检查中' : state.project === 'paused' ? '项目暂停' : state.deviceReady && state.verified ? '待排期15:00' : '等待设备/前置', '尚未发布'],
    ['PUB-FB-005', '独立宣传片', 'FB · CostaDrama FB', ended ? '已取消（演示）' : state.project === 'ending' ? '结束处理中，等待取消确认' : '窗口已过，继续受阻', '尚未发布'],
  ];
}
function publications() {
  let rows = taskRows(); if (state.taskFilter === 'unknown') rows = rows.filter(r => r[4] === '结果待核实');
  return heading('发布安排', '短剧出海 · 演示时间 2026-09-27 12:09 · Asia/Shanghai') + tabs('publications') + `<section class="panel"><div class="summaryline"><h2>执行列表</h2><label>核验筛选 <select id="task-filter"><option value="all">全部</option><option value="unknown" ${state.taskFilter === 'unknown' ? 'selected' : ''}>结果待核实</option></select></label></div>${rows.length ? table(['任务/内容', '发布身份', '执行状态', '平台核验', '操作'], rows.map(r => [`<b>${r[0]}</b><small>${r[1]}</small>`, r[2], r[3], badge(r[4], r[4] === '结果待核实' ? 'warn' : ''), go('查看任务', r[0] === 'PUB-YT-003' ? 'task' : 'progress')])) : '<p class="empty">当前筛选无匹配任务，已核验记录仍保留在全部列表。</p>'}</section>`;
}
function task() {
  return back() + heading('海岸来信 · 第3集', 'PUB-YT-003 · YouTube Shorts · 短剧出海') + `<div class="notice ${state.verified ? '' : 'warn'}">${state.verified ? '演示回传已关联正确身份与内容；效果数据尚未取得。' : '已有提交动作，平台结果待核实。不能直接重新提交。'}</div><div class="columns"><section class="panel"><h2>任务与事实</h2><dl class="kv"><dt>目标身份</dt><dd>CostaDrama · YouTube频道</dd><dt>执行手机</dt><dd>SG-012</dd><dt>文件与语言</dt><dd>coast_03.mp4 · 西班牙语 · v1</dd><dt>执行进展</dt><dd>提交动作已记录</dd><dt>平台结果</dt><dd>${verification()}</dd><dt>实际发布时间</dt><dd>${state.verified ? '09:35（演示证据）' : '未知'}</dd><dt>效果数据</dt><dd>${state.verified ? '待采集，不记零' : '等待发布核验'}</dd></dl><div class="actions details">${button('打开原核实待办', 'open-inbox')}${go('查看设备协助', 'device')}</div></section><section class="panel"><h2>核验依据与后续</h2><p>${state.verified ? '示例回传：身份与第3集内容匹配，关联原任务。没有形成新的发布或额外计数。' : '待核对平台实际身份、内容与发布时间；处理记录不是成功证据。'}</p><p>第4集仍需核对设备、批准范围、窗口与前置条件。</p><h3>已提交处理记录</h3><p>${esc(state.notes || '暂无处理说明')}</p>${state.noteSubmitted ? badge('已提交，仍按核验事实判断') : ''}</section></div>`;
}
function devices() {
  return heading('账号与设备', '连接、授权、控制与可执行条件分别判断。') + `<section class="panel">${table(['手机', '项目/身份', '条件', '操作'], [['SG-012', '短剧出海 · YT CostaDrama', state.deviceReady ? '复核通过（演示）' : '在线，恢复复核待处理', go('查看并协助', 'device', 'primary')], ['SG-021', '家居产品 · FB HomeVista', '提供者已暂停，不进行手机业务操作', go('查看提供者', 'provider')]])}</section>`;
}
function device() {
  const labels = { none: '仅查看 · 未取得控制', requested: '接管申请已受理 · 等待独占', owned: '演示独占控制：李运营（你）', returning: '交还请求已受理 · 等待确认', returned: '手机已交还 · 恢复复核中' };
  const controls = state.control === 'requested' ? button('演示回传：AI停止并授予独占', 'sim-grant', '', '', true) : state.control === 'returning' ? button('演示回传：交还已确认', 'sim-return', '', '', true) : state.control === 'returned' ? `${!state.verified ? button('演示回传：平台发布核验通过', 'sim-verify', '', '', true, !state.noteSubmitted) : ''}${state.verified && !state.deviceReady ? button('演示回传：设备复核通过', 'sim-ready', '', '', true) : ''}` : '';
  return back() + heading('核对当前频道与页面', 'SG-012 · 短剧出海 · YouTube频道 CostaDrama') + `<div class="notice">${labels[state.control]}${state.deviceReady ? ' · 设备条件已通过演示复核' : ''}</div><div class="columns"><section class="panel"><h2>手机画面</h2><div class="phone"><div class="inner"><strong>手机画面占位</strong><p>未连接真实设备</p><p class="small">原型不生成手机回传，也不提供实际点击控制。</p></div></div><p class="muted small">实际产品须显示完整真实画面、采集时间与控制状态。演示按钮仅改变本地流程状态。</p><div class="actions">${button('申请接管', 'request-control', '', 'primary', true, state.control !== 'none')}${button('交还手机', 'return-control', '', '', true, state.control !== 'owned')}</div></section><div><section class="panel"><h2>本次处理范围</h2><p>核对当前频道和页面。第3集先核验原发布，第4集仍检查前置与设备条件；接管不授予新增发布权限。</p>${noteField('notes', '记录实际观察（演示输入）', state.notes)}${formStatus()}${button('提交处理结果', 'save-note', '', 'primary', true)}<p class="footnote">提交记录不会交还控制或标记发布成功；未解决也可交还并保留阻断。</p></section><section class="panel"><h2>当前结果</h2><dl class="kv"><dt>人工记录</dt><dd>${state.noteSubmitted ? '已提交，待相关复核' : '尚未提交'}</dd><dt>平台发布</dt><dd>${verification()}</dd><dt>设备条件</dt><dd>${state.deviceReady ? '复核通过；任务仍单独判断' : '待复核'}</dd></dl>${demos(controls || '<span class="muted small">先完成对应的申请或交还操作，再演示外部回传。</span>')}</section></div></div>`;
}
function readiness() {
  return heading('短剧出海·二期', `筹备中 · ${state.direction ? '方向已确认，部分资源待就绪' : '方向草案尚未确认'}`, go('查看方向摘要', 'direction', 'primary')) + tabs('readiness', true) + `<div class="notice">发布前确认方向；准备可以并行。保存资料不会启动发布。</div><section class="panel"><h2>准备清单</h2>${table(['准备事项', '当前事实', '影响', '操作'], [
    ['目标与范围', state.direction ? 'v1已确认（演示）' : '已保存草案，待确认', '就绪任务才可在范围内执行', go('查看方向', 'direction')],
    ['素材资料', state.materialChecked ? '资料检查通过；按批准规则判定候选' : '1项缺语言资料', '缺项素材不能选用', go('整理素材', 'materials')],
    ['账号与手机', 'YT初始化中', '该身份暂不能发布', go('查看资源', 'devices')],
    ['引流入口', '链接已保存，入口待核验', '尚不算有效引流任务', button('查看入口缺口', 'info', '需在目标平台核对有效入口。此原型仅展示缺口，不执行手机核验。')],
    ['周期与规则', '首次10-01 00:00；7天；每周期最低6项（示例）', 'Asia/Shanghai；尚未进入运行', go('查看方向中的规则', 'direction')],
  ], 'checklist')}</section>`;
}
function direction() {
  return back() + heading('确认初始方向与自主范围', `短剧出海·二期 · v1 · ${state.direction ? '已确认（演示）' : '尚未确认'}`) + `<div class="columns"><section class="panel"><h2>本次明确范围</h2><dl class="kv"><dt>阶段目标</dt><dd>开通前推进分成资格，同时保留引流</dd><dt>受众与成品</dt><dd>墨西哥/西班牙语；已准入原创短剧《山海之间》（示例）</dd><dt>身份/形式</dt><dd>FB Page SierraStories FB · 视频；YT频道 SierraStories · Shorts</dd><dt>日期与时段</dt><dd>2026-10-01 00:00 至11-01 00:00（结束不含）；每日09:00–20:00；Asia/Shanghai</dd><dt>频率</dt><dd>每身份每日最多1项（示例）</dd><dt>周期引流</dt><dd>每7天至少6项有效引流任务（示例）</dd><dt>观察条件</dt><dd>按来源可支持的窗口比较；本演示示例为发布后72小时，数据不足不强行判断。</dd></dl></section><section class="panel"><h2>自主范围与阻断</h2><p>AI在上述范围内选择成品、安排时段、生成文案，并根据真实反馈调整未开始安排。</p><p>改变主目标、方向或突破范围需重新确认，内容名额、连载、素材版本与手机互斥始终有效。</p><div class="notice warn">YT初始化、引流入口核验仍未完成；确认方向不会解除这些阻断。</div><p class="footnote">全部参数为本原型示例，不是新默认值或真实批准。</p></section></div><div class="notice">确认后，满足就绪条件的任务可自动执行，无需再点击启动或逐条审批。</div><div class="actions">${button('确认方向', 'confirm-direction', '', 'primary', true, state.direction)}${go('返回准备清单', 'readiness')}</div>`;
}
function materials() {
  return heading('素材整理', '短剧出海·二期 · 本原型演示单条资料保存和检查状态', go('返回准备清单', 'readiness')) + `<section class="panel"><h2>山海之间 · 第1集</h2><dl class="kv"><dt>文件版本</dt><dd>mountain_01.mp4 · v1（只读示例）</dd><dt>状态</dt><dd>${state.materialChecked ? '资料检查通过；候选资格仍按批准规则' : state.language ? '资料已保存，检查待回传' : '语言资料缺失'}</dd></dl><label class="formrow details">语言<select data-draft="language" id="language"><option value="">请选择，不能自动识别</option><option value="es" ${(drafts.language ?? state.language) === 'es' ? 'selected' : ''}>西班牙语</option><option value="en" ${(drafts.language ?? state.language) === 'en' ? 'selected' : ''}>英语</option></select></label>${formStatus()}${button('保存当前素材资料', 'save-material', '', 'primary', true)}${demos(button('演示回传：资料检查通过', 'sim-material', '', '', true, !state.language))}<p class="footnote">此处没有文件上传或发布操作。完整批量设计见原图与规格。</p></section>`;
}
function settings() {
  const interval = drafts.interval ?? state.interval; const timezone = drafts.timezone ?? state.timezone;
  const start = timezone === 'Asia/Bangkok' ? '2026-10-03 23:00 +07:00' : '2026-10-04 00:00 +08:00';
  return heading('周期与业务时区', '运行项目：短剧出海 · 不是二期筹备项目') + tabs('settings') + `<section class="panel"><h2>当前周期保持不变</h2><p><b>2026-09-27 00:00 → 2026-10-04 00:00</b>（结束不含）</p><p>Asia/Shanghai · 当前间隔7天 · 本周期最低引流6项（示例）</p>${state.pendingSettings ? '<div class="notice">已保存待生效配置；从当前周期结束的同一实际时刻生效，尚未运行新配置。</div>' : ''}</section><div class="columns"><section class="panel"><h2>拟修改配置</h2><label class="formrow">复盘间隔<select id="interval" data-draft="interval"><option value="7" ${interval === '7' ? 'selected' : ''}>7天</option><option value="14" ${interval === '14' ? 'selected' : ''}>14天（演示选项）</option></select></label><label class="formrow">业务时区<select id="timezone" data-draft="timezone"><option value="Asia/Shanghai" ${timezone === 'Asia/Shanghai' ? 'selected' : ''}>Asia/Shanghai</option><option value="Asia/Bangkok" ${timezone === 'Asia/Bangkok' ? 'selected' : ''}>Asia/Bangkok</option></select></label><p class="muted">首次统计起点运行中不可编辑。</p>${formStatus()}<div class="actions">${button('保存，下周期生效', 'save-settings', '', 'primary', true)}${button('放弃本组修改', 'discard-settings', '', '', true)}</div></section><section class="panel"><h2>生效范围</h2><p>当前周期结束：<b>2026-10-04 00:00 +08:00</b></p><p id="settings-preview">拟定起点：${start}；下一周期 ${esc(interval)} 天。</p><p>周期连续衔接；历史口径和本周期最低要求不变。间隔翻倍不自动将6项变成12项。</p><p class="footnote">演示不会推进真实时钟或应用任何实际配置。</p></section></div>`;
}
function effects() {
  return heading('效果与复盘', '短剧出海 · 历史周期09-20至09-27 00:00（结束不含）· Asia/Shanghai') + tabs('effects') + `<div class="metrics"><div class="metric">周期最低要求<strong>6项</strong></div><div class="metric">核验成功<strong>4项</strong></div><div class="metric">周期缺口<strong>2项</strong></div></div><section class="panel"><h2>本轮判断与后续落实</h2><p>维持批准方向；主目标数据不足，暂停依赖该数据的优化。后续任务单独跟踪，不回填原周期。</p>${go('查看复盘与落实', 'review', 'primary')}</section><section class="panel"><h2>数据局限</h2>${table(['指标', '当前已知', '判断限制'], [['引流点击', '216（演示账号级统计）', '内容来源未知，不做单条排名'], ['资格进展', '数据待补齐', '不擅自替换主指标'], ['第3集后续效果', '尚未取得；属于周期后跟踪', '缺失不是零']])}</section>`;
}
function review() {
  return back() + heading('维持方向，检查后续落实', 'REV-0927-01 · 示例复盘') + `<section class="panel"><h2>依据与边界</h2><p>资格进展数据不足，保持主目标；执行条件调整只作用于未开始且仍在原批准窗口内的安排。</p><p>原周期缺口2项保留。后续发布成功也不直接证明策略改善。</p></section><section class="panel"><h2>后续任务</h2>${table(['任务', '当前事实', '下一步'], taskRows().map(r => [r[0], `${r[3]} / ${r[4]}`, go('查看关联安排', r[0] === 'PUB-YT-003' ? 'task' : 'publications')]))}</section>`;
}
function provider() {
  return heading('林先生', 'PRV-002 · 受邀加入 · 已注册（演示）') + `<section class="panel"><h2>关联设备逐台判断</h2>${table(['手机', '项目与身份', '当前条件', '操作'], [['SG-012', '短剧出海 · CostaDrama', state.deviceReady ? '复核通过（演示）' : '恢复复核待处理', go('查看设备', 'device')], ['SG-021', '家居产品 · HomeVista', '提供者暂停；不自动扣减历史收益', button('查看暂停说明', 'info', '该手机由提供者暂停，停止已确认。其他手机独立运行，本页不代替提供者恢复。')]])}</section><section class="panel"><h2>基础分佣摘要</h2>${table(['记录', '收入事实', '佣金状态', '操作'], [['COM-009 · HomeVista', '已到账且核清 USD100.00（示例）', '适用比例未配置；佣金未计算', go('查看收入与分佣依据', 'commission', 'primary')], ['COM-010 · ArchiveStories', '待拆分来源收入 USD240.00', '归属待核对，非本人应得金额', button('查看归属缺口', 'info', '来源收入跨承接边界，当前证据不能准确拆分。不能全部计入林先生佣金。')]])}</section>`;
}
function commission() {
  return back() + heading('HomeVista · 收入与分佣依据', 'COM-009 · 林先生 · 全部为演示数据') + `<div class="metrics"><div class="metric">已到账且核清收入<strong>USD100.00</strong></div><div class="metric">可结算佣金<strong>—</strong>适用比例未配置</div><div class="metric">实际已付<strong>—</strong>暂无已核实付款记录</div></div><section class="panel"><h2>归属与计算</h2><p>收益产生区间：2026-08-01 00:00至09-01 00:00 UTC，结束不含。已核清对应承接期间（示例），到账日在09-26。</p><p>按收益期间适用统一比例计算，不用最新比例追算，不另扣运营成本；本原型不配置比例或支付渠道。</p></section><section class="panel"><h2>处理记录</h2>${noteField('commissionNote', '核对情况及仍缺条件', state.commissionNote)}${formStatus()}${button('保存处理记录', 'save-commission', '', 'primary', true)}<p class="footnote">保存说明不会发起转账，也不会将实际已付改为成功或零。</p></section>`;
}
function progress() {
  const end = ['ending', 'ended'].includes(state.project);
  return back() + heading(end ? '结束与收尾进展' : '项目控制与任务检查', `短剧出海 · ${projectLabel()}`) + `<div class="notice ${state.project === 'paused' && !state.stopConfirmed ? 'warn' : ''}">${state.project === 'paused' ? (state.stopConfirmed ? '演示停止回传已确认，未知发布仍单独核实。' : '暂停请求已受理；停止新增已生效，仍等待在途停止确认。') : end ? '结束请求与执行端停止、取消结果分别记录；平台内容和资源保留。' : state.project === 'resuming' ? '恢复请求已受理，正在等待逐任务检查结果。' : '项目暂停已解除；任务按各自条件推进，窗口过期仍受阻。'}</div><section class="panel"><h2>原任务逐项结果</h2>${table(['任务', '执行/处理', '核验', '操作'], taskRows().map(r => [r[0], r[3], r[4], go('查看详情', r[0] === 'PUB-YT-003' ? 'task' : 'publications')]))}<p class="footnote">PUB-FB-005 的原窗口已过，恢复不补发；PUB-YT-003 未核实前不重新提交。</p>${demos(state.project === 'paused' && !state.stopConfirmed ? button('演示回传：在途停止已确认', 'sim-stop', '', '', true) : state.project === 'resuming' ? button('演示回传：恢复检查完成', 'sim-resume', '', '', true) : state.project === 'ending' ? button('演示回传：停止和未提交取消已确认', 'sim-end', '', '', true) : '<span class="small muted">没有待演示的控制回传。</span>')}</section><section class="panel"><h2>操作记录（演示）</h2><ol class="log">${state.logs.map(l => `<li>${esc(l)}</li>`).join('')}</ol></section><div class="actions">${go('返回项目概览', 'project')}${go('查看原核实任务', 'task')}</div>`;
}
function endProject() {
  return back() + heading('正式结束项目', `短剧出海 · 当前${projectLabel()} · 查看影响不会提交结束`) + `<div class="notice warn">结束后不再启动新发布；已取消安排不能通过普通恢复继续。</div><section class="panel"><h2>本次处理范围</h2>${table(['对象', '已知事实', '处理边界'], [['PUB-YT-004 / PUB-FB-005', '演示数据中尚未提交', '再次核对后取消，保留原关联'], ['PUB-YT-003', state.verified ? '发布已核验' : '提交结果未知', state.verified ? '保留发布与效果记录' : '继续核实，不取消或重发']])}</section><div class="columns"><section class="panel"><h2>收尾观察</h2><p>本项目示例配置7天，自结束生效起计算；这不是通用默认值。</p><p>到期汇总实际可得数据，保留缺失并停止常规采集。未决发布仍独立核实。</p></section><section class="panel"><h2>资源与平台内容</h2><p>账号、手机分配不自动释放，平台内容不自动撤下。另行交接或撤下需明确范围与实际核验。</p></section></div><div class="actions">${button('确认结束项目', 'confirm-end', '', 'danger', true, ['ending', 'ended'].includes(state.project))}${button('返回，保持当前状态', 'back')}</div>`;
}
const pages = { home, projects, project, publications, task, devices, device, readiness, direction, materials, settings, effects, review, provider, commission, progress, end: endProject };
function render(focus = false) {
  if (!pages[state.page]) state.page = 'home'; buttonIndex = 0;
  dirty = draftKeysFor(state.page).some(name => Object.hasOwn(drafts, name));
  const group = ['devices', 'device'].includes(state.page) ? 'devices' : ['provider', 'commission'].includes(state.page) ? 'provider' : state.page === 'home' ? 'home' : 'projects';
  document.getElementById('nav').innerHTML = [['工作台', 'home'], ['项目', 'projects'], ['账号与设备', 'devices'], ['提供者与分佣', 'provider']].map(([label, page]) => go(label, page, group === page ? 'active' : '')).join('');
  main.innerHTML = pages[state.page](); document.title = `${main.querySelector('h1')?.textContent || '工作台'} · SocialGrowth 设计原型`;
  if (mobile()) main.querySelectorAll('[data-draft]').forEach(element => { element.disabled = true; });
  if (focus) main.focus({ preventScroll: true });
  persist();
}
function showDialog(title, body, actions) {
  dialogInvoker = document.activeElement;
  document.getElementById('dialog-content').innerHTML = `<h2 id="dialog-title">${title}</h2>${body}<div class="actions">${actions}</div>`;
  dialog.showModal(); dialog.querySelector('button')?.focus();
}
function closeDialog() { dialog.close(); const filter = document.getElementById('inbox-filter'); if (filter) filter.value = state.filter; if (dialogInvoker?.isConnected) dialogInvoker.focus(); }
function guard(callback) {
  if (!dirty) return callback(); pendingNavigation = callback;
  showDialog('有未保存修改', '<p>保留草稿会带着当前输入离开，尚未提交处理；放弃仅丢弃本次未保存输入。</p>', button('继续编辑', 'close-dialog') + button('保留草稿并离开', 'keep-draft') + button('放弃修改并离开', 'drop-draft'));
}
function navigate(page, replace = false) {
  if (!pages[page]) return;
  guard(() => {
    if (!replace) trail.push({ page: state.page, scroll: scrollY, focus: document.activeElement?.id || '' });
    state.page = page; dirty = false;
    toast(''); history.pushState({ page }, '', `#${page}`); render(true); scrollTo(0, 0);
  });
}
function goBack() {
  guard(() => { const previous = trail.pop(); state.page = previous?.page || 'project'; dirty = false; toast(''); history.pushState({ page: state.page }, '', `#${state.page}`); render(true); if (previous) { scrollTo(0, previous.scroll); document.getElementById(previous.focus)?.focus({ preventScroll: true }); } });
}
function saveNote() {
  const value = drafts.notes ?? state.notes;
  if (!value.trim()) return toast('请填写处理观察；也可交还手机并保留未解决状态。');
  state.notes = value; state.noteSubmitted = true; delete drafts.notes; dirty = false;
  log('人工处理记录已提交（演示）；不等于交还或发布成功。'); render(); toast('处理记录已提交，仍待相关复核。');
}
document.addEventListener('input', (event) => {
  const element = event.target;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) || !element.dataset.draft) return;
  drafts[element.dataset.draft] = element.value; dirty = true;
  persist();
  const indicator = document.getElementById('dirty-state'); if (indicator) { indicator.textContent = '有未保存修改'; indicator.classList.remove('clean'); }
  if (state.page === 'settings') document.getElementById('settings-preview').textContent = `拟定起点：${(drafts.timezone ?? state.timezone) === 'Asia/Bangkok' ? '2026-10-03 23:00 +07:00' : '2026-10-04 00:00 +08:00'}；下一周期 ${drafts.interval ?? state.interval} 天。`;
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'inbox-filter') { const value = event.target.value; guard(() => { state.filter = value; render(); }); }
  if (event.target.id === 'task-filter') { state.taskFilter = event.target.value; render(); }
});
document.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action, value = target.dataset.value;
  if (target.dataset.mutation && mobile()) return toast('手机浏览器仅查看，请转电脑操作。');
  try {
    if (action === 'nav') return navigate(value);
    if (action === 'back') return goBack();
    if (action === 'close-dialog') return closeDialog();
    if (action === 'keep-draft' || action === 'drop-draft') { if (action === 'drop-draft') draftKeysFor(state.page).forEach(k => delete drafts[k]); dirty = false; closeDialog(); const next = pendingNavigation; pendingNavigation = null; return next?.(); }
    if (action === 'info') return showDialog('说明', `<p>${esc(value)}</p>`, button('关闭', 'close-dialog'));
    if (action === 'select') return guard(() => { state.selected = value; render(); });
    if (action === 'open-inbox') { state.selected = 'verify'; state.filter = 'all'; return navigate('home'); }
    if (action === 'save-note') return saveNote();
    if (action === 'request-control' && state.control === 'none') { state.control = 'requested'; log('接管请求已受理，等待停止与独占确认。'); }
    if (action === 'sim-grant' && state.control === 'requested') { state.control = 'owned'; log('演示外部回传：AI停止，李运营取得独占。'); }
    if (action === 'return-control' && state.control === 'owned') return guard(() => { state.control = 'returning'; log('交还请求已受理，仍待实际确认。'); render(); });
    if (action === 'sim-return' && state.control === 'returning') { state.control = 'returned'; log('演示外部回传：手机已交还，开始按当前事实复核。'); }
    if (action === 'sim-verify' && state.control === 'returned' && state.noteSubmitted) { state.verified = true; log('演示外部回传：原任务身份与内容核验通过；设备仍需单独检查。'); }
    if (action === 'sim-ready' && state.control === 'returned' && state.verified) { state.deviceReady = true; log('演示外部回传：设备条件通过；原第4集仍按窗口和排期执行。'); }
    if (action === 'confirm-direction') { state.direction = true; log('二期方向v1已确认（演示），初始化和入口核验仍受阻。'); toast('方向已确认，未就绪条件仍保留。'); }
    if (action === 'save-material') { state.language = drafts.language ?? state.language; if (!state.language) return toast('请选择语言；未知值不能按默认值通过。'); delete drafts.language; dirty = false; state.materialChecked = false; toast('当前素材资料已保存，检查待回传。'); }
    if (action === 'sim-material' && state.language) { state.materialChecked = true; log('演示资料检查通过，候选仍按已批准规则判断。'); }
    if (action === 'save-settings') { state.interval = drafts.interval ?? state.interval; state.timezone = drafts.timezone ?? state.timezone; delete drafts.interval; delete drafts.timezone; dirty = false; state.pendingSettings = true; log('周期设置已保存，待2026-10-04 00:00 +08:00生效；当前周期不变。'); toast('已保存，待下周期生效。'); }
    if (action === 'discard-settings') { delete drafts.interval; delete drafts.timezone; dirty = false; toast('仅放弃本组未保存修改。'); }
    if (action === 'save-commission') { const note = drafts.commissionNote ?? state.commissionNote; if (!note.trim()) return toast('请先填写处理说明。'); state.commissionNote = note; delete drafts.commissionNote; dirty = false; toast('记录已保存，未发起付款。'); }
    if (action === 'pause-dialog') return showDialog('暂停短剧出海的发布？', '<p>停止启动新发布；在途操作需在可确认节点停止，提交未知继续核实。已发布效果按权限和设备条件继续尝试采集。</p><p>暂停不取消任务、不删除内容或释放资源。</p>', button('返回，暂不暂停', 'close-dialog') + button('确认暂停发布', 'confirm-pause', '', 'primary', true));
    if (action === 'confirm-pause' && state.project === 'running') { closeDialog(); state.project = 'paused'; state.stopConfirmed = false; log('项目暂停请求已受理；已停止新增，等待在途确认。'); return navigate('progress'); }
    if (action === 'sim-stop' && state.project === 'paused') { state.stopConfirmed = true; log('演示回传：在途停止已确认；未知发布继续核实。'); }
    if (action === 'resume-dialog') return showDialog('恢复并检查原任务', '<p>解除本次项目暂停后，符合原批准范围与窗口的任务可继续。窗口过期不补发，提交未知先核实；其他暂停、接管与授权限制仍有效。</p>', button('保持暂停', 'close-dialog') + button('确认恢复并检查', 'confirm-resume', '', 'primary', true));
    if (action === 'confirm-resume' && state.project === 'paused') { closeDialog(); state.project = 'resuming'; log('恢复请求已受理；等待原任务与停止/控制事实核对。'); return navigate('progress'); }
    if (action === 'sim-resume' && state.project === 'resuming') { state.project = 'running'; log('演示恢复检查：本次项目暂停解除，过窗/设备/未知发布仍按实际条件阻断。'); }
    if (action === 'confirm-end' && !['ending', 'ended'].includes(state.project)) { state.project = 'ending'; log('结束请求已受理；停止新增，等待在途确认和逐任务取消结果。'); return navigate('progress'); }
    if (action === 'sim-end' && state.project === 'ending') { state.project = 'ended'; state.stopConfirmed = true; log('演示回传：未提交安排已取消；进入示例7天收尾，未知发布仍核实，资源不释放。'); }
    if (action === 'reset') return showDialog('重置本机演示？', '<p>仅清空这个原型的示例操作和草稿，不影响实际项目。</p>', button('保留当前演示', 'close-dialog') + button('确认重置演示', 'confirm-reset', '', '', true));
    if (action === 'confirm-reset') { closeDialog(); state = { ...initial, logs: [...initial.logs] }; Object.keys(drafts).forEach(k => delete drafts[k]); dirty = false; trail.length = 0; history.replaceState({ page: 'home' }, '', '#home'); }
    render();
  } catch (error) { console.error('Prototype action failed', error); toast('演示操作未完成，输入和现有记录保留。'); }
});
dialog.addEventListener('cancel', () => { pendingNavigation = null; });
dialog.addEventListener('close', () => { if (dialogInvoker?.isConnected) dialogInvoker.focus(); });
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('popstate', (event) => {
  const page = event.state?.page || location.hash.slice(1) || 'home';
  if (dirty) { history.pushState({ page: state.page }, '', `#${state.page}`); guard(() => navigate(page, true)); }
  else { state.page = pages[page] ? page : 'home'; render(true); }
});
const hashPage = location.hash.slice(1); if (pages[hashPage]) state.page = hashPage;
history.replaceState({ page: state.page }, '', `#${state.page}`); render();
matchMedia('(max-width:760px)').addEventListener('change', () => render());
