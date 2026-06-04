# PROGRESS

## Last updated

2026-06-04 (Post-M3 Demo)

## Current state

**M3 完成，Demo 就绪 ✅**

完整的 6-Stage 课堂流程（intro → icebreak → shape → talent → birth → closure）已跑通。
多端实时协作（学生/助教/教师）验证通过。技术架构和产品理念验证完成。

### 已完成的里程碑

- **M1** — 配置驱动的状态机 + Reducer + Zod 验证器 + Socket.IO 同步 + 原子性 SessionStore + Resume
- **E-M1** — 端到端烟雾测试（intro→closure + 断线重连）
- **M2a** — AI Gateway 核心：`llm/tts/asr/imageGen/extractMemory` 管道（输入安全 → 超时控制 → 输出验证 → 降级，永不抛异常），FakeProvider + 故障注入，审核接口（真实天御 IMS = M6）
- **M2b** — contracts-v1.3（`INTERACT`/`AI_OUTPUT`/`PROJECT`/`pending`；交互幂等、防过期、Session 锁外执行）
- **M3** — 前端完整实现（React + Vite）：
  - 学生端：6 个 Stage（Standby/Intro/Icebreak/Shape/Talent/Birth/Closure）
  - 助教端：创建课堂、查看状态、推进流程
  - 教师端：大屏投影、学生花名册
  - WebSocket 实时同步 + 断线重连（5 次重试）
  - Canvas 涂鸦、语音输入、图像选择等真实交互
- **M4a** — contracts-v1.4 + 服务器端（才艺记忆提取、生日预生成、投影验证）
- **M4b** — 前端 Talent/Birth/Closure + 教师投影屏
- **M4c** — 助教注册机制（`role=assistant` → `assistantId`）
- **M4d** — 强制推进 UI（FORCE_ADVANCE 按钮 + 确认流程）

### 测试覆盖

✅ **单元测试**:
- ai-gateway: 19/19
- server: 61/61
- web: 49/49

✅ **端到端测试**:
- 单学生流程: `tools/demo-e2e-test.mjs`
- 多学生并发: `tools/demo-e2e-multi-student.mjs`（3 学生同时加入，状态同步，推进条件验证）

✅ **环境验证**:
- WSL2 + Windows + 全局 VPN 环境下运行成功
- CORS 跨域配置正确
- 端口转发 + VPN 分流方案文档化

### 技术债务（已记录，不阻塞 Demo）

详见 `docs/known-issues.md`：
- 助教端状态显示不完整（P2）
- Advance 条件未严格触发（P2）
- 占位图片显示坏图（P2）
- Fake TTS 语音突兀（P2，M6 解决）

---

## Contracts 版本

**当前**: v1.4

关键变更：
- v1.0: 初始合约
- v1.1: `TEACHER_UNLOCK`
- v1.2: `PreparedOutput` / `AI_READY`
- v1.3: `INTERACT` / `AI_OUTPUT` / `pending`
- v1.4: `displayName` / `memories` / `PREPARE_DONE` / `PROJECTION` 授权

---

## 开发环境配置

### WSL2 + Windows + VPN（当前）

已解决的挑战：
- ✅ 跨域 CORS 配置（@fastify/cors）
- ✅ Windows 端口转发（`tools/wsl-port-forward.ps1`）
- ✅ VPN 分流配置（`docs/vpn-split-tunnel-config.md`）
- ✅ WSL2 网络配置（`docs/wsl2-setup.md`）

### Mac 迁移计划

详见 `docs/migration-wsl2-to-mac.md`：
- 环境配置：Homebrew, Node.js, pnpm
- 项目克隆和依赖安装
- 验证清单（typecheck, test, 启动服务）
- 预计时间：45-85 分钟

---

## 文档状态

### 产品文档
- ✅ `docs/product/genius-x-manifesto.md` — 产品理念
- ✅ `docs/product/genius-x-mvp-prd.md` — MVP 需求文档
- ✅ `docs/product/genius-x-lesson1-rundown.md` — 第一课流程

### 技术文档
- ✅ `AGENTS.md` — AI Agent 协作规则
- ✅ `docs/contracts/` — 合约文档（完整更新）
- ✅ `docs/demo-live-guide.md` — Demo 演示指南
- ✅ `docs/demo-quickstart.md` — 5 分钟快速启动
- ✅ `docs/known-issues.md` — 已知问题和优化点
- ✅ `docs/presentation.md` — 汇报材料（技术 + 产品）
- ✅ `docs/migration-wsl2-to-mac.md` — 迁移计划

### 网络配置文档
- ✅ `docs/wsl2-setup.md` — WSL2 完整配置
- ✅ `docs/vpn-split-tunnel-config.md` — VPN 分流配置
- ✅ `tools/wsl-port-forward.ps1` — Windows 端口转发脚本

---

## 下一步计划

### 短期（Demo 演示后）

**M5: 家长反馈系统**（2-3 周）
- 课后报告生成（文字总结）
- 伙伴出生证导出（PDF/图片）
- 家长端查看链接（只读）
- 互动片段回放（录音/截图）

**M4 体验优化**（1-2 周）
- 助教端状态显示完善（学生列表、进度 overview）
- Advance 条件严格触发
- 占位图片替换为真实图片

### 中期（1-2 个月）

**M6: 真实 AI 服务集成**
- LLM: 豆包 (Doubao) / Claude（6-8h）
- TTS: Azure TTS / 讯飞语音（4-6h）
- 图像生成: DALL-E / Stable Diffusion（8-12h）
- 成本优化：缓存 + 预算控制（6h）

**M7: 课程扩展框架**
- 课程编辑器（Payload CMS）
- Stage 模板库（可复用组件）
- 课程版本管理
- A/B 测试框架

### 长期（3-6 个月）

- **M8**: 数据分析和个性化推荐
- **M9**: 多课堂并发和负载均衡
- **M10**: 移动端 App（React Native）

---

## Codex 审查协议

`codex exec` 审查必须按以下方式运行：
```bash
codex exec --sandbox read-only -c model_reasoning_effort="xhigh" \
  "<prompt starting with docs/agents/REVIEW_BRIEF.md>" \
  < /dev/null > file 2>&1
```

关键点：
- `< /dev/null` 防止 codex 阻塞在 stdin
- 快速确认：告诉 codex "不运行 shell 命令，仅读取 + 判断"（~48s vs 超时）
- 详见 `docs/agents/README.md`

---

## 开放问题 / 延期项

- 真实腾讯 Provider + 天御审核 — M6（通过现有接口注入；配置/密钥切换）
- 进程内 Session 锁 = 单实例限制（多实例 → Redis 分布式锁）
- 中国部署：离岸开发，国内运行；Demo 使用 Fake Provider

---

## Handoff — 下次会话从这里开始

### 在 WSL2 环境继续开发

1. 确保代码最新：`git pull origin main`
2. 安装依赖（如有更新）：`pnpm install`
3. 运行测试验证：`pnpm typecheck && pnpm test`
4. 启动 Demo：`./demo-start.sh`
5. 阅读关键文档：
   - `docs/presentation.md` — 汇报材料
   - `docs/known-issues.md` — 已知问题
   - `AGENTS.md` — 协作规则

### 迁移到 Mac 后

1. 按照 `docs/migration-wsl2-to-mac.md` 完整迁移
2. 验证清单：环境、测试、功能（45-85 分钟）
3. 继续 M5/M6 开发

### Demo 演示准备

1. 启动服务：`./demo-start.sh`
2. 打开 3 个浏览器标签页：
   - `http://localhost:5173/?role=assistant`（助教）
   - `http://localhost:5173/`（学生 1）
   - `http://localhost:5173/`（学生 2）
3. 按照 `docs/presentation.md` 中的 5 分钟演示脚本执行
4. 重点讲述产品理念和技术架构，避免提及技术细节缺陷

---

## 项目状态总结

✅ **核心功能完成**：6 个 Stage 完整流程  
✅ **多端协作验证**：学生/助教/教师实时同步  
✅ **技术架构稳定**：合约驱动、模块化、可扩展  
✅ **环境配置文档化**：WSL2 + Mac 迁移方案  
✅ **汇报材料就绪**：技术 + 产品双视角  

**下一阶段重点：Demo 演示 → 用户反馈 → M5/M6 迭代优化**

## Codex review setup (operational — IMPORTANT)

`codex exec` reviews MUST be run as: `codex exec --sandbox read-only -c
model_reasoning_effort="xhigh" "<prompt starting with docs/agents/REVIEW_BRIEF.md>" < /dev/null
> file 2>&1` — the `< /dev/null` is critical (without it codex blocks on stdin and "hangs").
For fast confirmations, tell codex "do NOT run any shell commands, just read + verdict"
(~48s vs timing out). Never pipe through `tail`. See docs/agents/README.md.

## Next: M3 — Frontend (`apps/web`) — FEATURES BUILT on branch `m3-frontend` (pending Codex review + merge)

Design note `docs/agents/designs/A-M3-frontend.md` (Codex-reviewed/hardened) implemented.

**Done (branch `m3-frontend`):**
- `shared/socket.ts` — typed `ClassroomSocket` over `@genius-x/contracts` (send `ClientMessage`,
  recv `ServerMessage`), socket.io-client reconnect (5 attempts), `joinSession` POST,
  `fetchSessionState` GET (assistant's read-only stage bootstrap), `serverBaseUrl` (VITE_SERVER_URL).
- `shared/session.tsx` — React context + reducer. Student: POST join → WS → **HELLO on every
  (re)connect → render from `RESUME_STATE.you`** (incl. `you.outputs.avatarUrl`), `lessonConfigVersion`
  stored. Assistant: joins on room code only, **never sends HELLO** (would register a phantom student
  & skew class-wide gates); learns stage from GET + STAGE_UNLOCK. Optimistic selection. Injectable
  socket/join/fetch seams for tests.
- `shared/ai-output.ts` — play `audioUrl` else speak `text` (Web Speech); audio error → silent
  speech fallback (no child-facing error); exposes `imageUrls`.
- `shared/voice.ts` — `getUserMedia`/MediaRecorder UX → **placeholder `audioRef`** (DF-M3-2);
  mic-denied degrades gracefully (still returns a ref, INTERACT still sent).
- `shared/thinking.tsx` — child-safe "magic" pending animation (no AI/Prompt/LLM wording).
- Student stages: `Standby`/`Intro`/`Icebreak` (hold-to-talk voice) / `Shape` (A-line native-canvas
  doodle → 变身 → 3 candidates → select → avatar). `StudentApp` = room-code join + stage router.
- `AssistantApp` — reads `lesson001` stage order/unlock-role from `@genius-x/course-config`
  (no hardcoded stage ids); unlocks next via `ASSISTANT_UNLOCK`/`TEACHER_UNLOCK`. `FORCE_ADVANCE`
  deferred (DF-M3-8: needs assistants registered on join).
- Tests: **apps/web 29/29** (fake-socket session incl. reconnect+resume & exact `ClientMessage`
  shapes; ai-output audio→speech fallback; voice degrade; stage render+dispatch+thinking;
  banned-wording scan). Full suite green: ai-gateway 19, server 47, web 29. typecheck green;
  `vite build` OK. New deferrals: **DF-M3-8** (assistant FORCE_ADVANCE) + DF-M3-2 extended (doodleRef).

**Codex review (xhigh, read-only):** initial NO-GO (6 findings) → all addressed (resume renders
pending from authoritative `you.pending`; selection is a non-authoritative `localSelection`
transient, never mutates `you.outputs`; connect-race closed via immediate `onConnect` when already
connected; Shape resolves variant-by-`image_gen` + output key strictly from config, fails closed
on drift; client degradations call an operator-visible `onDegraded` sink; Icebreak double-send
latched) → re-review **GO-with-nits** → nit closed (dropped the unused `variantId` override prop).
PR #6, branch `m3-frontend`.

**M3 merged** (PR #6, squash `00f1b86`, CI green). **M4 design** note merged (`11c363f`,
Codex-GO). **M4a built** on branch `m4a-server` (PR open, Codex GO-with-nits).

## M4a — contracts-v1.4 + server (branch `m4a-server`, PR pending human merge)

Implements the server half of `docs/agents/designs/M4-talent-birth-closure.md`:
- contracts-v1.4: `playPrepared` input, `PreparedOutput`/`PreparedOutputId`, `AI_READY` reshaped,
  `StudentRuntimeState` += displayName/memories/pendingMemory/prepared, `MEMORY_EXTRACTION_DONE`/
  `PREPARE_DONE`/`CALL_PREPARE`, `BirthSpeechInteraction.outputKind`, config `certificate` labels;
  `lessonConfigVersion` 1.0.0→1.1.0; docs/contracts updated.
- server: talent memory extraction (reuses ASR transcript, never blocks the reply), birth
  pre-generation gated on settled memories (one preparedId/student, ready-gated playPrepared with
  a friendly fallback so it's never empty), validated projection — all serialized under the session
  mutex. Tests: server 59 (incl. M4 e2e talent→birth→closure), web 30, ai-gateway 19; typecheck green.

Then **M4b** (frontend): Talent/Birth/Closure student stages + the thin teacher/projection screen,
against the frozen v1.4 contracts → B-level demo.

## Open / deferred

- Real Tencent providers + 天御 moderation — M6 (inject behind the existing seams; config/key swap).
- `FORCE_ADVANCE` button in assistant panel (engine ready, UI deferred).
- In-process session mutex = single-instance only (multi-instance → Redis lock).
- China: author offshore, run in China; demo uses fakes.

## M4b (talent/birth/closure frontend) — MERGED (PR #8)

Built on branch `m4b-frontend` (now merged to main):
- Student stages: `Talent.tsx` (hold-to-talk voice → thinking → AI reply → speak/play),
  `Birth.tsx` (AI_READY-gated play button → 伙伴出生证), `Closure.tsx` (goodbye message).
- Teacher/projection screen: `TeacherScreen.tsx` (renders `PROJECT` messages to the big screen).
- Certificate: `Certificate.tsx` (伙伴出生证 assembled from `RESUME_STATE.you` — displayName,
  memories, avatarUrl, personality/background labels from config).
- Tests: web 46 (incl. M4 stage render+dispatch+banned-wording scan), server 61, ai-gateway 19.
- Codex-reviewed the design (GO), typecheck green, `vite build` OK.

## M4c (assistant registration on join) — COMPLETE (branch `m4c-assistant-registration`)

Resolves DF-M3-8 / DF-M4-7 (assistant registration gap):
- contracts-v1.4: `SessionJoinRequest` += optional `role`, `SessionJoinResponse` += optional `assistantId`.
- server: `/session/join` now supports `role=assistant` → generates+returns `assistantId`, registers
  in `session.assistants[]`. Tests: http.test.ts covers assistant join + no-duplicate registration.
- web: `joinSession()` accepts optional `role` param; `SessionProvider.join()` for assistants calls
  `/session/join` with `role=assistant` (replaces the old workaround that used room code directly).
- Tests green: ai-gateway 19, server 61 (incl. assistant join tests), web 46; typecheck green.
- DEFERRED.md: marked DF-M3-8 / DF-M4-7 as **resolved (M4c)**.

**Impact:** Teacher projection (`REQUEST_PROJECTION`) now works in production (assistants are registered
and `requestedBy ∈ session.assistants` passes validation). The student-facing path (talent → birth →
certificate → closure) and the teacher big-screen projection are both fully functional.

## M4d (FORCE_ADVANCE UI) — COMPLETE (branch `m4d-force-advance`)

Resolves DF-M3-8 (final piece — UI for force-advance):
- AssistantApp: added "强制推进" button with confirmation flow (reason input + cancel/confirm actions)
- Sends `FORCE_ADVANCE` with `stageId`, `assistantId`, optional `reason`, `expectedCurrentStageId` (prevents race)
- Styles: orange button, confirmation form with styled input and action buttons
- Tests: 3 new tests (show button, send message with reason, cancel without sending)
- AssistantApp now accepts optional `deps` prop for testability
- Tests green: ai-gateway 19, server 61, web 49 (incl. 3 new FORCE_ADVANCE tests); typecheck green.
- DEFERRED.md: marked DF-M3-8 as **resolved (M4d)** — full feature complete.

**Impact:** Assistants can now force-advance the class when conditions aren't met (e.g., some students stuck).
The action is audited (reason logged, traced) and safe (expectedCurrentStageId prevents stale requests).

## Handoff — next session starts here

1. `git checkout m4a-server` (M4a built + green; PR open). Or `main` after it merges.
2. Read: `docs/agents/designs/M4-talent-birth-closure.md` (the plan), `AGENTS.md`,
   `packages/contracts/src/{ws-events,engine,student,course-config}.ts`, `docs/DEFERRED.md` (DF-M4-1..7).
3. `pnpm install && pnpm typecheck && pnpm test` (green: ai-gateway 19 / server 59 / web 30).
4. Human merges the M4a PR to main. Then build **M4b** (frontend) on its own branch against the
   frozen contracts-v1.4: Talent.tsx / Birth.tsx (AI_READY-gated play → 伙伴出生证 from RESUME_STATE.you) /
   Closure.tsx + a thin `?role=teacher` projection screen + tests (extend the banned-wording scan).
