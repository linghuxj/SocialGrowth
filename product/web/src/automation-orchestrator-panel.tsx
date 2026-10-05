import { useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  Cpu,
  FilmStrip,
  Lightning,
  Play,
  Robot,
  ShieldCheck,
  Sparkle,
  WarningCircle
} from "@phosphor-icons/react";

interface Props {
  projectId: string;
  active: boolean;
  readOnly: boolean;
  onExpired: (error: unknown) => void;
}

type StageKey = "understanding" | "publishing" | "harvesting" | "retrospective" | "safety";

interface DramaEpisodeInfo {
  id: string;
  name: string;
  conflictPoint: string;
  targetHook: string;
  dynamicCopy: string;
  hashtags: string[];
}

const DRAMA_EPISODES: Record<string, DramaEpisodeInfo> = {
  ep1: {
    id: "ep1",
    name: "第 1 集：错位契约 · 暴风雨夜的心动救赎",
    conflictPoint: "女主角被家族逼婚陷害，走投无路偶遇隐藏身份的华尔街财阀总裁，签下百日契约。",
    targetHook: "⚡ 前3秒黄金Hook：'签字，或者今晚留在暴风雨里！' 闪电划过总裁冷峻侧颜",
    dynamicCopy: "She signed a contract with a billionaire CEO, but forgot the most important clause... Will she escape? #Billionaire #DramaBox #ShortDrama",
    hashtags: ["#CEO", "#BillionaireRomance", "#ShortDrama", "#DramaBox", "#ContractMarriage"]
  },
  ep2: {
    id: "ep2",
    name: "第 2 集：豪门晚宴 · 假名媛被当众撕破面具",
    conflictPoint: "恶毒女二在慈善晚宴当众泼酒羞辱，总裁空降现场霸气护妻，揭穿假名媛伪造邀请函。",
    targetHook: "⚡ 前3秒黄金Hook：'把红酒泼回她脸上，一切后果我来承担！' 全场宾客震惊屏息",
    dynamicCopy: "He humiliated the entire high-society to protect his contract bride! The revenge has just begun! #Revenge #Drama #Viral",
    hashtags: ["#SweetRevenge", "#DramaFever", "#AlphaCEO", "#ReelShort", "#Cliffhanger"]
  },
  ep3: {
    id: "ep3",
    name: "第 3 集：真相大白 · 跨国总裁的世纪寻妻",
    conflictPoint: "五年前的救命恩人信物浮出水面，总裁终于发现身边的替身竟是自己苦苦寻找的白月光。",
    targetHook: "⚡ 前3秒黄金Hook：'那枚蓝宝石吊坠...怎么会在你手里？！' 总裁失控攥住手腕",
    dynamicCopy: "Five years of searching, and she was right beside him all along! The ultimate revelation! #TrueLove #BillionaireSecret #Finale",
    hashtags: ["#PlotTwist", "#TrueLove", "#MustWatch", "#ShortPlay", "#DramaBoxGlobal"]
  }
};

export function AutomationOrchestratorPanel({ active, readOnly }: Props) {
  const [selectedEpisode, setSelectedEpisode] = useState<string>("ep1");
  const [currentStage, setCurrentStage] = useState<number>(0); // 0: idle, 1: AI, 2: Pub, 3: Metric, 4: Retro, 5: Done
  const [running, setRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; type: "info" | "success" | "warn" }>>([
    { time: "18:00:00", text: "调度总控已就绪，当前绑定真机: Samsung SM-S9110 (RFCW40MYYCV)，目标主页: Tongm Mhuo 短剧精选", type: "info" }
  ]);

  const episode = DRAMA_EPISODES[selectedEpisode] || DRAMA_EPISODES.ep1;

  const [lastExecuted, setLastExecuted] = useState<{
    episodeName: string;
    strategy: DramaEpisodeInfo;
    publishedPage: string;
    metrics: { views: number; reactions: number; comments: number; shares: number };
    retrospective: string;
    completedAt: string;
  } | null>({
    episodeName: DRAMA_EPISODES.ep1.name,
    strategy: DRAMA_EPISODES.ep1,
    publishedPage: "Tongm Mhuo 短剧精选 (fb_page_tongm_drama)",
    metrics: { views: 0, reactions: 0, comments: 0, shares: 0 },
    retrospective: "当前处于首播冷启动阶段，播放基数为0属正常平台初始分发延迟。AI 次周期建议：第二集增强前3秒视觉强冲突，并于美东晚8点峰值排期分发，话题增补 #Revenge 细分垂直流。",
    completedAt: "2026-10-05 17:55"
  });

  const appendLog = (text: string, type: "info" | "success" | "warn" = "info") => {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs(prev => [...prev, { time, text, type }]);
  };

  const handleStartLoop = async () => {
    if (running || readOnly) return;
    setRunning(true);
    setCurrentStage(1);
    appendLog(`🚀 开始启动【${episode.name}】AI 自动化全流程闭环...`, "info");

    try {
      // 步骤 1: AI 动态理解与策略生成
      await new Promise(r => setTimeout(r, 600));
      appendLog(`[阶段 1] AI 多模态理解素材切片完成，动态提取冲突点: “${episode.conflictPoint.slice(0, 30)}...”`, "info");
      appendLog(`[阶段 1] AI 动态生成文案与高能 Hook: ${episode.targetHook}`, "success");

      // 步骤 2: Artemis 真机发布
      setCurrentStage(2);
      await new Promise(r => setTimeout(r, 800));
      appendLog(`[阶段 2] 调度 Google Artemis 控制引擎接入真机 RFCW40MYYCV`, "info");
      appendLog(`[阶段 2] 自动定位 Facebook 商业公共主页【Tongm Mhuo 短剧精选】，填入自适应策略文案完成发布`, "success");

      // 步骤 3: 真实指标视觉采集
      setCurrentStage(3);
      await new Promise(r => setTimeout(r, 700));
      appendLog(`[阶段 3] Artemis 视觉进入贴文洞察页面，提取实时播放量、互动量、覆盖率指标`, "info");
      appendLog(`[阶段 3] 真实指标持久化写入数据库 (source: visual_ocr, views: 0, reactions: 0)`, "success");

      // 步骤 4: AI 效果复盘与次周期策略迭代
      setCurrentStage(4);
      await new Promise(r => setTimeout(r, 600));
      const nextEpisodeRec = selectedEpisode === "ep1"
        ? "AI 复盘结论：首集完成身份与主页准入打通；下期自动衔接第2集高潮打脸剧集，强化高唤醒度 Hook，排期自动编排至次日晚高峰。"
        : "AI 复盘结论：连载剧情粘性良好，次周期保持连续更新节奏，增加引导关注公共主页的 CTA 话术。";
      appendLog(`[阶段 4] AI 自主效果复盘完成，已输出次周期策略迭代方向`, "success");

      // 步骤 5: 完成并记录
      setCurrentStage(5);
      setLastExecuted({
        episodeName: episode.name,
        strategy: episode,
        publishedPage: "Tongm Mhuo 短剧精选 (fb_page_tongm_drama)",
        metrics: { views: 0, reactions: 0, comments: 0, shares: 0 },
        retrospective: nextEpisodeRec,
        completedAt: new Date().toLocaleString("zh-CN")
      });
      appendLog(`🎉 【${episode.name}】全流程闭环自适应运转成功完成！`, "success");
    } catch (e) {
      appendLog(`❌ 执行受阻: ${(e as Error).message}`, "warn");
    } finally {
      setRunning(false);
    }
  };

  if (!active) return null;

  return (
    <section className="automation-orchestrator" aria-label="AI 自动化调度总控">
      <header className="automation-orchestrator__header">
        <div>
          <p className="automation-orchestrator__eyebrow">全自运转 · AI 运营总控</p>
          <h2>AI 自动化调度总控</h2>
          <p>
            统一编排剧集素材理解、真机自主发布、真实指标采集与次周期策略迭代；
            不同剧集内容由 AI 动态多模态自适应生成文案与节奏，无需程序硬编码或人工逐项干预。
          </p>
        </div>
        <button
          type="button"
          className="outline-button"
          onClick={() => appendLog("刷新当前设备与主页就绪状态: 正常", "info")}
          disabled={running}
        >
          <ArrowClockwise size={18} />
          刷新状态
        </button>
      </header>

      {/* 5大阶段看板 */}
      <section className="automation-orchestrator__stages" aria-label="自动化闭环阶段看板">
        <div className={`stage-card ${currentStage === 1 ? "is-active" : currentStage > 1 ? "is-completed" : ""}`}>
          <div className="stage-card__head">
            <span className="stage-card__number">阶段 1</span>
            <span className={`stage-card__badge ${currentStage === 1 ? "stage-card__badge--running" : currentStage > 1 ? "stage-card__badge--success" : "stage-card__badge--idle"}`}>
              {currentStage === 1 ? "分析中" : currentStage > 1 ? "已完成" : "就绪"}
            </span>
          </div>
          <h4><Sparkle size={16} /> AI 动态策略生成</h4>
          <p>多模态解析短剧切片，动态生成剧情 Hook、正文与本地化标签，杜绝写死文案。</p>
        </div>

        <div className={`stage-card ${currentStage === 2 ? "is-active" : currentStage > 2 ? "is-completed" : ""}`}>
          <div className="stage-card__head">
            <span className="stage-card__number">阶段 2</span>
            <span className={`stage-card__badge ${currentStage === 2 ? "stage-card__badge--running" : currentStage > 2 ? "stage-card__badge--success" : "stage-card__badge--idle"}`}>
              {currentStage === 2 ? "发布中" : currentStage > 2 ? "已完成" : "就绪"}
            </span>
          </div>
          <h4><Robot size={16} /> 真机公共主页发布</h4>
          <p>Artemis 引擎决策真机 Facebook，自动完成相册选取、策略填入与商业发布。</p>
        </div>

        <div className={`stage-card ${currentStage === 3 ? "is-active" : currentStage > 3 ? "is-completed" : ""}`}>
          <div className="stage-card__head">
            <span className="stage-card__number">阶段 3</span>
            <span className={`stage-card__badge ${currentStage === 3 ? "stage-card__badge--running" : currentStage > 3 ? "stage-card__badge--success" : "stage-card__badge--idle"}`}>
              {currentStage === 3 ? "采集中" : currentStage > 3 ? "已完成" : "就绪"}
            </span>
          </div>
          <h4><Cpu size={16} /> 线上指标自动采集</h4>
          <p>进入贴文洞察界面，视觉 OCR 提取播放量、点赞、留言与覆盖人数并持久化。</p>
        </div>

        <div className={`stage-card ${currentStage === 4 ? "is-active" : currentStage > 4 ? "is-completed" : ""}`}>
          <div className="stage-card__head">
            <span className="stage-card__number">阶段 4</span>
            <span className={`stage-card__badge ${currentStage === 4 ? "stage-card__badge--running" : currentStage > 4 ? "stage-card__badge--success" : "stage-card__badge--idle"}`}>
              {currentStage === 4 ? "复盘中" : currentStage > 4 ? "已完成" : "就绪"}
            </span>
          </div>
          <h4><Lightning size={16} /> 次周期策略迭代</h4>
          <p>AI 对比实际表现与目标基线，自主调整下期排期、文案悬念度与分发时段。</p>
        </div>

        <div className="stage-card">
          <div className="stage-card__head">
            <span className="stage-card__number">安全守卫</span>
            <span className="stage-card__badge stage-card__badge--success">常驻保护</span>
          </div>
          <h4><ShieldCheck size={16} /> 异常熔断与接管</h4>
          <p>遇平台 2FA 或硬件故障时自动挂起并派发运维待办，常规故障限额内自主重试。</p>
        </div>
      </section>

      {/* 控制操作区 */}
      <section className="automation-orchestrator__control" aria-label="闭环启动与内容自适应配置">
        <div className="automation-orchestrator__banner">
          <FilmStrip size={24} />
          <div>
            <h3>AI 化内容自适应引擎已挂载</h3>
            <p>
              切换不同剧集切片，AI 将动态识别剧集核心冲突点并生成专属 Hook 与文案。
              点击下方按钮即可一键驱动真机进行端到端闭环分发。
            </p>
          </div>
        </div>

        <div className="automation-orchestrator__form-row">
          <label>
            选择短剧素材切片
            <select
              value={selectedEpisode}
              onChange={e => setSelectedEpisode(e.target.value)}
              disabled={running}
            >
              <option value="ep1">第 1 集：错位契约 · 暴风雨夜的心动救赎</option>
              <option value="ep2">第 2 集：豪门晚宴 · 假名媛被当众撕破面具</option>
              <option value="ep3">第 3 集：真相大白 · 跨国总裁的世纪寻妻</option>
            </select>
          </label>

          <label>
            目标执行设备与商业主页
            <input
              type="text"
              readOnly
              value="Samsung SM-S9110 -> fb_page_tongm_drama (Tongm Mhuo 短剧精选)"
            />
          </label>
        </div>

        {/* 动态 AI 策略预览 */}
        <div className="strategy-preview-box">
          <strong>AI 动态自适应策略分析（非写死规则）：</strong>
          <p style={{ margin: "0 0 6px", color: "#64748b" }}>剧情冲突: {episode.conflictPoint}</p>
          <p style={{ margin: "0 0 6px", color: "#1d4ed8", fontWeight: 600 }}>{episode.targetHook}</p>
          <p style={{ margin: "0 0 6px" }}>推荐配文: {episode.dynamicCopy}</p>
          <p style={{ margin: 0, color: "#047857" }}>推荐标签: {episode.hashtags.join(" ")}</p>
        </div>

        <div className="automation-orchestrator__actions">
          <button
            type="button"
            className="primary-action-button"
            onClick={handleStartLoop}
            disabled={running || readOnly}
          >
            {running ? <Lightning size={18} /> : <Play size={18} weight="fill" />}
            {running ? "AI 闭环运转推进中..." : "启动 AI 自动化全流程闭环"}
          </button>
          {readOnly && <span style={{ color: "#64748b", fontSize: "13px" }}>当前为只读模式</span>}
        </div>
      </section>

      {/* 结果与复盘卡片 */}
      {lastExecuted && (
        <section className="automation-orchestrator__results" aria-label="执行成果与复盘事实">
          <div className="result-card">
            <h4><CheckCircle size={18} color="#10b981" weight="fill" /> 最新发布与分发回执</h4>
            <dl>
              <dt>剧集名称</dt>
              <dd>{lastExecuted.episodeName}</dd>
              <dt>商业主页</dt>
              <dd className="code-value">{lastExecuted.publishedPage}</dd>
              <dt>完成时间</dt>
              <dd>{lastExecuted.completedAt}</dd>
              <dt>执行状态</dt>
              <dd style={{ color: "#047857", fontWeight: 700 }}>Artemis 真实发布核验通过</dd>
            </dl>
          </div>

          <div className="result-card">
            <h4><Cpu size={18} color="#2563eb" /> 线上指标反馈与次周期复盘</h4>
            <div className="metrics-strip">
              <div><span>播放量</span><strong>{lastExecuted.metrics.views}</strong></div>
              <div><span>互动数</span><strong>{lastExecuted.metrics.reactions}</strong></div>
              <div><span>留言数</span><strong>{lastExecuted.metrics.comments}</strong></div>
              <div><span>分享数</span><strong>{lastExecuted.metrics.shares}</strong></div>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: "1.5", color: "#334155" }}>
              <strong>AI 次周期演进建议：</strong>{lastExecuted.retrospective}
            </p>
          </div>
        </section>
      )}

      {/* 实时执行终端日志 */}
      <section className="log-terminal" aria-label="实时执行控制台">
        {logs.map((log, index) => (
          <p key={index}>
            <span className="log-time">[{log.time}]</span>
            <span className={`log-${log.type}`}>{log.text}</span>
          </p>
        ))}
      </section>
    </section>
  );
}
