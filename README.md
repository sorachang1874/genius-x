# Genius X

> **AI Native 一代,不漏下我们的孩子。**
> 面向 4-10 岁孩子的 AI 启蒙:**一门 AI 语言,一个 AI 伙伴——解封每个孩子心里的天才。**
> 用 AI 创造、表达、交流,而不是学 AI 原理。

孩子在第一节课上亲手"孕育"出一个专属 AI 朋友——有名字、有性格、有来历;之后的
每一课、每一次创作,都是这个角色与孩子**共同成长**的过程。课程负责获客与信任,
**伙伴(应用 → 硬件 → 实体 IP 生态)负责长期陪伴**。对标:多邻国 × Character.ai × 泡泡玛特。

---

## 当前状态(2026-06-12)

| 维度 | 状态 |
| --- | --- |
| **阶段** | MVP + Phases 1-6 完成;Phase 6.5(应用整合)4/6 步;Phase 7(真实供应商/富媒体)待外部资源 |
| **质量** | **453 项自动化测试全绿** · 16 份冻结契约 · 9 个数据迁移(真实 PostgreSQL 16 验证)· 约 30 个 PR 全部经多智能体对抗评审 |
| **运行形态** | 全链路跑在**确定性模拟引擎**上(无真实 AI 接口);供应商适配层为唯一换装点——真实 API 到位即点亮,业务代码零改动 |
| **已能体验** | 完整第一课(学生/助教/教师三角色实时课堂)→ 伙伴诞生与跨课记忆 → 家长分享链接/成长时间线/捎话 → 课后乐园(作品上墙/伙伴日记/盖被子仪式) |
| **等待外部** | 品牌设计文档 · 体验课大纲 · 腾讯云/服务号账号 · 小程序资质 |

📈 进度细节:[`PROGRESS.md`](PROGRESS.md) · 📊 最新汇报:[`docs/reports/`](docs/reports/) · 📋 最新 PRD:[`docs/product/genius-x-app-prd-draft.md`](docs/product/genius-x-app-prd-draft.md)

## 三条产品硬底线(一切决策的过滤器)

1. **浸泡式,不教学式** —— 没有题目、没有考试、没有失败态
2. **用 AI,不学 AI** —— 儿童界面零 "AI / Prompt / 模型" 字样(CI 强制扫描);它是朋友
3. **孩子永远不可见错误** —— 任何故障切换温暖兜底,且每次降级运营侧可计数

## 文档导航

| 想了解 | 看这里 |
| --- | --- |
| 产品是什么、为什么 | [`docs/product/genius-x-manifesto.md`](docs/product/genius-x-manifesto.md)(宣言)→ [`ip-character-concept-decisions.md`](docs/product/ip-character-concept-decisions.md)(创始人决策总账) |
| 最新产品蓝图 | [`docs/product/genius-x-app-prd-draft.md`](docs/product/genius-x-app-prd-draft.md)(APP PRD:朋友的家/四角色/乐园/自治阶梯) |
| 做到哪了 | [`PROGRESS.md`](PROGRESS.md)(总账)· [`docs/reports/`](docs/reports/)(汇报材料,含 PPT) |
| 工程怎么做的 | [`docs/contracts/README.md`](docs/contracts/README.md)(**16 份冻结契约** = 团队共享记忆)· [`docs/architecture/`](docs/architecture/) |
| 技术欠债与触发条件 | [`docs/DEFERRED.md`](docs/DEFERRED.md)(28+ 项,全部显式记录,零隐性欠债) |
| 全部文档地图 | [`docs/README.md`](docs/README.md) |

## 5 分钟本地跑通第一课

```bash
pnpm install
docker compose up -d postgres                 # 身份/工作区持久化(必需)
pnpm --filter @genius-x/server migrate:seed   # 迁移 + 演示数据(ALLOW_SEED=1)
./demo-start.sh                               # 启动 server + web,打印学生报名链接

# 浏览器打开:
#   助教控制面: http://localhost:5173/?role=assistant
#   学生端:     使用 demo-start.sh 打印的报名链接(?studentId=…)
#   教师投影:   http://localhost:5173/?role=teacher
```

详细演示步骤:[`docs/demo-live-guide.md`](docs/demo-live-guide.md)。
常用命令:`pnpm typecheck` · `pnpm test` · `pnpm build`。

## 仓库结构

```
apps/web/        前端(一个应用多扇门:课堂 / 助教 / 教师投影 / 家长H5 / 课后乐园 + 主题令牌)
apps/server/     服务端(课堂状态机+WS · 身份 · 工作区 · Agent记忆 · IP形象实体 · 家长面 · 乐园)
  migrations/    数据迁移 001-009(校验和日志,真实 PG16 双跑验证)
packages/
  contracts/     共享语义唯一来源(类型 / schema / 事件 / 错误码 / 主题令牌)
  ai-gateway/    全系统唯一 AI 入口(审查→预算→供应商接缝→审查→兜底→审计)
  course-config/ 课程与工具注册表(git 版本化,启动校验)
docs/            文档(地图见 docs/README.md;历史归档在 docs/archive/)
```

## 工程方法(为什么一个创始人 + AI 智能体能交付这些)

- **契约先行**:每个共享数据先冻结契约(所有者/来源/失败模式/漂移预检)再写代码——
  文档就是团队的共享记忆
- **多智能体对抗评审**:每个功能合并前由独立 AI 评审员交叉攻击 + 质疑确认,累计拦截
  4 个致命 + 28+ 个重要缺陷,全部修复后才放行;CI 绿 + 人工合并,永不自动合主干
- **降级原则**:对孩子隐形的兜底必须对运营可见——封闭监控事件词表,运行时事件集 ⊆
  契约声明集由 CI 断言

> 🤖 AI 编码智能体请先读 [`AGENTS.md`](AGENTS.md)(硬规则/所有权地图/协作协议)。

---

_Genius X · 详细文档地图见 [`docs/README.md`](docs/README.md)_
