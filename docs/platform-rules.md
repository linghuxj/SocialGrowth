# 平台规则核查记录

核查日期：2026-09-08。本文是业务规划阶段的有限核查，不是完整平台规则清单，也不是账号或自动化执行资格的验证结果。

## Facebook

Meta 在 2026 年 3 月的官方说明中表示，Facebook 优先分发原创内容，并降低非原创内容的分发。对他人内容仅做加边框、加字幕、变速等低价值改动，可能被认定为非原创；持续以非原创内容为主还可能影响账号推荐资格。

来源：[Rewarding Original Creators on Facebook](https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/)。

对本项目的含义（分析）：需要结合甲方内容来源、创作主体和实质性加工评估素材策略，不能把“批量改字幕或变速”当作获得推荐的充分条件。内容使用授权与推荐资格需分别核实。

## YouTube

YouTube 官方链接说明明确：Shorts 描述与评论中的网址不可点击；频道个人资料链接属于可点击入口。长视频的可点击外链涉及高级功能权限，不能套用到所有新账号。

来源：[Sharing links with your audiences](https://support.google.com/youtube/answer/13748639?hl=en)。

对本项目的含义（分析）：Shorts 导流需设计适用的入口，不能假设把短链放入描述或评论即可直接点击。若使用共用频道入口，统计精度按实际可识别的来源确定。

YouTube 的垃圾内容政策还覆盖重复性评论推广、虚假互动及自动化大量发布相似内容等行为。

来源：[Spam Policy](https://support.google.com/youtube/answer/2801973?hl=en-EN)；本次取得该官方页面的搜索索引正文，另一语言参数的直接访问返回限流，正式接入前需再次核查。

对本项目的含义（分析）：自动评论应先明确真实业务场景和触发依据；起号策略不能以互刷指标或重复铺量作为效果验证依据。

## Instagram

本次官方帮助页请求受到限流，未取得足够正文。不将 Facebook 的具体规则直接认定为 Instagram 的同等规则。

注：Instagram 的差异化处理规范（包含 Professional Account 创作者/商务账号转换、必须关联 Facebook Page、Reels/Feed 文案外链不可点击、Bio 主页链接导流路径、第三方数据服务双轨兜底采集及单台真机 1:1 专属绑定账号约束，封号后冷备换号）已在 [SocialGrowth 核心交付模块与内容规格规划书](delivery-specification.md) 第二节及对应模块中完整确立与落实。

## 共同待核实与对齐事项

- 各平台实际账号类型、功能资格与可使用的数据指标（已在 delivery-specification.md 模块 7 对照表中系统性梳理）。
- 发布、读取数据、评论等操作的官方接入条件及 Google Artemis 设备执行方式的许可边界（详见 delivery-specification.md 模块 6）。
- 内容生成与加工涉及的标识、来源要求（前 3 个月交付严格聚焦已有成品切片，排除视频生成）。
- 新账号阶段没有经本次核查证实的统一养号时长或保证增权操作，初始节奏作为待验证策略在模块 3 经验规则库中记录并分批验证。
