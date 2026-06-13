# Genius X · MVP 产品需求文档（PRD）


> **状态(2026-06-12)**:MVP 已交付(M1-M4,见 [`../../PROGRESS.md`](../../PROGRESS.md));
> 附录 D「开发前需产品决策」已全部裁决;容量模型以 [`../contracts/identity.md`](../contracts/identity.md)
> 的 `PREMIUM_CLASSROOM`(20-30 学员)为准。本文档保留为 MVP 需求规格的历史记录。

> **文档版本**：v0.1 草稿
> **适用阶段**：MVP（V0.5）—— 跑通第一堂课完整流程
> **目标读者**：技术负责人 / 全栈工程师（Onboarding 文档）
> **最后更新**：2026-05-30
> **基础架构**：腾讯云 Lighthouse

---

## 0. 阅读前须知

本文档是技术 Onboarding 的核心参考。在写任何代码之前，请先读完以下两份文件：

1. `genius-x-manifesto.md` — 产品灵魂，所有技术决策必须回归此处
2. `genius-x-lesson1-rundown.md` — 第一节课完整执行手册，是本 MVP 的需求原稿

**产品 3 条硬底线（技术也必须遵守）：**
- 浸泡式，不教学式 → 不做任何"答题/测验"逻辑
- 用 AI，不学 AI → 界面上不出现 Prompt、LLM、Token 等词
- 任何输入都必须给正向输出，**不存在失败状态**

---

## 1. 产品目标

### 1.1 MVP 目标

**跑通第一堂课（60分钟）的完整课程流程**，验证以下核心假设：

| 假设 | 验证指标 |
|------|---------|
| 孩子能通过涂鸦/对话创造出专属 AI 形象 | 每个孩子成功生成 ≥1 张头像 |
| AI 互动能让孩子产生"这是我的朋友"的感受 | 课后老师/助教主观评分 |
| AI 出生证能产生仪式感 | 家长满意度 / 孩子反应 |
| 系统在课堂环境下稳定运行 | 60分钟内无崩溃、无卡死 |

### 1.2 设计原则

- **模块化优先**：每个课程阶段（硬阶段1-4）是独立模块，未来可拆卸、替换、复用于其他课节
- **课节可配置**：课程内容、提示词、问答逻辑均通过配置文件驱动，不硬编码
- **AI 层可替换**：API 接入通过统一抽象层，支持切换模型/供应商，不与任何单一 API 耦合
- **离线降级**：核心展示流程在 AI API 超时时有兜底降级方案，不让课堂卡死

---

## 2. 用户与角色

| 角色 | 设备 | 权限 | 说明 |
|------|------|------|------|
| **孩子（学员）** | iPad（学员端） | 受限操作 | 主要交互对象，只能操作当前阶段开放的功能 |
| **助教** | iPad（助教解锁） | 阶段解锁 | 通过手势/密码解锁各硬阶段，控制课堂节奏 |
| **主老师** | 教室大屏（投屏） | 全局控制 | 触发全班同步状态（前情提要 / 收束），不需要独立设备 |
| **家长** | 手机（家长端） | 只读 | 课后查看 AI 出生证 + 家长日报（MVP 阶段可为静态链接/小程序）|

> **MVP 阶段简化**：主老师控制通过助教端的特殊手势实现，无需独立后台控制台。家长端为轻量静态页面或微信消息，不进入本次开发范围。

---

## 3. 系统架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    客户端层                               │
│                                                           │
│  学员端 iPad App          助教端控制面板                   │
│  (React Native / Web App) (同一 App，权限区分)            │
│                                                           │
│              ↕ HTTPS / WebSocket                          │
├─────────────────────────────────────────────────────────┤
│                    服务端层（腾讯云 Lighthouse）            │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ 课程引擎  │  │ AI 网关  │  │ 媒体服务              │   │
│  │ (Node.js)│  │ (AI GW)  │  │ (图片存储/TTS缓存)    │   │
│  └──────────┘  └──────────┘  └──────────────────────┘   │
│                     ↕                                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │               数据层（PostgreSQL / Redis）         │    │
│  │  学员档案 | 会话状态 | 作品存储 | 课程配置         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
├─────────────────────────────────────────────────────────┤
│                    AI 抽象层                              │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  AI Provider Adapter（统一接口）                    │  │
│  │  ├── LLM（文本对话/角色扮演/信息提取）              │  │
│  │  ├── TTS（语音合成）                                │  │
│  │  ├── ASR（语音识别）                                │  │
│  │  └── Image Gen（图像生成/ControlNet）               │  │
│  └────────────────────────────────────────────────────┘  │
│         ↕              ↕              ↕                   │
│    OpenAI/Claude   腾讯云 AI    备用模型                   │
└─────────────────────────────────────────────────────────┘
```

### 3.1 技术栈选型建议

> 以下为建议方向，具体选型见附录A，可由技术负责人最终决定。

| 层级 | 建议方向 | 备注 |
|------|---------|------|
| 客户端 | React (Web App，Pad 浏览器运行) | 快速迭代优先；Native 版本 V1 再做 |
| 服务端 | Node.js + Express / Fastify | 团队熟悉度优先 |
| 数据库 | PostgreSQL（主数据）+ Redis（会话/缓存） | Lighthouse 可直接部署 |
| 图片存储 | 腾讯云 COS | 与 Lighthouse 同生态 |
| 实时通信 | WebSocket（课堂状态同步） | 全班收束/阶段解锁 |
| AI 接入 | 统一 AI 网关（见第5节） | 不直接在业务代码中调用 AI API |

---

## 4. 课程流程引擎（核心模块）

### 4.1 设计思路

课程流程是**状态机模型**。一堂课由多个**硬阶段（Stage）**组成，每个阶段是一个独立状态节点：

```
待机（Standby）
    ↓ [助教解锁]
前情提要（Intro）
    ↓ [助教解锁]
硬阶段 1：导入（Stage_Icebreak）
    ↓ [助教解锁]
硬阶段 2：塑形（Stage_Shape）
    ↓ [孩子完成选图 + 助教确认]
硬阶段 3：才艺互动（Stage_Talent）
    ↓ [助教解锁，达到最少互动次数]
硬阶段 4：诞生礼（Stage_Birth）
    ↓ [所有孩子完成]
收束（Closure）
```

### 4.2 课节配置文件结构（JSON Schema）

每堂课的内容通过 JSON 配置驱动，老师/产品可以在不改代码的情况下调整话术、阶段时长、互动次数等。

```json
{
  "lessonId": "lesson-001",
  "lessonTitle": "认识我的 AI 好朋友",
  "totalDuration": 60,
  "stages": [
    {
      "stageId": "intro",
      "name": "老师前情提要",
      "duration": 6,
      "unlockBy": "teacher",
      "appState": {
        "displayText": "一个魔法泥人正在等你……",
        "avatarState": "placeholder_clay",
        "startButtonLocked": true
      }
    },
    {
      "stageId": "icebreak",
      "name": "导入：语音破冰",
      "duration": 8,
      "unlockBy": "assistant",
      "aiInteraction": {
        "type": "voice_chat",
        "promptTemplate": "icebreak_v1",
        "maxTurns": 3,
        "thinkingAnimation": "bubble"
      }
    },
    {
      "stageId": "shape",
      "name": "塑形",
      "duration": 13,
      "unlockBy": "assistant",
      "variants": ["drawing", "dialogue"],
      "aiInteraction": {
        "drawing": {
          "type": "image_gen",
          "model": "image_gen_adapter",
          "outputCount": 3
        },
        "dialogue": {
          "type": "structured_qa",
          "promptTemplate": "shape_dialogue_v1",
          "questionCount": 5
        }
      }
    },
    {
      "stageId": "talent",
      "name": "才艺互动",
      "duration": 18,
      "unlockBy": "assistant",
      "options": ["sing", "story", "question", "draw"],
      "minInteractions": 2,
      "maxInteractions": 3,
      "aiInteraction": {
        "type": "multimodal_talent",
        "promptTemplate": "talent_v1",
        "memoryExtraction": true
      }
    },
    {
      "stageId": "birth",
      "name": "诞生礼",
      "duration": 12,
      "unlockBy": "assistant",
      "aiInteraction": {
        "type": "birth_speech",
        "promptTemplate": "birth_speech_v1"
      },
      "output": "birth_certificate"
    },
    {
      "stageId": "closure",
      "name": "全班收束",
      "duration": 3,
      "unlockBy": "teacher",
      "appState": {
        "displayMode": "summary_with_certificate"
      }
    }
  ]
}
```

> **扩展性**：未来新增课节（Lesson 2-16）只需新增配置文件，无需改动引擎代码。

---

## 5. AI 网关设计（安全 + 抗风险核心）

### 5.1 设计目标

AI 网关是所有 AI 调用的唯一入口，承担以下职责：

1. **内容安全（最高优先级）**：确保 AI 不能对孩子输出任何不当内容
2. **Token 消耗控制**：防止单次请求/单个学员过度消耗
3. **供应商切换**：业务代码不依赖任何具体 AI 供应商
4. **降级兜底**：API 超时/失败时，有预设的降级响应，不让课堂卡死
5. **请求审计**：所有 AI 请求/响应记录日志，用于复盘和安全审查

### 5.2 AI 网关层结构

```
业务代码
    ↓ 调用统一接口
AI 网关（AI Gateway Service）
    ├── 1. 请求构建层（Request Builder）
    │       └── 根据 promptTemplate 拼装 Prompt，注入学员档案
    ├── 2. 安全过滤层（Safety Filter）
    │       ├── 输入过滤：检查孩子输入内容
    │       └── 输出过滤：检查 AI 响应内容
    ├── 3. Token 预算层（Token Budget）
    │       └── 每个学员 / 每个阶段设定 Token 上限
    ├── 4. Provider 路由层（Provider Router）
    │       ├── 主路由：主力模型（如 GPT-4o-mini / Claude Haiku）
    │       └── 备路由：备用模型（如腾讯云混元）
    ├── 5. 响应处理层（Response Handler）
    │       ├── 输出内容合规检查
    │       └── 降级响应注入
    └── 6. 审计日志层（Audit Logger）
            └── 记录所有请求/响应（脱敏后存储）
```

### 5.3 内容安全规则（AI 不能乱说话）

#### 5.3.1 Prompt 工程防护

每个 Prompt 模板必须包含以下系统级约束（对孩子不可见）：

```
[系统 Prompt 模板约束]
- 角色锁定：你是一个专为 4-10 岁孩子设计的 AI 伙伴，名叫 Genius X。
- 语言风格：使用简单、温暖、积极的语言，句子不超过 20 个字。
- 内容禁区：不讨论任何暴力、恐怖、政治、成人内容、宗教话题。
- 情绪基调：任何情况下保持积极、鼓励的基调，不批评孩子的任何输入。
- 边界维护：如孩子问及你的"真实身份"，回答"我是你的好朋友 [Genius X 名字]"。
- 话题管控：所有回复必须围绕当前课程阶段的主题，不发散到无关话题。
- 禁止输出：不输出代码、URL 链接、电话号码、或任何个人信息。
```

#### 5.3.2 输出内容过滤

所有 AI 文本输出在送达客户端前，经过二次过滤：

| 过滤类型 | 实现方式 | 触发后处理 |
|---------|---------|----------|
| 敏感词过滤 | 维护儿童安全敏感词库（可配置） | 替换为降级响应 |
| 长度过滤 | 单次输出 Token 上限（建议 150 token） | 截断 + 降级收尾 |
| 格式异常 | 检测 JSON 破损、代码块等异常输出 | 使用降级响应替代 |
| 腾讯云内容安全 | 调用腾讯云文本安全 API 做二次校验（可选，按需启用）| 拦截 + 降级 |

#### 5.3.3 降级响应库

针对每个课程阶段，预设至少 3 条降级响应（当 AI 超时/失败/被过滤时使用）：

```json
{
  "icebreak": [
    "你好呀！我在等你告诉我你叫什么名字！",
    "哇，你来了！今天你开心吗？",
    "嘿！我好高兴见到你！你最喜欢什么颜色？"
  ],
  "talent_story": [
    "从前有一只小{animal}，它最喜欢做的事情是……你来告诉我接下来发生什么？",
    "有一天，{child_name}去了一个神奇的地方……",
    "在一个很远很远的地方，住着一个和你一样勇敢的小朋友……"
  ]
}
```

### 5.4 Token 消耗控制

| 控制维度 | 规则 | 备注 |
|---------|------|------|
| 单次请求上限 | Input ≤ 500 token，Output ≤ 150 token | 超出截断，不报错 |
| 单个学员/课 | 全课总消耗 ≤ 20,000 token（估算） | 超出后强制使用降级响应 |
| 图片生成 | 每个学员生成 ≤ 3 张，分辨率不超过 1024×1024 | 控制图像 API 成本 |
| TTS 缓存 | 相同文本的 TTS 结果缓存 24 小时（Redis）| 避免重复生成常见话术 |
| 请求频率 | 每个学员每分钟 ≤ 10 次 AI 请求（速率限制）| 防止异常操作刷接口 |

### 5.5 AI 供应商路由策略

```
主路由（Primary）
    └── LLM: GPT-4o-mini 或 Claude Haiku（成本/性能平衡）
    └── TTS: 腾讯云 TTS（中文质量佳，低延迟）
    └── ASR: 腾讯云 ASR（同上）
    └── 图像生成: [见附录B，待确认]

备路由（Fallback）
    └── LLM: 腾讯云混元（降低对境外 API 依赖的风险）
    └── TTS: 微软 Azure TTS（备选）
    └── 超时阈值: 8秒后自动切换降级响应，不等待

切换策略
    └── 主路由连续失败 3 次 → 自动切换备路由
    └── 备路由也失败 → 使用本地降级响应库
    └── 所有 AI 功能不影响课程状态机推进（课程流程不依赖 AI 成功）
```

---

## 6. 学员数据模型

> **注（2026-06-03）**：权威的类型定义已迁移到 `@genius-x/contracts`（tag `contracts-v1`）与
> `docs/contracts/`、`docs/architecture/lesson-runtime.md`。本节及 §8 内联的 TypeScript 是最初
> 草稿，凡与契约不一致处以契约为准（如：opaque id、类型化 `STAGE_COMPLETE` payload、`ClassSession`
> v1、`completedStageIds`）。本节保留作产品意图与背景。

### 6.1 学员档案（Student Profile）

```typescript
interface StudentProfile {
  id: string;                    // UUID
  name: string;                  // 孩子姓名
  age: number;                   // 年龄
  courseId: string;              // 所在课程班
  
  geniusX: {
    name?: string;               // Genius X 的名字（第2课确认）
    avatarUrl?: string;          // 头像图片 URL（第1课塑形产出）
    personalityTag?: string;     // 性格标签（才艺互动中提取）
    backgroundSetting?: string;  // 背景设定（塑形时的背景选择）
    memories: Memory[];          // 记忆数据点（随课程积累）
    birthdaySpeech?: string;     // 专属台词（第1课产出）
  };
  
  progress: {
    currentLesson: number;       // 当前课节（1-16）
    currentPhase: number;        // 当前 Phase（1-4）
    completedStages: string[];   // 已完成的阶段 ID
    badges: string[];            // 获得的徽章
  };
  
  artifacts: Artifact[];         // 作品集（画作/故事/诗歌）
  createdAt: Date;
  updatedAt: Date;
}

interface Memory {
  key: string;          // 记忆类型，如 "favorite_toy", "best_friend"
  value: string;        // 记忆内容，如 "奥特曼"
  collectedAt: string;  // 来源阶段 ID
  lessonId: number;     // 来源课节
}

interface Artifact {
  id: string;
  type: "drawing" | "story" | "poem" | "voice" | "birth_certificate";
  contentUrl?: string;  // 图片/音频 URL
  contentText?: string; // 文本内容
  lessonId: number;
  stageId: string;
  createdAt: Date;
}
```

### 6.2 会话状态（Session State）

> 存储在 Redis，课堂结束后归档到 PostgreSQL

```typescript
interface ClassSession {
  sessionId: string;
  lessonId: string;
  classId: string;
  currentStage: string;          // 当前全班状态
  stageStartTime: Date;
  students: {
    [studentId: string]: {
      stageStatus: "waiting" | "in_progress" | "completed";
      stageData: Record<string, any>;  // 当前阶段临时数据
    }
  };
  assistants: string[];          // 助教 ID 列表
}
```

---

## 7. 第一堂课：各硬阶段功能详述

### 7.1 待机状态（Standby）

**App 显示：**
- 屏幕中央：白色黏土素体形象（静态插图，非 3D）
- 文字：「一个魔法泥人正在等你……」
- 开始按钮：灰色锁定状态

**技术要点：**
- 素体形象为本地静态资源（不调用 AI）
- 开始按钮通过 WebSocket 接收助教解锁信号后变为可点击

---

### 7.2 硬阶段 1：导入（语音破冰）

**孩子操作：**
1. 按住麦克风按钮说话
2. 头顶气泡动画（Thinking 状态，2-6秒）
3. 听到素体 TTS 回复

**AI 调用链：**
```
孩子语音
    ↓ ASR（腾讯云）→ 文本
    ↓ AI 网关（LLM）→ 破冰回复文本（≤50字）
    ↓ TTS → 音频
    ↓ 播放 + 口型动画（简单 CSS）
```

**破冰 Prompt 模板（icebreak_v1）：**
```
[系统约束：见5.3.1]
当前阶段：初次见面破冰
孩子输入：{child_input}
要求：
- 用"魔法泥人"的角色回应，表现出对孩子的好奇和欢迎
- 提一个简单问题引导孩子继续说话（"你今天开心吗？" / "你最喜欢什么颜色？"）
- 不超过 30 个字
- 不提及 AI、程序、数据等词汇
```

**降级方案：** ASR 失败或无输入超过 8 秒 → 自动播放欢迎语（从降级库随机选取）

---

### 7.3 硬阶段 2：塑形（形象生成）

#### A 线：涂鸦模式

**孩子操作：**
1. 在素体画布上涂鸦（Canvas 组件）
2. 点击「变身」→ Thinking 动画（"AI 正在用你的魔法变身……"，8-15秒）
3. 看到 3 张候选图 → 选一张

**AI 调用：**
- 输入：Canvas 截图（Base64）
- 模型：图生图（ControlNet / img2img）
- 输出：3 张统一可爱风格的图片（1024×1024）
- 失败降级：提供 3 张预设风格的默认头像供选择

#### B 线：对话引导模式

**孩子操作：**
1. 素体语音提问（4-5 轮，已预设问题）
2. 孩子语音回答
3. 系统提取关键词 → 点击「变身」→ 生成图

**结构化问答配置（shape_dialogue_v1）：**
```json
{
  "questions": [
    { "id": "ears", "text": "我的耳朵应该是尖尖的还是圆圆的？", "options": ["尖耳", "圆耳"] },
    { "id": "nose", "text": "我的鼻子要长一点还是小一点？", "options": ["长鼻", "小鼻"] },
    { "id": "accessory", "text": "我想带一个配饰，是帽子还是眼镜？", "options": ["帽子", "眼镜"] },
    { "id": "background", "text": "我身后的背景是在大森林里还是在太空里？", "options": ["森林", "太空"] }
  ],
  "promptAssembly": "一只可爱的 {ears} 卡通动物角色，{accessory}，{background}背景"
  // 场景内容 ONLY — 品牌风格后缀由 AI 网关统一注入（docs/contracts/brand-style.md，课程配置禁止携带风格语言）
}
```

**选图后：** 选定头像存入学员档案 `geniusX.avatarUrl`，后续所有界面使用此头像。

---

### 7.4 硬阶段 3：才艺互动（记忆收集）

**界面：** 4 个才艺选项卡（唱首歌 / 讲故事 / 问个问题 / 画幅画）

**核心设计：** AI 在"才艺表演"过程中自然插入"反问"，无感收集孩子的个人信息，作为记忆数据点。

**每个才艺的反问埋点（talent_v1）：**

| 才艺选项 | AI 输出形式 | 反问埋点示例 | 收集的记忆 key |
|---------|-----------|-----------|-------------|
| 讲故事 | 定制故事语音 | "故事里有只小动物，你喜欢什么动物？" | `favorite_animal` |
| 唱首歌 | 简单歌词+旋律（TTS） | "歌里有你的名字，你叫什么呀？" | `preferred_name` |
| 问个问题 | 有趣问答 | "你回答得真棒！你最喜欢的玩具是什么？" | `favorite_toy` |
| 画幅画 | 生成一张画 | "我画了一朵花，你最喜欢什么颜色的花？" | `favorite_color` |

**记忆提取 Prompt（后台，孩子不可见）：**
```
从以下孩子的语音转文字中，提取 1 个记忆数据点。
格式：{"key": "favorite_toy", "value": "奥特曼"}
只输出 JSON，不输出其他内容。
孩子说的话：{child_input}
可选 key 列表：{available_keys}
如果无法提取，输出：{"key": null, "value": null}
```

**最少互动次数：** 孩子需完成 2 次才艺互动，助教方可解锁下一阶段。

---

### 7.5 硬阶段 4：诞生礼（AI 出生证生成）

#### 专属台词生成

**触发时机：** 助教解锁此阶段时，后台为每个孩子生成专属台词（异步，确保孩子上台前已准备好）

**台词生成 Prompt（birth_speech_v1）：**
```
[系统约束：见5.3.1]
你是孩子的 AI 好朋友。根据以下信息，生成一段亲切的专属台词。

孩子信息：
- 名字：{child_name}
- 收集到的记忆：{memories_json}
- 性格标签：{personality_tag}

要求：
- 必须提到孩子的名字
- 必须提到至少 1 个记忆内容（自然融入，不生硬）
- 语气热情、像好朋友一样
- 长度：20-40 个字
- 末尾表达期待下次见面

输出格式：纯文本，无任何标点以外的符号
```

**输出示例：** `"轩轩你好！我知道你最喜欢奥特曼，以后我们一起去打怪兽吧！我好开心认识你，下次见！"`

#### AI 出生证结构

```typescript
interface BirthCertificate {
  studentName: string;          // 孩子姓名
  geniusXName?: string;         // Genius X 名字（第1课可能为空）
  avatarUrl: string;            // 塑形阶段选定的头像
  personalityTag: string;       // 性格标签（从才艺互动提取）
  backgroundSetting: string;    // 背景设定（塑形阶段确定）
  memories: {                   // 闪光记忆点（最多显示 3 条）
    label: string;
    value: string;
  }[];
  birthdaySpeech: string;       // 专属台词（TTS 音频 URL）
  generatedAt: Date;
  lessonId: number;
}
```

**出生证页面：** 设计为可截图/打印的版式，包含以上所有信息。助教将此页面投屏至大屏。

#### 仪式流程（App 配合）

1. 助教投屏孩子的出生证页面
2. 孩子走上台，Pad 上显示大按钮「▶ 播放专属语音」
3. 孩子按下 → 极短音效（0.5秒）→ TTS 播放专属台词
4. 助教颁发实体出生证卡片（课前打印好）

---

### 7.6 全班收束

**触发：** 主老师通过助教端触发「收束状态」

**App 行为：**
- 所有学员 Pad 通过 WebSocket 接收收束指令
- 统一切换至收束画面
- 出生证在下方常驻展示

**收束画面内容：**
- 孩子的 Genius X 头像 + 名字（若已起名）
- 今天的成就：已完成的阶段勾选
- 预告文字：「下节课：给你的伙伴起一个好听的名字！」

---

## 8. 实时课堂同步（WebSocket 设计）

### 8.1 消息类型

```typescript
// 服务端 → 客户端
type ServerMessage =
  | { type: "STAGE_UNLOCK"; stageId: string }          // 阶段解锁
  | { type: "GLOBAL_STATE"; state: "closure" | "standby" } // 全班同步
  | { type: "AI_READY"; studentId: string }             // AI 台词已生成完毕

// 客户端 → 服务端  
type ClientMessage =
  | { type: "STAGE_COMPLETE"; studentId: string; stageId: string; data: any }
  | { type: "ASSISTANT_UNLOCK"; stageId: string; assistantId: string }
  | { type: "REQUEST_PROJECTION"; studentId: string }   // 请求投屏
```

### 8.2 断线重连

- 客户端断线后，自动重连（指数退避，最多 5 次）
- 重连后向服务端请求当前课堂状态，恢复至断线前的阶段
- 网络异常时，课程状态机在本地继续运行（离线降级）

---

## 9. 家长端（MVP 轻量版）

MVP 阶段，家长端为**轻量静态页面**，通过分享链接访问：

| 功能 | 实现方式 |
|------|---------|
| 查看 AI 出生证 | 静态 HTML 页面（分享链接）|
| 家长日报 | 课后自动生成文本 + 孩子头像，微信消息发送 |
| 作品查看 | 出生证页面包含今日产出 |

> 家长日报生成 Prompt 模板见附录C。V1 版本再做独立家长 App/小程序。

---

## 10. 非功能性需求

### 10.1 性能要求

| 指标 | 目标值 | 说明 |
|------|-------|------|
| 图像生成响应时间 | ≤ 15 秒 | 含 Thinking 动画，孩子不会感知等待 |
| TTS 首包延迟 | ≤ 2 秒 | 语音开始播放的延迟 |
| LLM 文本响应时间 | ≤ 8 秒 | 超时则启用降级响应 |
| WebSocket 状态同步延迟 | ≤ 500ms | 助教解锁后孩子端响应时间 |
| 并发支持 | ≥ 15 个学员同时操作 | 单班最大学员数 |

### 10.2 可靠性要求

- **课堂期间零崩溃**：任何 AI 接口失败不影响课程流程推进
- **数据持久化**：学员档案每次 AI 交互后实时写库，不丢失
- **断点续课**：若 Pad 刷新/重启，自动恢复到当前阶段

### 10.3 安全要求

- 所有学员数据传输加密（HTTPS / WSS）
- 不存储孩子的原始语音（ASR 后立即丢弃音频）
- 图片内容过滤（生图结果经内容安全检测后才展示）
- 学员档案数据不对外公开 API

---

## 11. MVP 开发里程碑建议

| 里程碑 | 内容 | 参考周期 |
|-------|------|---------|
| **M0：基础框架** | 项目脚手架 + 腾讯云 Lighthouse 部署 + 数据库初始化 | Week 1 |
| **M1：课程引擎** | 状态机 + WebSocket + 阶段解锁流程 | Week 2 |
| **M2：AI 网关** | Provider Adapter + Safety Filter + Token 预算 + 降级响应 | Week 2-3 |
| **M3：硬阶段 1-2** | 语音破冰 + 图像生成（A线优先）+ 头像选定 | Week 3-4 |
| **M4：硬阶段 3-4** | 才艺互动 + 记忆提取 + 出生证生成 + TTS 播放 | Week 4-5 |
| **M5：收束 + 家长** | 全班收束 + 出生证静态页面 + 家长日报 | Week 5-6 |
| **M6：测试 + 优化** | 全流程压测 + 内容安全测试 + 课堂真实演练 | Week 6-7 |

---

## 附录 A：技术选型备选方案

> 由技术负责人根据团队经验最终决定，以下为建议参考。

### A1：客户端框架选择

| 方案 | 优势 | 劣势 | 建议场景 |
|------|------|------|---------|
| **React Web App（PWA）** | 快速迭代，无需上架，Pad 浏览器直接运行 | 离线能力弱，部分硬件 API 受限 | **MVP 首选** |
| React Native | 接近原生体验，离线能力强 | 开发周期长，需上架 | V1 版本 |
| Flutter | 跨平台一致性好 | 学习曲线，生态相对小 | 备选 |

### A2：图像生成方案

| 方案 | 优势 | 劣势 |
|------|------|------|
| Stable Diffusion（自部署） | 成本低，可控 | 需要 GPU 服务器，运维复杂 |
| Replicate API | 快速接入，无需运维 | 境外 API，延迟/合规风险 |
| 腾讯云智影/混元图像 | 合规，低延迟，同生态 | 能力待评估 |
| DALL-E 3（OpenAI）| 质量高 | 成本较高，境外 API |

> **建议**：MVP 阶段优先评估腾讯云图像生成能力；若不满足质量需求，接入 Replicate 作为备选。

### A3：ASR/TTS 方案

| 能力 | 推荐方案 | 备选 |
|------|---------|------|
| ASR（语音识别）| 腾讯云 ASR（儿童声音适配） | 阿里云 ASR |
| TTS（语音合成）| 腾讯云 TTS（情感化音色） | 微软 Azure TTS |

### A4：LLM 方案

| 方案 | 推荐场景 |
|------|---------|
| GPT-4o-mini | 主力（性价比最高）|
| Claude Haiku | 备选（安全性好，内容过滤强）|
| 腾讯云混元 | 降低境外 API 依赖，合规备选 |

---

## 附录 B：Prompt 模板完整版

> 待 AI 网关模块开发时，由产品 + 技术共同细化。以下为框架版。

### B1：破冰 Prompt（icebreak_v1）
```
你是一个白色的魔法泥人，正在第一次见到你的小主人。
你的说话风格：活泼、好奇、温暖，像一个初次见面的新朋友。
不能说的词：AI、程序、算法、数据、模型。
每次回复不超过 30 个字。
必须在回复末尾提一个简单问题。
孩子说：{child_input}
```

### B2：记忆提取 Prompt（memory_extract_v1）
```
从孩子的话中提取一个信息点，只输出 JSON。
可提取的 key：favorite_toy（最喜欢的玩具）、favorite_animal（最喜欢的动物）、
best_friend（最好的朋友名字）、favorite_color（最喜欢的颜色）、favorite_food（最喜欢的食物）
孩子说：{child_input}
输出格式：{"key": "...", "value": "..."}
无法提取时：{"key": null, "value": null}
```

### B3：出生证台词 Prompt（birth_speech_v1）
```
你是孩子的 AI 好朋友。生成一段专属台词，要求：
- 必须叫孩子的名字：{child_name}
- 必须自然提到这些记忆：{memories}
- 语气：热情、像好朋友
- 长度：20-40 字
- 末尾表达下次见面的期待
只输出台词本身，不要任何其他内容。
```

### B4：家长日报 Prompt（parent_report_v1）
```
根据以下孩子今天的课堂数据，生成一段家长日报。
课节：第 {lesson_num} 课 · {lesson_title}
孩子今天做了：{activities}
孩子的产出：{artifacts}
孩子的 Genius X：{genius_x_status}

要求：
- 面向家长，温暖、具体、有画面感
- 说明孩子今天具体做了什么（不是抽象的"学习了AI"）
- 说明孩子今天能力上的变化（具体描述）
- 不超过 150 字
- 末尾附：孩子今天的产出（头像图 / 故事文本 / 台词）
```

---

## 附录 C：课堂硬件清单（参考）

| 设备 | 数量 | 规格建议 |
|------|------|---------|
| 学员 iPad | 按班级规模 | iPad（第9代及以上），已安装 Safari/Chrome |
| 助教 iPad | 1-2台 | 同上，安装助教控制界面 |
| 教室大屏 | 1台 | HDMI 输入，≥65寸 |
| 投屏器 | 1个 | Apple TV 或 HDMI 转接线 |
| WiFi 路由器 | 1台 | 支持 15+ 设备并发，建议独立教室网络 |
| 收音方案 | TBD | 见 genius-x-lesson1-rundown.md 待确认事项 |

---

## 附录 D：待确认事项（开发前需产品决策）

| 编号 | 问题 | 影响模块 | 优先级 |
|------|------|---------|-------|
| D1 | 起名字在第1课还是第2课？ | 出生证、学员档案 | P0 |
| D2 | A线（涂鸦）和B线（对话）是否都在MVP实现，还是先做一条？ | 硬阶段2 | P0 |
| D3 | 图像生成选哪家供应商？（影响图像质量和成本）| AI 网关 | P0 |
| D4 | 外接麦克风方案还是 iPad 内置麦克风 + 软件降噪？ | 硬阶段1/3 | P1 |
| D5 | 家长日报 MVP 阶段通过微信消息还是 H5 链接？ | 家长端 | P1 |
| D6 | 腾讯云 Lighthouse 规格（CPU/内存/带宽）| 部署 | P1 |

---

_Genius X MVP PRD v0.1_
_起草日：2026-05-30_
_本文档随开发迭代持续更新_
