'use client';
import {useState, type ReactNode} from 'react';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {sources,income,rpm,rates,history,payouts,checks} from './evidence';
import {nonnegative,viewIncome,reelsIncome,commission,eligibility,apiCapacity} from '@/lib/calculations';
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const number=(n:number)=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(n);
function Refs({ids}:{ids:string}){return <span className="refs">{ids.split(',').map(id=>{const s=sources.find(s=>s.id===id);return s?<a key={id} href={s.url} target="_blank" rel="noreferrer" title={`${s.title} · ${s.date}`}>[{id}] ↗</a>:null})}</span>}
function MarkedText({text}:{text:string}){const kind=/待核验|待后台|待核/.test(text)?'pending':/未公开|未公布/.test(text)?'missing':/测算值/.test(text)?'formula':null;return kind?<><span className={`status-dot ${kind}`} aria-hidden="true"/>{text}</>:<>{text}</>}
function GridTable({heads,rows}:{heads:string[];rows:ReactNode[][]}){return <Table><TableHeader><TableRow>{heads.map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row,i)=><TableRow key={i}>{row.map((cell,j)=><TableCell key={j}>{typeof cell==='string'?<MarkedText text={cell}/>:cell}</TableCell>)}</TableRow>)}</TableBody></Table>}
function Section({id,n,title,children}:{id:string;n:string;title:string;children:ReactNode}){return <section id={id} className="panel"><div className="section-title"><span>{n}</span><h2>{title}</h2></div>{children}</section>}
function Choice({id,label,value,onChange,items}:{id:string;label:string;value:string;onChange:(v:string)=>void;items:{value:string;label:string}[]}){return <div className="field"><label htmlFor={id}>{label}</label><Select items={items} value={value} onValueChange={v=>{if(v!==null)onChange(String(v))}}><SelectTrigger id={id}><SelectValue/></SelectTrigger><SelectContent>{items.map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></div>}
function Num({id,label,value,onChange,max,step='any',hint}:{id:string;label:string;value:string;onChange:(s:string)=>void;max?:number;step?:string;hint?:string}){const n=nonnegative(value);const invalid=n===null||(max!==undefined&&n>max)||(step==='1'&&!Number.isInteger(n));return <div className="field"><label htmlFor={id}>{label}</label><Input id={id} type="number" min="0" max={max} step={step} value={value} onChange={e=>onChange(e.target.value)} aria-invalid={invalid} aria-describedby={hint?`${id}-hint`:undefined}/>{hint&&<small id={`${id}-hint`}>{hint}</small>}</div>}
function Bars({rows,max,unit='%',color='blue'}:{rows:{label:string;value:number;display?:string}[];max:number;unit?:string;color?:string}){return <div className={`bars ${color}`} role="img" aria-label={rows.map(r=>`${r.label} ${r.display??r.value+unit}`).join('；')}>{rows.map(r=><div className="bar-row" key={r.label}><span>{r.label}</span><div className="bar-track"><div className="bar-fill" style={{width:`${max>0?Math.min(100,r.value/max*100):0}%`}}/></div><strong>{r.display??`${r.value}${unit}`}</strong></div>)}<div className="axis"><span>0</span><span>{max}{unit}</span></div></div>}
function ReelsResearch(){
const [total,setTotal]=useState(''),[qualified,setQualified]=useState(''),[rate,setRate]=useState(''),[active,setActive]=useState(false);
const result=reelsIncome(total,qualified,rate,active);const r=nonnegative(rate);
return <Section id="reels" n="01" title="Facebook Reels：准入门槛与平台收益">
<div className="process-line"><span>原创账号</span><b>→</b><span>平台邀请</span><b>→</b><span>审核与收款设置</span><b>→</b><span>合格内容收益</span><Refs ids="F1,F2"/></div>
<GridTable heads={['准入维度','要求 / 口径','状态与执行要点']} rows={[
['账号与工具','Page或个人档案专业模式；开启工具不等于收益获批。',<>核对账号与管理权限。<Refs ids="F10,F1"/></>],
['邀请与数字门槛','邀请制；无公开统一粉丝、观看量或小时门槛。',<>专业面板 → 变现 → 提交意向。<Refs ids="F1"/></>],
['原创与账号合规','原创内容；持续符合内容、推荐及变现规则。',<>核对原创材料、版权及违规记录。<Refs ids="F3,F8"/></>],
['年龄、地区、语言','最低年龄、主体地区及语言支持清单待核验。',<>登录官方资格页核对；主体地区≠观众地区。<Refs ids="F9"/></>],
['视频与合格观看','Reels含长短视频；按后台合格观看计佣。',<>最低计佣时长待核验；查看不合格原因。<Refs ids="F7,F1,F9"/></>],
['开通与收款','接受条款、完成身份及收款设置。',<>税务、付款门槛及周期待后台核验。<Refs ids="F6,F9"/></>]
]}/>
<p className="small"><span className="tag historical">独立计划</span> Stars、Fast Track及历史In-stream Ads条件，不适用于普通Reels统一准入。<Refs ids="F2,F10"/></p>
<div className="subhead"><h3>收益规模与统计边界</h3><span className="tag official">官方披露 · 2025年</span></div>
<div className="split"><div><GridTable heads={['指标','结果','口径']} rows={[
['2025 Facebook整体付款','接近30亿美元；Reels占60%','含长短视频；缺少同口径账号数'],
['Reels付款量级（计算值）','近30亿美元 × 60% ≈ 18亿美元','测算值；非官方精确单列额'],
['年收入超过1万美元的创作者','人数同比增长超过30%','人数与该档均值未公开'],
['低／中／高档Reels平均收益','数据未公开','不按粉丝档位推定月收入']
]}/><Refs ids="F1"/></div><figure><figcaption>2025 Facebook创作者付款构成</figcaption><Bars rows={[{label:'Reels（含长短视频）',value:60},{label:'Stories、图文等',value:40}]} max={100}/><p className="small">Reels含长短视频；40%为余数。图示为付款构成。<Refs ids="F1,F7"/></p></figure></div>
<details className="calculator-fold"><summary>Reels收益测算｜输入账号后台数据</summary>
<p>收入≈合格观看÷1,000×后台Earnings Rate；使用同期、同类内容数据。<Refs ids="F1"/></p>
<div className="split"><form aria-label="Facebook Reels收益计算" onSubmit={e=>e.preventDefault()}><div className="form-grid"><Num id="fb-total" label="同一期间后台总观看量" value={total} onChange={setTotal} step="1"/><Num id="fb-qualified" label="其中合格观看量 Qualified Views" value={qualified} onChange={setQualified} step="1"/></div><Num id="fb-rate" label="同期同类内容 Earnings Rate（USD/千次）" value={rate} onChange={setRate} hint="按USD填写；不自动换汇。"/><label className="checkline"><Checkbox checked={active} onCheckedChange={setActive}/><span>已开通；观看处于有效变现期间</span></label><small>测算表单，不连接平台账户。</small></form><div className="result-box" aria-live="polite"><span>本期平台内容收入 · 近似换算</span><output>{result?money(result.payable):'等待后台数据'}</output><p>{result?(active?'以平台最终结算为准。':'未开通：平台播放收益计为$0。'):'请输入有效数据；合格观看≤总观看。'}</p><div className="result-line"><span>合格观看占比</span><b>{result?.qualifiedShare!==null&&result?.qualifiedShare!==undefined?`${result.qualifiedShare.toFixed(1)}%`:'—'}</b></div><div className="result-line"><span>单价对应参考额</span><b>{result?money(result.reference):'—'}</b></div><small>Earnings Rate已为创作者口径，无需再乘分成比例。</small></div></div>
<GridTable heads={['同一后台单价 r（USD/千次）','10万合格观看','100万合格观看','1,000万合格观看']} rows={[[r===null?'未提供；以r表示':`$${r}`,r===null?'100 × r':money(r*100),r===null?'1,000 × r':money(r*1000),r===null?'10,000 × r':money(r*10000)]]}/>
<p className="small">东南亚AI漫剧代表性Reels单价：数据未公开。上述为固定单价测算。</p>
</details>
<details><summary>Reels收益机制沿革｜2022–2026</summary><GridTable heads={['时间','机制/披露','收入数字应如何理解','来源']} rows={[
['2022','Reels Play奖励曾公布最高$35,000/月','历史奖励上限；非当前收益基准',<Refs key="f5" ids="F5"/>],
['2023','Ads on Reels转向内容表现付费','按内容表现计酬；无统一单价',<Refs key="f6" ids="F6"/>],
['2024','合并为Content Monetization','三个计划合并；沿用表现付费',<Refs key="f2" ids="F2"/>],
['2025数据／2026披露','Reels占全年Facebook创作者付款60%','约18亿美元量级（测算）；无人均值',<Refs key="f1" ids="F1"/>],
['2026 Fast Track','外平台≥10万粉丝：$1,000/月；>100万：$3,000/月；3个月','限时奖励；地区与完整条款待核验',<Refs key="fast" ids="F1"/>]
]}/></details>
<h3>账号核心价值与管理指标</h3>
<p>管理建议：按账号连续跟踪；不设无依据的统一达标线。</p>
<GridTable heads={['核心维度','要记录的后台数据/材料','对账号价值的意义']} rows={[
['真实受众积累','新增、取关、净增粉；每条Reel带来的关注；粉丝/非粉丝触达','衡量关注转化与受众积累'],
['持续观看','观看留存曲线、观看时长、各集表现','衡量系列内容吸引力'],
['内容与推荐状态','原创材料、推荐状态、侵权与违规记录','维护推荐与变现资格'],
['平台收益质量','合格观看、不合格原因、Earnings Rate、各期最终收入','区分观看、计佣与单价变化']
]}/><p className="small">AI漫剧须有实质叙事及原创贡献；重复分发不增加原创价值。<Refs ids="F10,F1,F3,F8"/></p>
</Section>}
function LaunchGuide(){return <Section id="launch" n="05" title="自有账号起号与持续运营">
<div className="compact-note"><b>适用前提</b> 账号干净、自有，主体与控制权已确认；以Facebook Page／专业模式及YouTube频道开展多账号运营。<br/><span className="tag formula">运营建议</span> 按完成条件推进；发布频次、复盘周期与扩号节奏由团队安排，不设统一90天启动期限。</div>
<h3>时间口径｜90天是观看统计窗口</h3>
<GridTable heads={['事项','是否为硬性时间要求','执行口径']} rows={[
['起号与“养号”周期','无已核实的统一90天要求','准备完成即可正常发布；无需先空置、浏览或互动满固定天数。'],
['YouTube Shorts准入',<>近90天是官方统计窗口。<Refs ids="Y1,Y2"/></>,'从查看资格的时点向前统计；不要求等账号满90天，也不要求注册后90天内必须达标。'],
['YouTube长视频准入',<>当前按近12个月统计合格观看小时。<Refs ids="Y1"/></>,'这是另一条观看指标路径；无需运营满12个月，Shorts Feed时长不计入。'],
['Facebook Reels开通',<>邀请制；未公开统一开通天数。<Refs ids="F1"/></>,'持续检查专业面板及变现意向入口；不以第30／60／90天作为必获邀节点。']
]}/>
<p className="small"><b>窗口示例：</b>若30天内已满足全部申请条件，可在后台入口开放后申请；运营超过90天仍可继续达标，但Shorts观看按最近90天计算，过期观看移出窗口。数字达标后仍需审核。<Refs ids="Y1"/></p>
<h3>起号流程｜完成一项，推进一项</h3>
<div className="process-line"><span>基础设置</span><b>→</b><span>发布验证</span><b>→</b><span>持续运营</span><b>→</b><span>条件满足后申请收益</span></div>
<GridTable heads={['阶段','执行动作','完成条件（内部管理）']} rows={[
['基础设置','固定账号语言、目标受众、题材与系列；完善名称、头像、简介；分配负责人、发布及复核权限，设置两步验证。','资料完整；负责人明确；登录、恢复及授权可用。'],
['功能准备',<>核对YouTube电话验证与高级功能；可用时选择ID／视频验证，否则积累频道历史。FB检查专业工具及变现面板。<Refs ids="Y11,F1"/></>,'明确已开放功能与待完成项；基础发布可用即可开展运营，高级功能按后台要求完成。'],
['内容与首发','确认原创贡献、音乐及素材许可、AI披露要求；核对语言、标题、封面、字幕、系列顺序；完成首条发布或原生排期。','页面正常展示；视频与文案正确；发布URL、素材版本和权利记录齐全。'],
['建立复盘基线','连续发布同一受众方向的内容；记录各条视频在相同发布后时长的表现，归纳留存和关注转化。','形成可比较的样本；能指出表现较好或较弱的内容环节。']
]}/>
<p className="small">发布授权与原创收益资格分别核对；商户提供素材或获得使用许可，不自动满足平台原创变现要求。<Refs ids="F3,Y5,Y6"/></p>
<h3>持续“养号”｜发布、互动与复盘形成日常工作</h3>
<GridTable heads={['工作项','建议动作','观察与调整']} rows={[
['发布安排','按素材储备和审核能力排期；试运行可从每个账号每日1条开始，也可降低频次保持质量。','频次是内部安排，不是平台流量规则；按账号独立维护语言、题材和系列定位。'],
['真实互动',<>回复与内容相关的问题，收集后续剧情需求；在适当位置自然引导关注、评论或观看下一集。<Refs ids="Y12"/></>,'记录有效反馈；不安排账号互刷、互订或批量制造评论。'],
['每周复盘','同格式、同发布后观察窗口比较中位表现；关注留存、净增粉、每千观看关注数及回访。','每轮优先调整一个变量，例如开场、标题或叙事节奏；不以单条播放量决定扩号。'],
['账号维护','检查版权、推荐、变现及发布异常；处理后台通知，核对授权人员及排期失败记录。','有明确异常先处理；观看量低本身不作为违规判定。'],
['扩量条件','有效系列可持续供给、同口径表现稳定、审核及发布能够及时完成后，再增加频次或账号数。','运营判断；无官方统一留存率、条数或天数达标线。']
]}/>
<div className="compact-note"><b>执行边界</b> 未找到“先浏览7／14／30天”能提高变现资格的官方依据。避免多个同平台账号机械复制内容；同一自有原创作品跨平台发布需核对各平台及音乐许可。<Refs ids="Y11,F3,F8"/></div>
<h3>缩短达标路径｜持续增加符合口径的观看与订阅</h3>
<GridTable heads={['路径','当前申请指标','优先动作']} rows={[
['YouTube完整广告 · Shorts',<>1,000订阅＋近90天1,000万合格Shorts观看。<Refs ids="Y1"/></>,'围绕有效系列持续更新，改善开场留存与关注转化；以Studio Earn中的资格数据跟进差距。'],
['YouTube扩展YPP · Shorts',<>500订阅＋近90天3次有效公开上传＋近90天300万合格Shorts观看。<Refs ids="Y2"/></>,'支持地区可先申请适用的粉丝付费等功能；该档不等于完整广告分成。'],
['YouTube完整广告 · 长视频',<>1,000订阅＋近12个月4,000合格观看小时。<Refs ids="Y1"/></>,'题材适合时发布有完整叙事的长篇，与Shorts共同服务同一受众；不为凑时长重复拼接。'],
['Facebook Reels',<>Content Monetization邀请制。<Refs ids="F1"/></>,'提交变现意向，持续原创并改善观看与真实受众积累；收到邀请后完成条款、身份及收款设置。']
]}/>
<p className="small">各频道分别统计。Promote产生的订阅和观看小时、广告活动中的Shorts观看不计相应YPP准入指标；投放不能直接补齐门槛。实际申请时按<a href="#eligibility">准入表</a>及后台当期规则核对，含已公布的2027-02-01调整。<Refs ids="Y13,Y1,Y3"/></p>
<h3>多账号协同｜按权限分工，按账号核算</h3>
<GridTable heads={['管理环节','执行方式','依据 / 限制']} rows={[
['Facebook','通过Page任务权限及Meta Business Suite分配发布工作；关键控制权限由明确负责人持有。',<>按岗位授予必要权限；完全控制权限可移除他人及删除Page。<Refs ids="F12"/></>],
['YouTube','每个品牌独立频道；编辑负责上传发布，所有者处理关键资格、身份验证及合同。',<>一个Google账号可管理多个Brand Account；使用频道角色授权，无需共享密码。<Refs ids="Y9,Y10,Y11"/></>],
['验证资源','提前登记可持续控制的验证方式，按验证限额安排启动数量。',<>同一手机号每年最多验证2个频道。<Refs ids="Y16"/></>],
['发布自动化','先用原生排期；系统接入正式API时，分别配置OAuth授权、任务状态、失败重试及发布记录。',<>YouTube频道受邀权限不支持API；未验证API项目可能只能上传私密视频。<Refs ids="Y10,Y15"/></>],
['统一台账','记录账号、负责人、语言题材、素材ID、授权、发布URL及核心数据；每个账号独立复盘。','总播放量、资格观看、计佣观看分栏；内部工作完成不代表平台收益审核通过。']
]}/>
</Section>}
function ApiGuide(){
const [accounts,setAccounts]=useState('15'),[posts,setPosts]=useState('2'),[days,setDays]=useState('7'),[interval,setInterval]=useState('60'),[meanViews,setMeanViews]=useState('');
const c=apiCapacity(accounts,posts,days,interval),v=nonnegative(meanViews);const projected=c&&v!==null&&Number.isFinite(c.weeklyPosts*v)?c.weeklyPosts*v:null;
return <Section id="api" n="06" title="自动发布与数据采集容量">
<p><span className="tag official">官方文档核查 · 2026-09-11</span> 内容符合质量要求，仍需满足账号、接口及项目额度。以下为文档确认；自有账号授权、实际额度与字段返回尚未联调。</p>
<h3>发布上限｜账号额度与项目额度分别计算</h3>
<GridTable heads={['平台 / 层级','已确认限制','对多账号排期的影响']} rows={[
['Facebook Reels · 单Page',<>每Page滚动24小时最多<b>30条API发布</b>。<Refs ids="F13"/></>,'适用于video_reels发布接口；非每日零点清零，不代表推荐发布量。还需满足Graph API限流。'],
['Facebook · 支持范围',<>发布接口支持Page；该接口视频规格为3–90秒。<Refs ids="F13"/></>,'个人专业模式的变现能力不等于Page API能力；不能将App端视频规格直接套入接口。'],
['YouTube · 单频道',<>24小时存在动态上传上限；<b>统一条数未公开</b>。<Refs ids="Y18"/></>,'网页、移动端与API共同受限；干净自有账号也不能据此认定为无限上传。'],
['YouTube · API项目',<>默认<b>100次videos.insert/日</b>；独立上传额度桶。<Refs ids="Y17,Y15"/></>,'多个频道共用同一项目额度。100个频道×2条/日需200次上传，应申请增额；不能按每频道100次估算。'],
['YouTube · 订阅通知',<>每位观众每频道24小时最多3次视频／直播／首映通知。<Refs ids="Y23"/></>,'短时间批量发布可能暂停通知24小时；通知限额不等于上传或自然推荐上限。']
]}/>
<p className="small">YouTube项目日额度按太平洋时间午夜重置；上传成功、处理完成、公开发布分别记录。未验证项目可能仅能上传私密视频，需通过审核解除。<Refs ids="Y17,Y15"/></p>
<h3>API可以查询哪些指标</h3>
<GridTable heads={['业务指标','YouTube','Facebook Reels / Page']} rows={[
['播放 / 观影数',<>Data API：viewCount；Analytics：views、engagedViews，口径分开。<Refs ids="Y19,Y21,Y22"/></>,<>blue_reels_play_count不含重播；fb_reels_total_plays含重播；非独立人数。<Refs ids="F15"/></>],
['总观看时长 / 平均时长',<>estimatedMinutesWatched为分钟；averageViewDuration为秒。contentDetails.duration仅是视频片长。<Refs ids="Y21,Y22"/></>,<>post_video_view_time、post_video_avg_time_watched均为毫秒，含重播；均时可能超过片长。<Refs ids="F15"/></>],
['留存 / 观看深度',<>averageViewPercentage等；按支持的报表组合查询。<Refs ids="Y21,Y25"/></>,<>post_video_retention_graph为分段留存曲线。<Refs ids="F15"/></>],
['点赞 / 评论 / 分享',<>Data API读likeCount、commentCount；Analytics提供shares及互动统计。<Refs ids="Y21,Y22"/></>,<>post_video_likes_by_reaction_type；post_video_social_actions提供评论、分享。<Refs ids="F15"/></>],
['收藏 / 稍后观看',<>videosAddedToPlaylists含“稍后观看”，是加入次数；favoriteCount已废弃且恒为0。<Refs ids="Y21,Y22"/></>,<>Reels指标表未列专用收藏字段；<span className="tag pending">待核验</span> 不将Instagram的saved字段套用。<Refs ids="F15"/></>],
['关注增长',<>subscribersGained／Lost；视频维度只覆盖相应观看页来源，不能替代频道全量增粉。<Refs ids="Y21"/></>,<>post_video_followers提供Reel带来的关注。<Refs ids="F15"/></>],
['收益 / 合格观看',<>收益报表需YPP与monetary权限；公开viewCount不可直接当YPP资格观看。<Refs ids="Y26"/></>,<>文档列creator_monetization_qualified_views；处于Ad Breaks分类，当前FCM/Reels覆盖及收益字段须用获权账号验证。<Refs ids="F15"/></>]
]}/>
<details><summary>接入权限与指标口径</summary><p className="small">YouTube详细分析需所属频道OAuth授权；上传权限不包含全部分析与收益权限。Facebook发布需Page CREATE_CONTENT及pages_show_list、pages_read_engagement、pages_manage_posts；Video Insights v26.0参考页列ANALYZE、pages_manage_engagement及read_insights，具体权限通过应用审核与联调确认。<Refs ids="Y15,Y25,Y26,F13,F15"/></p><p className="small">Facebook Reels上述观看与互动字段以lifetime返回，日内增量可用相同字段快照差值观察；平台修订可能造成回调，不把差值直接当最终日结数据。<Refs ids="F15"/></p></details>
<h3>查询频率｜接口额度与数据更新时间是两件事</h3>
<GridTable heads={['接口','调用额度 / 窗口','采集建议（非官方要求）']} rows={[
['YouTube Data API',<>videos.list每次1单位；除上传/搜索外，默认项目共用10,000单位/日。短时QPS及用户配额以控制台为准。<Refs ids="Y17,Y19"/></>,'新视频播放、赞、评论可每30–60分钟读取；已知视频ID批量查询，减少重复查找。'],
['YouTube Analytics API',<>每次查询1单位；具体日额度及短时额度看本项目控制台，不能套用Data API或Google Analytics额度。<Refs ids="Y20"/></>,'通常延迟48–72小时；每天查询1次已完成日期，回补最近7天；急看播放数用Data API。'],
['Facebook Pages / Insights',<>Page或System User token适用BUC：24小时调用预算=4,800×Page互动用户数；另受CPU及总时间限制。<Refs ids="F14"/></>,'新Reel可先每60分钟一次，旧内容每日一次；根据用量响应头调整。新Page实际预算须后台确认，不推定最低保底。'],
['Facebook 数据时效','统一刷新SLA待核验；可查询不代表每次都有新增数据。','记录采集时间、指标期间和返回值；连续不变时降低频次，不以高频轮询推定实时。']
]}/>
<p className="small">Facebook使用App/User token时可能适用另一套平台限流；常见“200次/小时”不能直接当每Page查询上限。监测X-Business-Use-Case-Usage等适用响应头，按错误及恢复时间退避。分页、状态轮询与失败请求也要预留预算。<Refs ids="F14,Y17"/></p>
<h3 id="portfolio-goals">30账号经营目标｜先验证表现，再集中推进变现</h3>
<div className="compact-note"><b>测算前提</b> 暂按15个YouTube频道＋15个Facebook Page、从零起步、每号每日2条。30个账号总数已确认；平台配比、现有粉丝及历史流量尚未提供。<br/><span className="tag formula">内部目标建议</span> 首轮以30天评估，周期可调整；不是平台养号期限。尚无样本支持收益达标概率或保底收入。</div>
<GridTable heads={['规模 / 工作量','YouTube','Facebook','合计或判断']} rows={[
['账号数','15个频道','15个Page','合计30个账号'],
['日发布 / 30天计划','30条 / 900条','30条 / 900条','60条/日；30天1,800条发布记录'],
['默认发布额度占用',<>30次上传/项目/日，占默认100次的30%。<Refs ids="Y17"/></>,<>每Page 2条/日，占30条限制约6.7%。<Refs ids="F13"/></>,'数量上有余量；频道动态上限、授权、素材规格和账号状态另核。'],
['每小时跟踪近7天内容','约360次基础统计读取/日；Analytics另按15次/日起规划','约5,040次Insights/日；每Page 336次','按每频道20个ID/批、每Reel一次查询；不含分页、状态、其他操作及重试。']
]}/>
<p className="small">1,800条为平台发布次数。若15个内容品牌各自跨两平台发布同一套自有原创作品，对应900份视频；同平台账号仍需保持受众与内容定位。素材供应不足时降低频次，并同比调整发布目标。</p>
<GridTable heads={['首轮30天目标（内部建议）','验收口径','目标性质']} rows={[
['按计划成功公开发布≥95%','1,800条计划中≥1,710条；两平台分别记录完成率，失败任务有处理结果。','团队执行目标；不是平台保证。'],
['已发布内容归档100%','每条关联账号、素材版本、权利、发布时间、视频ID及URL。','可控管理目标。'],
['每周一次复盘，首轮至少4次','同平台、同题材、相同发布后窗口比较留存、合格观看、净增粉及每条中位表现。','完成数据验证，不以总播放代替资格观看。'],
['重点候选账号最多6个','可先关注YT前3、FB前3；须同时有持续表现与内容供应，样本不足时不强行凑数。','资源排序上限；不是预测6个账号一定成功。'],
['首个变现冲刺对象','从有证据支持的YT候选中选1个，按实际差距确定完整YPP申请目标与复盘节奏。','挑战目标；未设30天必达或固定获批日期。'],
['15个FB账号资格状态可追踪','检查变现入口；可提交意向的账号完成提交，收到邀请后完成后续申请。','邀请数及获批数不设保底。']
]}/>
<h3>单个YouTube频道需要什么流量水平</h3>
<GridTable heads={['路径 / 情景','90天窗口内观看贡献','订阅及其他条件','如何判断']} rows={[
['Shorts：平均每条贡献1,000次','180条×1,000＝18万合格观看','观看仅为完整门槛的1.8%','继续验证内容；发布量完成不代表接近变现。'],
['Shorts：平均每条贡献5,000次','180条×5,000＝90万合格观看','观看仅为完整门槛的9%','需要明显提高单条表现，不能靠延长到180天相加补齐90天窗口。'],
['Shorts：扩展YPP','约1.67万/条，合计300万合格观看',<>500订阅＋近90天3次有效公开上传；支持地区及审核。<Refs ids="Y2"/></>,'可申请适用的粉丝付费等功能；不等于完整广告分成。'],
['Shorts：完整广告分成','约5.56万/条，合计1,000万合格观看',<>1,000订阅；政策、地区、功能、收款及审核。<Refs ids="Y1,Y2"/></>,'作为重点频道冲刺目标，先用实测验证可达性。'],
['长视频：完整广告分成','近12个月4,000小时；假设平均观看4分钟，约需6万次合格长视频观看',<>仍需1,000订阅及审核；Shorts Feed时长不计入。<Refs ids="Y1"/></>,'如已有适合完整叙事的长视频，可单独评估这条路径。']
]}/>
<p className="small">测算假设：每号每日2条、90天共180条；“每条贡献”指同一统计窗口内的观看贡献均值，不是假设所有视频均拥有90天传播时间。数值向上近似，非行业平均或逐条门槛。15个YT频道各自完整达标意味着各自1,000万、合计至少1.5亿合格Shorts观看；跨账号不可合并申请。当前规则及已公布后续调整见<a href="#eligibility">准入表</a>。<Refs ids="Y1,Y3"/></p>
<p className="small">订阅进度参考：从0起步，按90天均分，500订阅约需每日净增6个、1,000订阅约需每日净增12个。仅作内部进度标尺；订阅门槛本身不要求在90天内新增完成。</p>
<p className="small"><b>目标校准：</b>首轮数据成熟后，以单频道最近28天合格Shorts观看÷28估算近期日均，分别对照约3.34万/日（扩展）和11.12万/日（完整）。该比较仅作进度信号；历史观看到期、近期增长与订阅差距需同时核对，不线性承诺达标日期。Facebook按同平台表现选重点账号，邀请状态单独跟进。<Refs ids="Y1,Y2,F1"/></p>
<h3 id="half-capacity">50%额度方案｜发布上限有余量，效果需验证</h3>
<div className="compact-note"><b>评估前提</b> 内容供应充足且符合原创、质量及权利要求。FB按单Page上限的50%计算；YT单频道上限未公开，暂按单API项目默认上传额度的50%计算。两个“50%”的分母不同。<Refs ids="F13,Y17,Y18"/></div>
<GridTable heads={['规划项','Facebook：15个Page','YouTube：15个频道']} rows={[
['50%对应发布量',<>每Page 30×50%＝15条/滚动24小时。<Refs ids="F13"/></>,<>整个项目100×50%＝50次上传/日；各频道动态上限另核。<Refs ids="Y17,Y18"/></>],
['分配示例','15个Page各15条，共225条/日。','10个频道各3条＋5个频道各4条，共50条/日；此为分配示例。'],
['30天工作量','6,750条发布记录。','1,500次上传；两平台合计8,250条，平均275条/日。'],
['每小时查询最近7天内容','1,575条视频，约37,800次Insights/日；每Page约2,520次。','350条视频；按每频道每批20个ID，约720次videos.list/日；Analytics等另计。'],
['额度仍需检查','滚动24小时排期＋Pages调用用量、CPU与时间限制；发布量50%不等于所有接口都只占50%。','单频道实际上传限制＋项目上传额度＋其他接口额度；通知另有约束。']
]}/>
<p className="small">测算值；沿用同一项目、均匀发布及按频道分批假设。读取数不含上传、处理状态、分页、其他报表和重试。FB“30条”来自本次研究已读取的官方正文，当前入口可能出现访问限制；实际账号运行仍需联调。<Refs ids="F13,F14,Y17,Y19"/></p>
<p className="small"><b>排期建议：</b>FB每Page每日15条，若分布在24小时约每96分钟一条；若集中在目标受众活跃的15小时约每小时一条。以上为排期示例，不是平台最低间隔；实际按任意滚动24小时计数，并计入其他工具的API发布。</p>
<p className="small"><b>采集降频示例：</b>FB将首24小时视频按小时采集、第2–7天视频改为每日一次，稳态约需15×15×24＋15×15×6＝6,750次Insights/日，每Page约450次；比全部近7天视频每小时采集减少约82%。边界调度、数据回补及其他操作另计；更新慢于查询时仍应继续降频。</p>
<p className="small"><b>如何判断多发是否有收益：</b>FB由2条提高到15条，发布量为7.5倍。静态测算中，若同类视频在相同观察窗口内的单条平均合格观看保持原来的约13.3%，本批总合格观看即可大致持平；更高则增加。此计算不含对旧内容、受众及单价的影响，不是平台流量预测；同时核对净增粉和最终收益。</p>
<GridTable heads={['可能影响','已经确认的规则 / 分析','执行建议']} rows={[
['推荐与受众响应','没有已核实的“用到50%即可保证推荐”规则，也不能仅凭15条/日断定一定被降权。高频发布的实际效果需实验。','重点比较同周期总合格观看、净增粉及回访；单条均值下降时，结合总量判断，避免只看发片数。'],
['YouTube通知覆盖',<>每位观众每频道24小时最多3次视频类通知；短时间发布超过3条可能暂停通知24小时。<Refs ids="Y23"/></>,'分散排期，避免集中公开；4条/日不意味着每条都会通知订阅者，通知限制不等于自然推荐限制。'],
['数据与发布稳定性','FB逐视频小时查询由原方案5,040次/日增至37,800次/日；需同时观察实际响应头及错误。','新视频优先采集，旧视频降低频次；遇限流按返回状态退避，避免盲目重复提交已可能发布成功的任务。'],
['变现推进','多发会增加测试内容数量；YT观看和订阅门槛不随发布量降低，FB邀请时间也无保证。','只有总合格观看及真实受众积累持续改善，才视为更接近目标。']
]}/>
<details><summary>高频方案的试运行与达标测算</summary><p className="small"><b>运营建议：</b>可选择2–3个Page先测试10–15条/日，其他Page维持已验证节奏作为参考；YT按3条/频道/日规划45次上传，少量频道测试第4条，总量不超过50次。以每条发布后相同7天窗口及对应周期净增粉比较；7天是观察口径，不是平台要求。受众、题材差异会影响比较，单次试验不能证明因果。</p><p className="small"><b>扩量判断：</b>在周期总合格观看、净增粉改善，且发布、审核、权限和采集持续可靠时扩大；仅有播放总量上升而关注转化恶化时继续分析。95%发布完成率沿用内部验收目标，不代表平台成功率保证。</p><GridTable heads={['单个YT频道','90天发布条数','达到1,000万合格观看所需的窗口内单条平均贡献']} rows={[
['2条/日','180条','约55,556次'],
['3条/日','270条','约37,038次'],
['4条/日','360条','约27,778次']
]}/><p className="small">测算值向上取整；每频道仍需1,000订阅及审核。单条贡献均值下降只是数学分摊，不证明总流量必然增加；近90天总计1,000万的要求未变。<Refs ids="Y1,Y24"/></p></details>
<details className="calculator-fold" open><summary>等频率容量计算｜默认15个YT＋15个FB，各2条/日</summary>
<p className="small">假设两平台各有N个账号，均匀发布；持续跟踪最近D天视频。YouTube按每频道每批20个已知视频ID规划；FB按每Reel一次Insights查询、一次取多个支持指标。批量数是规划假设，非官方上限。</p>
<form aria-label="发布与API采集容量测算" onSubmit={e=>e.preventDefault()}><div className="form-grid four"><Num id="api-accounts" label="每个平台账号数 N" value={accounts} onChange={setAccounts} step="1"/><Num id="api-posts" label="每账号每日发布条数 p" value={posts} onChange={setPosts} step="1"/><Num id="api-days" label="持续跟踪最近视频天数 D（≥1）" value={days} onChange={setDays} step="1"/><Choice id="api-interval" label="播放与互动查询间隔" value={interval} onChange={setInterval} items={[{value:'15',label:'每15分钟'},{value:'30',label:'每30分钟'},{value:'60',label:'每60分钟'},{value:'360',label:'每6小时'},{value:'1440',label:'每天一次'}]}/></div></form>
<div aria-live="polite">{c?<><GridTable heads={['规划量','YouTube','Facebook']} rows={[
['每日上传 / 发布',`${number(c.dailyUploads)}次上传；共用默认100次项目额度`,`${number(c.dailyUploads)}条；每Page ${posts}/30条滚动24小时额度`],
['每账号跟踪视频数',`${number(c.perAccountVideos)}条`,`${number(c.perAccountVideos)}条`],
['播放 / 互动读取次数（每日）',`${number(c.ytReads)}次videos.list，约${number(c.ytReads)}单位`,`${number(c.fbReads)}次Insights；每Page ${number(c.fbPerPage)}次`],
['额度判断',c.ytUploadExceeded?'超过默认上传额度，需增额或降低上传量':'上传量未超默认项目额度；频道上限、审核仍待确认',c.fbPublishExceeded?'单Page发布量超过30条限制':'单Page发布量未超30条；API/CPU实际余量仍待确认']
]}/>{c.ytReads>10000&&<p className="notice">YouTube读取已超过默认其他接口每日10,000单位；需调整跟踪范围、间隔或申请增额。</p>}<p className="small">公式：每天轮询轮数R=⌈1,440÷间隔分钟⌉；YouTube读取=N×⌈p×D÷20⌉×R；FB读取=N×p×D×R。仅计算指定指标读取，不含上传传输、状态、分页、缩略图、评论明细及重试。Facebook每条发布至少涉及初始化、上传、发布3步网络请求，各步骤限流口径另核。<Refs ids="F13,Y19"/></p></>:<p className="notice">请填写非负整数；跟踪天数至少为1，数值需在安全计算范围内。</p>}</div>
<p className="small">YouTube Analytics另算：若每频道每天1个兼容报表且无需分页，N个频道需N次查询；额外报表、分页及回补分别增加请求。<Refs ids="Y20,Y25"/></p>
</details>
<h3>发布频次与最终效果｜以同类内容实测校准</h3>
<p>内容充足时，可按上述50%额度方案进行高频测试；已有低频方案作为比较基线。按相同发布后观察窗口比较总合格观看、增粉与每条中位表现；增加条数不会自动等比例增加收益。<Refs ids="Y24"/></p>
<GridTable heads={['评估对象','计算 / 观察方式','边界']} rows={[
['账号价值','同时看周期净增粉、回访、总观看，以及每条留存和关注转化。','播放、独立触达、合格观看分别记录；收藏不能跨平台直接同口径比较。'],
['频次效果','分组或分阶段测试1／2／3条，尽量保持语言、题材、视频长度和观察窗口可比。','运营试验建议；单次比较不能证明因果，未确认更高频次更好。'],
['平台收入','FB使用合格观看及后台Earnings Rate；YouTube使用同期收入和对应观看口径。','不以公开播放数直接计算收益；未开通变现不产生该项平台分成。']
]}/>
<details className="calculator-fold"><summary>同一批内容的观看量情景｜需填入自有账号样本</summary><form onSubmit={e=>e.preventDefault()} aria-label="内容批次观看情景"><Num id="api-mean-views" label="某一平台同类视频发布后7天的平均观看量（实测）" value={meanViews} onChange={setMeanViews} hint="与上方账号数和每日发布量联动；一次仅估算一个平台。无样本时留空。"/></form><output className="gate-result" aria-live="polite">{projected!==null&&c?`未来7天计划发布${number(c.weeklyPosts)}条；待每条各自满7天时，本批累计观看参考 ${number(projected)} 次。`:'等待同平台、同题材、同观察窗口的实际样本。'}</output><p className="small">测算值=N×p×7×单条7天观看均值。是本批视频各自满7天后的合计，不是未来7个自然日流量；不含旧视频，非去重人数。假设频次变化不改变单条表现，仅作情景计算；爆款会拉高均值，需同时查看中位数。</p></details>
</Section>}
export default function Home(){
const [period,setPeriod]=useState('annual');
const [market,setMarket]=useState('1'),[views,setViews]=useState('1000000'),[customRpm,setCustomRpm]=useState(''),[enabled,setEnabled]=useState(false),[target,setTarget]=useState('1000');
const vn=nonnegative(views),rn=market==='fb'||market==='custom'?nonnegative(customRpm):rpm[Number(market)].value,tn=nonnegative(target);
const viewOK=vn!==null&&Number.isInteger(vn)&&rn!==null&&tn!==null;const vi=viewOK?viewIncome(vn,rn,enabled):null;
const [base,setBase]=useState('10000'),[rate,setRate]=useState('3'),[bonusBase,setBonusBase]=useState('10000'),[bonusRate,setBonusRate]=useState('10'),[bonusOn,setBonusOn]=useState(false),[share,setShare]=useState('100');
const bn=nonnegative(base),br=nonnegative(bonusBase),cr=Number(rate),rr=nonnegative(bonusRate),sr=nonnegative(share);
const commissionOK=bn!==null&&sr!==null&&sr<=100&&(!bonusOn||(br!==null&&br<=bn&&rr!==null&&rr>=10&&rr<=100));
const ci=commissionOK?commission(bn,cr,br??0,rr??0,bonusOn,sr):null;
const [future,setFuture]=useState('now'),[subs,setSubs]=useState('0'),[hours,setHours]=useState('0'),[shorts,setShorts]=useState('0'),[uploads,setUploads]=useState('0');
const ev=[subs,hours,shorts,uploads].map(nonnegative);const evalid=ev.every(n=>n!==null)&&[0,2,3].every(i=>Number.isInteger(ev[i]));const el=evalid?eligibility(ev[0]!,ev[1]!,ev[2]!,ev[3]!,future==='future'):null;
const [done,setDone]=useState<boolean[]>(checks.map(()=>false));const [sourceFilter,setSourceFilter]=useState('core');
return <main className="report">
<header><div className="topline"><span className="eyebrow">SOCIALGROWTH / 专题研究报告</span><span className="date">报告日期 2026.09.11</span></div><h1>账号成长与创作者收益</h1><p className="subtitle">Facebook Reels × YouTube · 东南亚账号运营与平台变现</p><div className="intro">研究范围：东南亚账号成长与平台收益｜附录：美国电商合作</div></header>
<nav aria-label="报告目录"><a href="#reels">FB Reels 专项</a><a href="#eligibility">平台准入</a><a href="#income">收入数据</a><a href="#calculator">收益测算</a><a href="#launch">起号与达标</a><a href="#api">发布与采集</a><a href="#commerce">附加价值</a><a href="#sources">来源索引</a></nav>
<div className="summary-grid"><div><span className="tag official">YouTube YPP</span><strong>1,000 订阅者</strong><p>＋近90天1,000万Shorts观看，或近12个月4,000小时；需审核。<Refs ids="Y1"/></p></div><div><span className="tag official">Facebook Reels</span><strong>邀请制</strong><p>Content Monetization；未公布统一粉丝或观看门槛。<Refs ids="F1"/></p></div><div><span className="tag pending">收入基准</span><strong>分层均值未公开</strong><p>可引用跨平台收入分布；不能替代两平台的纯播放收益。</p></div></div>
<div className="evidence-legend" aria-label="证据标记"><span className="tag official">官方依据</span><span className="tag sample">样本参考</span><span className="tag formula">测算值</span><span className="tag pending">待核验</span><span className="tag missing">数据未公开</span><small>统计截至2026-09-11；金额默认USD；收入为税费前口径，不含制作成本。</small></div>
<ReelsResearch/>
<Section id="eligibility" n="02" title="平台准入与收益规则">
<GridTable heads={['项目','数字或入口门槛','能获得什么','附加条件 / 来源']} rows={[
['YouTube扩展YPP','500订阅＋90天3次公开上传；另满足3,000小时/12个月或300万Shorts/90天','适用的粉丝付费、Shopping功能；不是完整广告分成',<>需地区及各功能资格。<Refs ids="Y2,Y7"/></>],
['YouTube完整广告 · 当前','1,000订阅＋4,000小时/12个月或1,000万Shorts/90天','审核通过、接受模块后，获得相应广告收益',<>Shorts保留分配池45%；不等于总广告营收45%。<Refs ids="Y1,Y4"/></>],
[<span className="future-title" key="future">YouTube完整广告 <span className="tag future">待生效</span><small>2027-02-01起</small></span>,'新申请：1,000订阅＋8,000小时/365天或2,000万Shorts/90天','已在YPP者资格不因新入门门槛直接受影响',<>Shorts池收益需近90天维持1,000万合格观看；2027-01-31前接受新条款。<Refs ids="Y3"/></>],
['Facebook Content Monetization','邀请制；专业面板可提交意向','按合格内容表现支付；无公开统一RPM',<>没有“达到固定粉丝数必开通”的公开承诺。<Refs ids="F1"/></>],
['Facebook Fast Track','外平台≥10万粉丝对应$1,000/月档；>100万对应$3,000/月档','有条件的3个月保证报酬及合格Reels触达支持',<><span className="tag pending">待核验</span> 地区与完整条款；限时奖励，非长期均值。<Refs ids="F1"/></>]
]}/>
<div className="compact-note"><b>地区</b> 印尼、菲律宾、泰国、越南、马来西亚、新加坡支持扩展YPP。<br/><b>通用条件</b> 政策合规、两步验证、高级功能、AdSense与频道审核；Shorts Feed时长及广告推广观看不计对应准入指标。<Refs ids="Y1,Y2"/></div>
<details><summary>YPP数字门槛自查</summary><form onSubmit={e=>e.preventDefault()}><Choice id="rule-time" label="规则时点" value={future} onChange={setFuture} items={[{value:'now',label:'当前（截至2026-09-11）'},{value:'future',label:'2027-02-01起已公布规则'}]}/><div className="form-grid four"><Num id="subs" label="订阅者" value={subs} onChange={setSubs} step="1"/><Num id="hours" label="近12个月/365天合格小时" value={hours} onChange={setHours}/><Num id="shorts" label="近90天合格Shorts观看" value={shorts} onChange={setShorts} step="1"/><Num id="uploads" label="近90天有效公开上传次数" value={uploads} onChange={setUploads} step="1"/></div></form><output className="gate-result" aria-live="polite">{el?`扩展YPP数字门槛：${el.early?'达到':'未达到'}。完整广告新申请数字门槛：${el.full?'达到':'未达到'}。${future==='future'?`Shorts持续收益观看门槛：${el.continuing?'达到':'未达到'}。`:''}`:'请填写有效非负数值；订阅、观看、上传数须为整数。'}</output><p className="small">数字达标≠获批；另需满足地区、内容、收款及审核条件。</p></details>
<GridTable heads={['收益类型','创作者分成','口径']} rows={[["Shorts","45%","分配给创作者的收益池"],["观看页广告","55%","净广告收入"],["会员 / Super Chat等","70%","适用的净收入"]]}/><p className="small">付款：通常次月7–12日计入AdSense；满足门槛、税务等条件且无暂停时，21–26日发放。<Refs ids="Y4,Y8"/></p>
<p className="small"><b>AI漫剧：</b>原创叙事、各集有实质差异、版权明确；适用时披露合成内容。批量重复及低价值模板影响变现。<Refs ids="Y5,Y6"/></p>
</Section>
<Section id="income" n="03" title="创作者收入分布与历史数据">
<div className="split"><div><p>CreatorIQ 2026｜5,095名创作者｜100国。统计上一年<strong>内容总收入区间</strong>，覆盖多平台、多收入渠道。</p><Choice id="period" label="收入区间显示" value={period} onChange={setPeriod} items={[{value:'annual',label:'年度收入'},{value:'monthly',label:'月度折算（年收入÷12）'}]}/><div className="metric-callout"><b>67%</b><span>年内容收入不足 $10,000<br/>并非每月实际收入调查</span></div><p className="small">分层为报告展示口径；占比取整合计99%；各档均值未公布。<Refs ids="C2"/></p></div><figure><figcaption>各收入区间的受访者比例 · 同一调查样本</figcaption><Bars rows={income.map(x=>({label:period==='annual'?x.annual:x.monthly,value:x.share}))} max={80}/></figure></div>
<GridTable heads={['层次','年度内容总收入','月度折算','受访者占比','该档平均数']} rows={income.map(x=>[x.label,x.annual,x.monthly,`${x.share}%`,'未公布'])}/>
<div className="subhead"><h3>近五年研究数据｜2022–2026</h3><span className="tag sample">样本不可直接同比</span></div><GridTable heads={['报告/发布时点','数据期间','样本口径','已公布结果','限制','来源']} rows={history.map(x=>[...x.slice(0,5),<Refs key={x[5]} ids={x[5]}/>])}/>
<p className="small">口径提示：月均收入、年度中位数、播放分成分别统计，不直接换用。</p>
<details><summary>平台整体付款历史</summary><GridTable heads={['平台','披露时点','统计窗口','支付总额','覆盖口径','来源']} rows={payouts.map(x=>[...x.slice(0,5),<Refs key={x[5]} ids={x[5]}/>])}/><p className="small">滚动窗口重叠，不可相加或同比；缺少同口径人数，无法计算人均。</p></details>
</Section>
<Section id="calculator" n="04" title="播放收益测算与市场参考">
<details className="calculator-fold"><summary>播放收益测算｜观看量、RPM与目标收入</summary><div className="split"><form onSubmit={e=>e.preventDefault()} aria-label="播放收益计算"><Choice id="market" label="单价来源 / 观看市场" value={market} onChange={v=>{setMarket(v);setCustomRpm('')}} items={[...rpm.map((r,i)=>({value:String(i),label:`YouTube · ${r.name}（2025样本）`})),{value:'fb',label:'Facebook · 输入后台 Earnings Rate'},{value:'custom',label:'YouTube · 输入自己的后台 RPM'}]}/>{(market==='fb'||market==='custom')&&<Num id="rpm" label="后台每千次观看收入（USD）" value={customRpm} onChange={setCustomRpm} hint="缺少后台单价时留空。"/>}<div className="form-grid"><Num id="views" label={market==='fb'?'合格观看量 Qualified Views':'与RPM一致的有效观看量'} value={views} onChange={setViews} step="1"/><Num id="target" label="目标收入（USD）" value={target} onChange={setTarget}/></div><label className="checkline"><Checkbox checked={enabled} onCheckedChange={setEnabled}/><span>已开通；观看符合计佣条件</span></label><p className="small">Shorts模块开通前的观看不追溯计佣。</p></form><div className="result-box" aria-live="polite"><span>按输入条件换算的播放收入</span><output>{vi?money(vi.payable):'待填写有效数据'}</output><p>{vi?(enabled?'测算值；以最终结算为准。':`未开通时收入为 $0；仅按该单价换算的参考额为 ${money(vi.reference)}。`):'请输入有效数值；观看量为非负整数。'}</p><div className="result-line"><span>使用单价</span><b>{rn===null?'未提供':`$${rn} / 千次`}</b></div>{rn!==null&&<small>精确单价：${rn} / 千次，不先四舍五入计算。</small>}<div className="result-line"><span>达到目标所需有效观看</span><b>{viewOK?(tn===0?'0':rn>0?number(Math.ceil(tn/rn*1000)):'单价为0，无法达成正收入目标'):'—'}</b></div><small>公式：观看 ÷ 1,000 × RPM。RPM已是创作者口径，不再乘45%。</small></div></div>
</details>
<figure><figcaption>四个观看市场的收入换算｜USD</figcaption><Bars rows={rpm.map(r=>({label:r.name,value:(vn??0)/1000*r.value,display:money((vn??0)/1000*r.value)}))} max={(vn??0)/1000*.328} unit="" color="teal"/></figure><p className="small"><span className="tag sample">AIR · 2025样本</span> 非官方定价、非AI漫剧专项；各国样本数与权重未公开。图表为参考换算。<Refs ids="R1,Y4"/></p>
<GridTable heads={['观看市场','样本RPM','100万有效观看','1,000万有效观看','1亿有效观看']} rows={rpm.map(r=>[r.name,`$${r.value}`,money(r.value*1000),money(r.value*10000),money(r.value*100000)])}/><p>数据未公开：Facebook东南亚平均RPM、东南亚AI漫剧代表性收益。<Refs ids="F1"/></p>
</Section>
<LaunchGuide/>
<ApiGuide/>
<Section id="commerce" n="07" title="附录｜电商附加收益">
<p>定位：受众与商品匹配后的附加收入。</p>
<p className="small">佣金＝合格净销售额×费率；与平台内容收入分别对账。<Refs ids="A1,A5"/></p>
<details id="commerce-appendix"><summary>费率、佣金测算与商户验收</summary>
<GridTable heads={['附加收入','计佣依据','权限与限制']} rows={[
['Amazon美国普通联盟','选定品类0%–10%；家居等常见品类3%','Associates获批、登记推广渠道及使用合格追踪链接。'],
['Amazon额外活动佣金','活动费率叠加；标准销售额与活动销售额分别核算','获准加入活动，满足商品、卖家、周期及共享预算要求。'],
['Shopee','按国家、商品与活动确定；不存在东南亚统一费率','核对当地联盟计划和结算规则，不能直接套美国费率。']
]}/><p className="small">Meta已公布Amazon/Shopee相关合作；原生标记或Ads Boost须实际获得入口，不保证流量。<Refs ids="F4,A1,A2,A3,A4,A5,A6,S1"/></p>
<div className="subhead"><h3>佣金计算表单</h3><span className="tag formula">输入值为演算示例，非经营预测</span></div><div className="split"><form onSubmit={e=>e.preventDefault()} aria-label="佣金计算"><div className="form-grid"><Num id="base" label="标准佣金合格净销售额（USD）" value={base} onChange={setBase} hint="已扣优惠、取消/退款及其他不计佣部分。"/><Choice id="category" label="美国商品类别 / 标准费率" value={rate} onChange={setRate} items={rates.map(r=>({value:String(r.rate),label:`${r.rate}% · ${r.name}`}))}/></div><label className="checkline"><Checkbox checked={bonusOn} onCheckedChange={setBonusOn}/><span>假设已加入有效额外佣金活动，并满足商品、卖家、预算及内容要求</span></label>{bonusOn&&<div className="form-grid"><Num id="bonus-base" label="其中活动合格净销售额（USD）" value={bonusBase} onChange={setBonusBase} hint="仅填写标准销售额中同时符合活动的部分。"/><Num id="bonus-rate" label="活动额外佣金率（%）" value={bonusRate} onChange={setBonusRate} max={100} hint="此表对应Affiliate+，活动配置最低10%。"/></div>}<Num id="share" label="公司佣金归属比例（%）" value={share} onChange={setShare} max={100} hint="按合同填写。"/></form><div className="result-box" aria-live="polite"><span>公司佣金收入 · 测算</span><output>{ci?money(ci.ours):'请修正输入'}</output>{ci?<><div className="result-line"><span>标准佣金</span><b>{money(ci.standard)}</b></div><div className="result-line"><span>额外佣金</span><b>{money(ci.bonus)}</b></div><div className="result-line"><span>联盟佣金合计</span><b>{money(ci.total)}</b></div><small>不含服务费；税费前收入。</small></>:<p>数值必须非负；归属比例0–100%；活动销售额不能超过标准销售额；启用Affiliate+后额外佣金率10–100%。</p>}</div></div>
{ci&&<figure><figcaption>佣金构成 · USD</figcaption><Bars rows={[{label:'标准佣金',value:ci.standard,display:money(ci.standard)},{label:'额外佣金',value:ci.bonus,display:money(ci.bonus)},{label:'公司收入',value:ci.ours,display:money(ci.ours)}]} max={Math.max(ci.total,1)} unit=""/></figure>}
<p className="small">公式：（标准销售额×标准费率＋活动销售额×额外费率）×合同归属比例；受商品、卖家、周期及共享预算限制。<Refs ids="A1,A4,A5,A6"/></p>
<details><summary>Shopee马来西亚｜资格与结算</summary><p>18+、Shopee Affiliate账户、符合要求的Facebook Page或专业档案；内容需原创、真实且不误导。商品/活动费率不同，确认且未退款订单才按规则结算；总佣金在Shopee查看。<Refs ids="S1"/></p><GridTable heads={['项目','官方规则/示例']} rows={[["服务费","2025-06-08起：已核定佣金的1%"],["费用税额","服务费另加8% SST"],["RM500示例","500 − 500×1% − 500×1%×8% = RM494.60"],["明确例外","YouTube Shopping产生的佣金不适用上述服务费"],["适用范围","马来西亚案例，不推广为整个东南亚统一佣金表"]]}/><Refs ids="S2"/></details>
<h3 id="merchant">商户准入与内容验收表单</h3>
<GridTable heads={['参与方式','商户门槛','发布运营方门槛','来源']} rows={[
['普通Amazon推广','正常销售的合格商品；主体、商品信息、素材权利可核实','公开且合格的推广渠道；Associates审核、追踪链接、收款和披露',<Refs key="a" ids="A2,A7,A8"/>],
['Creator Connections额外佣金','US广告账户（主体位于美国、中国或香港）；Brand Registry品牌代表/授权经销商；接受条款并设活动','符合网站/社交基础；Amazon Influencer Program＋Creator Stars Bronze或以上；具体权限看后台',<Refs key="b" ids="A3,A4"/>],
['Facebook原生商品标记','合作商家/商品满足对应零售商要求','需实际获得相应入口并绑定联盟账户；普通Associates获批不保证原生标记功能',<Refs key="c" ids="F4,S1"/>]
]}/><p className="small">新商户须完成身份、企业、地址、银行、税务及商品类目核验。<Refs ids="A7"/></p>
<div className="subhead"><h3>商户内容验收清单</h3><span className="check-count" aria-live="polite">已核对 {done.filter(Boolean).length} / {checks.length} 项</span></div><form onSubmit={e=>e.preventDefault()} aria-label="商户素材验收清单"><Table><TableHeader><TableRow>{['确认','核对项','商户交付材料','运营审核要点','依据'].map(h=><TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{checks.map((c,i)=><TableRow key={c.title}><TableCell><Checkbox aria-label={`已核对：${c.title}`} checked={done[i]} onCheckedChange={v=>setDone(done.map((d,j)=>j===i?v:d))}/></TableCell><TableCell>{c.title}</TableCell><TableCell>{c.need}</TableCell><TableCell>{c.action}</TableCell><TableCell><Refs ids={c.refs}/></TableCell></TableRow>)}</TableBody></Table></form><p className="small">内部验收记录，非平台审批；刷新重置。</p><p className="small"><b>内容要求：</b>授权、广告披露与原创审核分别满足；原样代发及小幅编辑不自动取得原创收益资格。<Refs ids="F3,Y5,A2,P1"/></p>
</details>
</Section>
<Section id="sources" n="08" title="资料来源与适用范围">
<div className="source-head"><p>统计日快照。官方资料、样本研究及受限入口分别标记；动态政策以平台最新条款为准。</p><Choice id="source-type" label="来源类别" value={sourceFilter} onChange={setSourceFilter} items={[{value:'core',label:'账号与平台收益（默认）'},{value:'all',label:`全部 ${sources.length} 条`},{value:'官方',label:'官方规则与公告'},{value:'原始调查',label:'第三方原始调查'},{value:'机构样本',label:'第三方机构样本'}]}/></div><GridTable heads={['编号','来源/链接','性质','发布日期/有效时间','要点 / 限制']} rows={sources.filter(s=>sourceFilter==='core'?!/^(A|S|P)/.test(s.id):sourceFilter==='all'||s.kind===sourceFilter).sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})).map(s=>[s.id,<a href={s.url} target="_blank" rel="noreferrer" key={s.id}>{s.title} ↗<small>{s.publisher}</small></a>,<span className={`tag ${s.id==='F9'?'pending':s.kind==='官方'?'official':'sample'}`} key="kind">{s.id==='F9'?'待核验入口':s.kind}</span>,s.date,s.note])}/>
</Section>
<footer><span>SOCIALGROWTH · 创作者经济专题 · 2026.09</span><span>金额默认USD · 收入不等于利润 · 不计视频制作成本</span></footer>
</main>}
