# Genius X

> **AI Native 一代，不漏下我们的孩子。**
> 面向 4-10 岁孩子的 AI 启蒙 —— 用 AI 创造、表达、交流，而不是学 AI 原理。

**项目状态**: M3 完成，Demo 就绪 ✅

This is the Genius X monorepo. Read the product soul first:
[`docs/product/genius-x-manifesto.md`](docs/product/genius-x-manifesto.md).

## Three hard product lines (every decision passes these)

1. **浸泡式，不教学式** — immersive, not instructional. No quiz/test logic.
2. **用 AI，不学 AI** — no "Prompt / LLM / token / AI" wording on screen.
3. **无失败状态** — every input gets a positive output. No visible failure state for the child.

---

## 🚀 Quick start for Demo

**最快 5 分钟体验完整课堂流程：**

```bash
# One-command start (server + web app)
./demo-start.sh

# Then open in browser:
# • Assistant: http://localhost:5173/?role=assistant
# • Student:   http://localhost:5173/
```

📖 **完整演示指南:** [`docs/demo-live-guide.md`](docs/demo-live-guide.md) — 真实互动（Canvas 涂鸦、麦克风录音）、多学生测试、手机访问

🎯 **汇报材料:** [`docs/presentation.md`](docs/presentation.md) — 技术架构 + 产品理念 + 开发计划

🧪 **自动化测试:**
```bash
node tools/demo-e2e-test.mjs              # Single student end-to-end
node tools/demo-e2e-multi-student.mjs     # Multi-student concurrent
```

⚠️ **WSL2 + Windows 用户:** 查看 [`docs/demo-quickstart.md`](docs/demo-quickstart.md)（端口转发 + VPN 分流配置）

---

## Repository map

```
apps/
  web/         React PWA — student + assistant (one app, role-separated internally)
  server/      Course state machine + WebSocket classroom sync + API
packages/
  contracts/   ⭐ single source of truth: schemas, API/WS types, AI response shapes, enums, errors
  ai-gateway/  the only entry point for AI calls (safety, budget, routing, fallback, audit)
  course-config/ lesson JSON configs + validation (new lessons = data, not code)
tools/         🐍 Python offline layer (.venv): prompt eval, content analysis, safety experiments
docs/
  product/     manifesto, MVP PRD, lesson-1 rundown, 16-lesson course design
  contracts/   prose contracts (owner matrices, allowed values, deletion conditions)
  architecture/ architecture overview
  demo-*.md    Demo 演示指南、快速启动、测试日志
  presentation.md  汇报材料（技术 + 产品）
  known-issues.md  已知问题和优化点
  migration-*.md   WSL2 → Mac 迁移计划
```

---

## Stack

- **Main app:** Node 22 / TypeScript (unified pipeline). pnpm workspaces.
- **Offline tools:** Python 3.12 in `tools/.venv` (decoupled from the main pipeline).

---

## Getting started (development)

```sh
corepack enable pnpm     # pnpm via Node corepack
pnpm install             # install the TS workspace

# Manual start (separate terminals)
cd apps/server && pnpm dev    # Terminal 1: Backend server
cd apps/web && pnpm dev        # Terminal 2: Frontend app

# Python tools (offline layer)
cd tools && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
```

**验证安装:**
```bash
pnpm typecheck    # TypeScript 编译检查
pnpm test         # 运行所有单元测试（ai-gateway + server + web）
```

---

## Engineering operating docs

- [`AGENTS.md`](AGENTS.md) — rules for AI coding agents working here (read before changing files).
- [`PROGRESS.md`](PROGRESS.md) — current state, milestone status, and handoff notes.
- [`docs/presentation.md`](docs/presentation.md) — 项目汇报材料（技术架构、已实现功能、开发计划）
- [`docs/known-issues.md`](docs/known-issues.md) — 已知问题和优化点（P2 优先级）

This project follows the
[ai-assisted-engineering-playbook](https://github.com/sorachang1874/ai-assisted-engineering-playbook)
(contracts-first, no hidden fallback, short feedback before long, environment isolation).

---

## 🎯 当前里程碑

✅ **M1-M2**: 状态机 + AI Gateway + 合约 v1.3  
✅ **M3**: 前端完整实现（6 个 Stage + 多端协作）  
✅ **M4**: 才艺/生日/投影 + 助教注册 + 强制推进  
⏳ **M5**: 家长反馈系统（课后报告、证书导出）  
🔮 **M6**: 真实 AI 服务集成（LLM/TTS/图像生成）  

详见 [`PROGRESS.md`](PROGRESS.md) 和 [`docs/presentation.md`](docs/presentation.md)

---

## 📚 关键文档导航

**产品理念:**
- [产品宣言](docs/product/genius-x-manifesto.md) — 设计哲学和核心原则
- [MVP PRD](docs/product/genius-x-mvp-prd.md) — 产品需求文档
- [第一课流程](docs/product/genius-x-lesson1-rundown.md) — 诞生礼详细设计

**技术架构:**
- [汇报材料](docs/presentation.md) — 系统架构图、模块化设计、技术选型
- [合约文档](docs/contracts/) — 共享类型和消息格式
- [AI Gateway](packages/ai-gateway/README.md) — AI 调用统一入口

**开发指南:**
- [Demo 快速启动](docs/demo-quickstart.md) — 5 分钟启动指南
- [Demo 演示指南](docs/demo-live-guide.md) — 完整演示脚本
- [已知问题](docs/known-issues.md) — 待优化项（不阻塞 Demo）
- [WSL2 迁移到 Mac](docs/migration-wsl2-to-mac.md) — 环境迁移计划

---

## 联系与贡献

- **项目负责人**: sorachang
- **技术栈**: TypeScript + React + Fastify + Socket.IO + Redis
- **协作规则**: 阅读 [`AGENTS.md`](AGENTS.md) 后再修改代码

欢迎贡献！请先阅读产品理念和技术文档，确保修改符合设计原则。
