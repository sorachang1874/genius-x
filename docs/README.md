# 文档地图(Documentation Map)

> 初次到访?推荐阅读顺序:**① 产品宣言 → ② APP PRD → ③ 进度总账 → ④ 最新报告**。
> 工程细节再进契约与架构目录。

## 产品(docs/product/)

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`genius-x-manifesto.md`](product/genius-x-manifesto.md) | **产品宣言**:愿景/使命/三条硬底线 —— 一切决策的起点 | 定稿,不可动摇 |
| [`ip-character-concept-decisions.md`](product/ip-character-concept-decisions.md) | **创始人决策总账**:演进式 IP 形象锚点、决策①-⑨、D1-D6、设计原则 P1-P4 | 持续追加 |
| [`genius-x-app-prd-draft.md`](product/genius-x-app-prd-draft.md) | **APP PRD(最新)**:一个应用/朋友的家、四角色、乐园、自治阶梯、合规姿态 | 草案 v0.2,经创始人两轮评审 |
| [`genius-x-mvp-prd.md`](product/genius-x-mvp-prd.md) | MVP 需求规格(第一课课堂) | 已交付(历史规格) |
| [`genius-x-course-design.md`](product/genius-x-course-design.md) / [`genius-x-lesson1-rundown.md`](product/genius-x-lesson1-rundown.md) | 16 课大纲 / 第一课执行手册 | 定稿 |

## 进度与报告

| 文档 | 内容 |
| --- | --- |
| [`../PROGRESS.md`](../PROGRESS.md) | **进度总账**:里程碑表 + 每阶段交付记录(最权威的"做到哪了") |
| [`reports/2026-06-12-架构层进展汇报材料.md`](reports/2026-06-12-架构层进展汇报材料.md) | **最新汇报**:简版 PRD + 技术方案 + SLO + 记忆方案空间 + 乐园拉力设计 |
| [`reports/2026-06-12-架构层进展.pptx`](reports/) | 同主题幻灯片(16 页 + 讲稿) |
| [`reports/2026-06-11-进度汇报-中文版.md`](reports/2026-06-11-进度汇报-中文版.md) | 面向非工程读者的纯中文进度报告 |
| [`DEFERRED.md`](DEFERRED.md) | **延期与临时方案总账**:每个占位/影子系统/欠债都有显式的替换触发条件 |

## 工程契约(docs/contracts/)—— 团队的共享记忆

[`contracts/README.md`](contracts/README.md) 是契约索引:每个共享数据/状态/事件先有
契约再有代码,契约写明所有者、来源、失败模式与漂移预检。**读懂任何一个子系统,
从它的契约开始。** 重点:`agent-context.md`(记忆与上下文)、`tool.md`+`scene.md`
(能力沙箱与场景)、`ip-character.md`(IP 形象实体)、`agent-session.md`+`world.md`
+`theme.md`(课后乐园三件套)、`parent-share.md`+`parent-surface.md`(家长面)。

## 架构(docs/architecture/)

| 文档 | 内容 |
| --- | --- |
| [`scalable-architecture-v2.md`](architecture/scalable-architecture-v2.md) | 可扩展架构设计(2026-06-08 批准;实现进度见 PROGRESS.md) |
| [`capacity-and-latency.md`](architecture/capacity-and-latency.md) | 容量与延迟:SLO、300 并发分片、轮询 vs 事件、级联→全模态长期路线 |
| [`lesson-runtime.md`](architecture/lesson-runtime.md) / [`overview.md`](architecture/overview.md) / [`interaction-map.md`](architecture/interaction-map.md) | 课堂引擎 / 分层总览 / 交互时序(MVP 范围) |

## 其他

- [`demo-live-guide.md`](demo-live-guide.md) — 本地跑通第一课的演示指南
- [`agents/README.md`](agents/README.md) — 多智能体协作协议(任务简报/评审门/DoD)
- [`migration/`](migration/) — 已完成迁移的操作记录
- [`archive/`](archive/) — 历史归档(不再更新,见其 README)
