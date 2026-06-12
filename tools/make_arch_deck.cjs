/**
 * 架构层进展 deck 生成器 v2 — pptxgenjs(遵循 anthropics/skills pptx 技能规范).
 * 设计系统:深紫封面/章节页 + 浅底内容页;表格承载结构化信息;卡片承载要点;
 * 技术语域(产品体验叙事放讲稿,页面保持架构语言);每页 speaker notes.
 * 运行: NODE_PATH=$(npm root -g) node tools/make_arch_deck.cjs
 */
const pptxgen = require("pptxgenjs");

const C = {
  ink: "2B2350", accent: "5B3FFF", deep: "1E173A", deep2: "2A2052",
  bg: "F7F5FC", card: "FFFFFF", line: "E3DDF2", glow: "FFD166",
  grey: "6B648B", ok: "2E9E6B", soft: "EFEAFB", warn: "C2491D",
};
const FONT = "PingFang SC";
const W = 13.333, H = 7.5;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Genius X";
pres.title = "架构层进展";

const shadow = () => ({ type: "outer", color: "2B2350", blur: 8, offset: 2, angle: 135, opacity: 0.14 });
let pageNo = 0;

function footer(slide) {
  pageNo += 1;
  slide.addText(`Genius X · 架构层进展 · 2026-06    ${String(pageNo).padStart(2, "0")}`, {
    x: W - 4.2, y: H - 0.42, w: 3.8, h: 0.3, align: "right",
    fontSize: 9, color: C.grey, fontFace: FONT, margin: 0,
  });
}

function header(slide, kicker, title) {
  slide.background = { color: C.bg };
  slide.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.62, w: 0.09, h: 0.78, fill: { color: C.accent } });
  slide.addText(kicker, { x: 0.92, y: 0.56, w: 11.5, h: 0.32, fontSize: 11, color: C.grey, charSpacing: 2, fontFace: FONT, margin: 0 });
  slide.addText(title, { x: 0.92, y: 0.86, w: 11.7, h: 0.62, fontSize: 25, bold: true, color: C.ink, fontFace: FONT, margin: 0 });
  slide.addShape(pres.shapes.LINE, { x: 0.7, y: 1.62, w: W - 1.4, h: 0, line: { color: C.line, width: 1 } });
}

function card(slide, x, y, w, h, title, lines, opts = {}) {
  const accent = opts.accent || C.accent;
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.card }, line: { color: C.line, width: 0.75 }, shadow: shadow() });
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 0.07, fill: { color: accent } });
  slide.addText(title, { x: x + 0.18, y: y + 0.18, w: w - 0.36, h: 0.42, fontSize: opts.titleSize || 14.5, bold: true, color: opts.titleColor || C.ink, fontFace: FONT, margin: 0 });
  if (lines && lines.length) {
    const runs = lines.map((t, i) => ({ text: t, options: { breakLine: i < lines.length - 1, fontSize: opts.bodySize || 11.5, color: C.ink, fontFace: FONT, paraSpaceAfter: 5 } }));
    slide.addText(runs, { x: x + 0.18, y: y + 0.62, w: w - 0.36, h: h - 0.78, valign: "top", margin: 0 });
  }
}

function chip(slide, x, y, w, text, fill, color) {
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 0.42, fill: { color: fill }, line: { type: "none" } });
  slide.addText(text, { x, y, w, h: 0.42, align: "center", valign: "middle", fontSize: 11, bold: true, color, fontFace: FONT, margin: 0 });
}

function tbl(slide, rows, opts) {
  const headRow = rows[0].map((t) => ({ text: t, options: { fill: { color: C.ink }, color: "FFFFFF", bold: true, fontSize: opts.headSize || 11.5, fontFace: FONT, valign: "middle", align: "left" } }));
  const bodyRows = rows.slice(1).map((r, ri) => r.map((cell) => {
    const o = typeof cell === "object" ? cell : { text: cell };
    return { text: o.text, options: Object.assign({ fill: { color: ri % 2 ? C.soft : "FFFFFF" }, color: o.color || C.ink, bold: o.bold || false, fontSize: opts.fontSize || 11, fontFace: FONT, valign: "middle", align: o.align || "left" }, o.options || {}) };
  }));
  slide.addTable([headRow, ...bodyRows], { x: opts.x, y: opts.y, w: opts.w, colW: opts.colW, border: { pt: 0.75, color: C.line }, rowH: opts.rowH || 0.42, margin: 0.07 });
}

function notes(slide, text) { slide.addNotes(text); }

// ───────────────────────── 1 封面 ─────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.deep };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.accent } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.22, y: 0, w: 0.07, h: H, fill: { color: C.glow } });
  s.addText("GENIUS X · 工程汇报", { x: 1.1, y: 2.0, w: 10, h: 0.4, fontSize: 14, color: C.glow, charSpacing: 4, fontFace: FONT, margin: 0 });
  s.addText("架构层进展", { x: 1.05, y: 2.45, w: 11, h: 1.2, fontSize: 54, bold: true, color: "FFFFFF", fontFace: FONT, margin: 0 });
  s.addText([
    { text: "基础架构的抽象 · 规划 · 实现", options: { breakLine: true, fontSize: 18, color: "CFC7EE" } },
    { text: "简版 PRD(四角色)× 抽象层技术方案 × Serving 规划与 SLO", options: { fontSize: 13.5, color: "9C92C8" } },
  ], { x: 1.1, y: 3.85, w: 10.5, h: 1.0, fontFace: FONT, margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 1.1, y: 5.25, w: 4.0, h: 0, line: { color: C.accent, width: 2 } });
  s.addText("2026 年 6 月 · 内部交流", { x: 1.1, y: 5.4, w: 8, h: 0.35, fontSize: 12, color: "9C92C8", fontFace: FONT, margin: 0 });
  notes(s, "大家好,今天同步 Genius X 的架构层进展。先讲定位:我们当前处于基础架构的抽象、规划与实现阶段——前端的正式设计和真实 AI 接口的调用测试,都在等品牌文档和账号资源,尚未开始;全链路目前跑在确定性模拟引擎上。今天两个议题:一是这一周拉齐之后的简版产品需求;二是支撑它的抽象层技术方案、serving 规划和服务质量目标。");
}

// ───────────────────────── 2 定位与工程承诺 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "POSITIONING", "阶段定位与工程承诺");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 1.85, w: W - 1.4, h: 0.72, fill: { color: C.deep }, line: { type: "none" } });
  s.addText([
    { text: "当前阶段:基础架构的抽象、规划与实现。", options: { bold: true, color: "FFFFFF", fontSize: 14 } },
    { text: "  前端正式设计与真实 API 测试待外部输入解锁;全链路运行于确定性模拟引擎。", options: { color: "CFC7EE", fontSize: 12.5 } },
  ], { x: 0.95, y: 1.85, w: W - 1.9, h: 0.72, valign: "middle", fontFace: FONT, margin: 0 });

  s.addText([
    { text: "产品承诺:", options: { bold: true, fontSize: 16, color: C.ink } },
    { text: "更安全、友善、持续记忆、共同成长的 AI 伙伴", options: { bold: true, fontSize: 16, color: C.accent, breakLine: true } },
    { text: "不承诺「永不出错」(模型存在幻觉)—— 承诺以下三条可验证的工程性质:", options: { fontSize: 12, color: C.grey } },
  ], { x: 0.7, y: 2.78, w: W - 1.4, h: 0.72, fontFace: FONT, margin: 0 });

  const cw = 3.85, gap = 0.19, y0 = 3.55, ch = 2.9;
  card(s, 0.7, y0, cw, ch, "故障静默隔离", [
    "儿童端零异常暴露:无报错态、无空态、无加载死墙",
    "预算超时即切确定性兜底链路 —— 响应下界是设计保证,不是期望",
    "课堂状态机不依赖任何 AI 调用结果推进",
  ]);
  card(s, 0.7 + cw + gap, y0, cw, ch, "降级全量可观测", [
    "所有降级 / 拒绝 / 兜底路径具名计数",
    "运行时事件集 ⊆ 契约声明集,由 CI 断言强制",
    "「兜底率上升」是仪表盘上的事故信号,而非静默的正常路径",
  ]);
  card(s, 0.7 + (cw + gap) * 2, y0, cw, ch, "纵深安全防御", [
    "输入 / 输出双向内容审查管线",
    "能力闭集:模型可调用的行为是枚举,不是开放面",
    "品牌与安全约束注入于网关层,业务侧不可旁路",
  ]);
  footer(s);
  notes(s, "核心信息一页。产品承诺是:更安全、友善、持续记忆、共同成长的 AI 伙伴。注意我们刻意不承诺「永不出错」——大模型存在幻觉,谁承诺谁心虚。我们承诺的是三条可以在工程上验证的性质:第一,故障静默隔离——任何异常对儿童端不可见,超时瞬间切换到确定性兜底;第二,降级全量可观测——每一次兜底都有具名计数,事件集合是契约声明的子集,由 CI 强制;第三,纵深防御——双向内容审查、能力闭集、网关层约束注入不可旁路。");
}

// ───────────────────────── 3 Section 议题一 ─────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.deep };
  s.addText("议题一", { x: 1.1, y: 2.7, w: 4, h: 0.4, fontSize: 15, color: C.glow, charSpacing: 3, fontFace: FONT, margin: 0 });
  s.addText("简版 PRD:四角色功能需求", { x: 1.05, y: 3.1, w: 11, h: 0.9, fontSize: 36, bold: true, color: "FFFFFF", fontFace: FONT, margin: 0 });
  s.addText("一周需求拉齐的产出 · 与既有架构的对齐结论", { x: 1.1, y: 4.05, w: 10, h: 0.4, fontSize: 14, color: "9C92C8", fontFace: FONT, margin: 0 });
  notes(s, "第一个议题。经过这一周的开会拉齐,我们形成了简版 PRD——四个角色各自的功能需求,以及一个重要结论:这些需求与已建成的架构是同源的,零返工。");
}

// ───────────────────────── 4 四角色表 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "REQUIREMENTS", "四角色需求 × 架构支撑");
  tbl(s, [
    ["角色", "核心职责", "架构支撑(关键机制)", "状态"],
    ["教师", "场景定义:课程情境与创作要求", "场景库 + 运行时场景选择(声明式后继图);新场景 = 配置交付,无需工程周期", { text: "✅ 已交付", color: C.ok, bold: true }],
    ["助教", "交互引导与课堂调度", "声明式选项交互;控制面协议(解锁 / 推进 / 兜底 / 投影鉴权)", { text: "✅ 已交付", color: C.ok, bold: true }],
    ["孩童", "AI 能力调用主体", "闭集工具机制(生成 / 修改 / 对话)· 多轮上下文 · 记忆提取管线", { text: "✅ 已交付*", color: C.ok, bold: true }],
    ["家长", "观测与异步参与", "衍生数据投影(版本时间线 / 策展)· 消息中继 · 课后会话授权", { text: "✅ 已交付*", color: C.ok, bold: true }],
  ], { x: 0.7, y: 2.0, w: W - 1.4, colW: [1.3, 3.0, 6.1, 1.53], rowH: 0.72, fontSize: 12 });
  s.addText("* 孩童「个性化」与家长「反馈层」为配置层 / 有界延伸,不触及架构(详见决策页 D3 / D5)", {
    x: 0.7, y: 5.95, w: W - 1.4, h: 0.35, fontSize: 10.5, color: C.grey, italic: true, fontFace: FONT, margin: 0,
  });
  footer(s);
  notes(s, "四个角色一张表。教师做场景定义——场景库加运行时选择已经建成,新场景纯配置交付,不需要工程周期。助教负责交互引导和课堂调度——声明式选项交互和控制面协议已交付。孩童是 AI 能力的调用主体——闭集工具机制、多轮上下文、记忆提取管线齐备。家长做观测与异步参与——版本时间线、消息中继、课后会话授权已交付。带星号的两项,孩童个性化和家长反馈层,是配置层的有界延伸,不触及架构。");
}

// ───────────────────────── 5 输入通道三档 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "INPUT CHANNEL", "儿童输入通道:分级开放模型");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 1.85, w: W - 1.4, h: 0.92, fill: { color: C.soft }, line: { color: C.accent, width: 1 } });
  s.addText([
    { text: "安全不变量(仅此三条,与开放档位无关):  ", options: { bold: true, fontSize: 12.5, color: C.accent } },
    { text: "① 用户自由文本不直接进入 prompt 组装   ② 全部儿童可见输出经内容审查   ③ 品牌/安全约束注入于网关层、不可旁路", options: { fontSize: 12, color: C.ink } },
  ], { x: 0.95, y: 1.85, w: W - 1.9, h: 0.92, valign: "middle", fontFace: FONT, margin: 0 });
  tbl(s, [
    ["档位", "选项来源", "多样性", "前置条件", "状态"],
    ["T1", "课前声明,启动期校验", "低", "—", { text: "已交付", color: C.ok, bold: true }],
    ["T1.5", "多选项集运行时切换 + 选项池轮换采样(同课不同学生)", "中", "纯配置", { text: "可立即实施", color: C.accent, bold: true }],
    ["T2", "模型按场景上下文动态生成,经 schema 校验 + 输出审查后渲染", "高", "真实内容审核接入", { text: "规划", color: C.grey, bold: true }],
  ], { x: 0.7, y: 3.05, w: W - 1.4, colW: [0.95, 5.6, 1.1, 2.3, 1.98], rowH: 0.62, fontSize: 12 });
  s.addText("「必须预声明」是内容审核缺位期的从严姿态,而非安全本质;T2 与记忆提取管线同构 —— 开放内容以 schema 约束,而非封闭词表(AI-first 原则)。多样性与创造力训练等待的是审核接入,不是架构重做。", {
    x: 0.7, y: 5.6, w: W - 1.4, h: 0.85, fontSize: 12, color: C.ink, fontFace: FONT, margin: 0,
  });
  footer(s);
  notes(s, "这一页回应一个重要的设计修正:我们曾把「选项必须课前声明」当作安全要求,重新审视后明确——安全不变量只有顶上这三条,预声明只是真实内容审核还没接入时期的从严姿态。所以分三档演进:T1 现状;T1.5 立即可做,多套选项集运行时切换加轮换采样,同一节课不同孩子看到不同选项;T2 目标态,模型动态生成选项,经过 schema 校验和输出审查后渲染——多样性来自模型,安全来自管线。结论:创造力和多样性等的是审核接入,不是架构重做。");
}

// ───────────────────────── 6 设计裁决 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "DECISIONS", "本周已裁决的设计决策");
  tbl(s, [
    ["#", "议题", "裁决"],
    ["D1", "监护人数据可见性", "衍生摘要可进入报告与时间线;原始对话永久隔离(安全升级为唯一例外)"],
    ["D2", "作品可见范围", "课堂内投影 + 实体输出;不引入儿童间在线社交面"],
    ["D3", "个性化边界", "配置层个性化开放(能力授予 / 形象表层 / 选项组合 / 命名);能力机制闭集不开放"],
    ["D4", "交互选项生成", "三档演进(上页);动态生成门控于内容审核接入"],
    ["D5", "互动反馈层", "封闭反应集合,配置化定义而非硬编码;单事件语义 —— 无聚合计分、无排名"],
    ["D6", "留存机制约束", "拉力源 = 关系 / 创作 / 叙事;排除变比率激励、FOMO、人为稀缺类机制"],
  ], { x: 0.7, y: 1.95, w: W - 1.4, colW: [0.7, 2.7, 8.53], rowH: 0.6, fontSize: 12 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 5.95, w: W - 1.4, h: 0.62, fill: { color: C.deep }, line: { type: "none" } });
  s.addText([
    { text: "结论:本周需求抽象与既有架构同源 —— 零返工。", options: { bold: true, fontSize: 13.5, color: C.glow } },
    { text: "  全部为已交付能力或有界延伸。", options: { fontSize: 12.5, color: "CFC7EE" } },
  ], { x: 0.95, y: 5.95, w: W - 1.9, h: 0.62, valign: "middle", fontFace: FONT, margin: 0 });
  footer(s);
  notes(s, "本周拉齐顺带了断了六个设计决策。最重要的三个:D1 监护人能看到的是衍生摘要,原始对话永久隔离——这保护孩子对伙伴的信任面;D2 作品可见范围等于课内投影加实体输出,不引入儿童间在线社交面——这是审核义务和定位的双重考量;D3 个性化在配置层开放,能力机制闭集不开放——闭集就是儿童产品的能力沙箱本体。D5 把具体的反馈功能抽象成了封闭反应集合的配置化定义。底部结论给工程侧:零返工。");
}

// ───────────────────────── 7 Section 议题二 ─────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.deep };
  s.addText("议题二", { x: 1.1, y: 2.7, w: 4, h: 0.4, fontSize: 15, color: C.glow, charSpacing: 3, fontFace: FONT, margin: 0 });
  s.addText("抽象层技术方案 · Serving 规划 · SLO", { x: 1.05, y: 3.1, w: 11.9, h: 0.9, fontSize: 28, bold: true, color: "FFFFFF", fontFace: FONT, margin: 0 });
  s.addText("系统分层 · 记忆架构 · 安全与资产模型 · 访问边界 · 服务质量目标", { x: 1.1, y: 4.05, w: 11, h: 0.4, fontSize: 14, color: "9C92C8", fontFace: FONT, margin: 0 });
  notes(s, "第二个议题,技术方案。顺序是:先看系统分层总览,然后展开两个最重要的子系统——记忆架构和安全资产模型,接着是多端访问边界,最后是服务质量目标总表和质量工程。");
}

// ───────────────────────── 8 架构总览 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "SYSTEM OVERVIEW", "系统架构:五层分解");
  const layers = [
    ["接入层", "单应用多模式:课堂 / 控制面 / 投影 / 监护人 / 课后", "模式路由 · 设计令牌主题系统(数据驱动换肤)", C.accent],
    ["网络边界", "公网仅三族白名单路由", "反向代理白名单;其余端点一律运营网隔离", "7A5BFF"],
    ["服务层", "课堂运行时 · 课后会话 · Agent 上下文 · 身份/资产服务", "配置驱动状态机 · 凭证化会话 · 记忆管线", "4A33CC"],
    ["AI 网关", "全系统唯一 AI 调用入口", "审查→预算→适配器→审查→schema→兜底→审计 · 并发闸 · 约束注入", C.ink],
    ["数据层", "PostgreSQL 16 · Redis", "append-only 账本 · 复合租户外键 · DB 级幂等 · 迁移校验和", C.deep2],
  ];
  let y = 1.92;
  for (const [name, comp, mech, color] of layers) {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y, w: 1.75, h: 0.66, fill: { color }, line: { type: "none" } });
    s.addText(name, { x: 0.7, y, w: 1.75, h: 0.66, align: "center", valign: "middle", fontSize: 13, bold: true, color: "FFFFFF", fontFace: FONT, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 2.45, y, w: 4.9, h: 0.66, fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 } });
    s.addText(comp, { x: 2.6, y, w: 4.65, h: 0.66, valign: "middle", fontSize: 11.5, color: C.ink, fontFace: FONT, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 7.35, y, w: 5.28, h: 0.66, fill: { color: C.soft }, line: { color: C.line, width: 0.75 } });
    s.addText(mech, { x: 7.5, y, w: 5.05, h: 0.66, valign: "middle", fontSize: 11, color: C.ink, fontFace: FONT, margin: 0 });
    y += 0.74;
  }
  s.addText([
    { text: "供应商适配层 = 唯一换装点:", options: { bold: true, fontSize: 12, color: C.accent } },
    { text: " 当前为确定性模拟引擎;图像通道已按真实 API 形态(异步 submit→poll)建模 —— 真实接入零业务代码改动", options: { fontSize: 11.5, color: C.ink } },
  ], { x: 0.7, y: 5.6, w: W - 1.4, h: 0.56, fontFace: FONT, margin: 0 });
  chip(s, 0.7, 6.3, 3.9, "横切:降级原则(不可见 × 可计数)", C.deep, "FFFFFF");
  chip(s, 4.72, 6.3, 3.9, "横切:契约体系 × 16(冻结)", C.deep, "FFFFFF");
  chip(s, 8.74, 6.3, 3.9, "横切:测试 × 453 + 对抗评审", C.deep, "FFFFFF");
  footer(s);
  notes(s, "系统分五层。接入层是一个应用多种模式,主题靠设计令牌数据驱动。网络边界上,公网只开三族白名单路由,其余端点全部隔离在运营网。服务层是课堂运行时、课后会话、Agent 上下文和身份资产服务。AI 网关是全系统唯一的 AI 调用入口——七步管线加并发闸加约束注入;其中供应商适配层是唯一换装点,现在跑模拟引擎,图像通道已经按真实 API 的异步提交轮询形态建模,真实接入零业务代码改动。数据层四条纪律:只增账本、复合租户外键、数据库级幂等、迁移校验和。三件横切:降级原则、契约体系、测试加对抗评审。");
}

// ───────────────────────── 9 分层记忆架构 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "MEMORY ARCHITECTURE", "分层记忆架构(L0–L3)");
  tbl(s, [
    ["层", "机制", "关键约束与保障"],
    ["L0  会话上下文", "有界环形缓冲:8 轮 / 16KB,按(会话 × 学生 × 场景)分键", "写入前置安全过滤;仅缓冲已确认轮次;永不进入会话快照"],
    ["L1  情景压缩", "场景退出触发:会话缓冲 → 单条结构化摘要(≤500 字,schema 校验)", "异步执行;失败具名计数,不阻塞主链路"],
    ["L2  检索注入", "版本化 prompt 模板:人设 + 语义记忆 top-12(按键去重)+ 情景 top-3 + 监护人消息", "模板 = 模型输入契约,golden test 锁定,变更先升版;注入前二次审查"],
    ["L3  离线归纳", "课末确定性反思 → 结构化日记实体(当前零模型调用)", "DB 唯一约束保证幂等;排除于检索集,防上下文自污染"],
  ], { x: 0.7, y: 1.95, w: W - 1.4, colW: [1.85, 5.7, 4.38], rowH: 0.78, fontSize: 11.5 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 5.62, w: W - 1.4, h: 0.85, fill: { color: C.soft }, line: { color: C.accent, width: 1 } });
  s.addText([
    { text: "多模态多轮一致性:", options: { bold: true, fontSize: 12, color: C.accent } },
    { text: " 文本连贯性由 L0 缓冲承载;图像连贯性由引用谱系承载(refine = 基于既有资产迭代 / create = 全新生成)—— 通道选择是场景配置项,不是架构分叉", options: { fontSize: 11.5, color: C.ink } },
  ], { x: 0.95, y: 5.62, w: W - 1.9, h: 0.85, valign: "middle", fontFace: FONT, margin: 0 });
  footer(s);
  notes(s, "记忆架构分四层。L0 是会话级的有界环形缓冲,八轮十六 K,按会话乘学生乘场景分键,写入前过安全过滤,且永不进入会话快照。L1 在场景退出时把整段缓冲压缩成一条五百字以内、schema 校验的结构化摘要,异步执行,失败可计数不阻塞。L2 是检索注入:版本化的 prompt 模板,人设加语义记忆前十二条加情景前三条加监护人消息——模板被 golden test 锁定,任何变更必须先升版本,因为上下文注入是模型输入契约。L3 是课末的离线归纳,目前是零模型调用的确定性实现,数据库唯一约束保证幂等。底部:图像多轮的一致性由引用谱系承载,沿用还是重来是配置项,不是架构分叉。");
}

// ───────────────────────── 10 记忆:边界与演进 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "MEMORY EVOLUTION", "记忆子系统:特性、边界与演进");
  const cw2 = 5.85, y0 = 1.92, ch2 = 2.42;
  card(s, 0.7, y0, cw2, ch2, "当前实现特性", [
    "确定性启发式检索 —— 同输入同输出,行为可复盘",
    "行级可审计:每条记忆为带来源的数据行(课次 / 环节)",
    "零幻觉面:只检索、不生成;单次调用 2–3 个索引查询",
  ], { accent: C.ok });
  card(s, 0.7 + cw2 + 0.23, y0, cw2, ch2, "已识别边界(诚实清单)", [
    "无语义召回 —— 相关性盲区,约 15–20 课时后显现",
    "重要度为静态基线,未参与学习;无遗忘曲线",
    "注入成本随课时线性增长(top-K 固定)",
  ], { accent: C.warn });
  card(s, 0.7, y0 + ch2 + 0.2, cw2, 2.32, "演进路线(评估先行)", [
    "① 离线评估基建(LLM-as-Judge)—— 无评估能力前,检索改动皆为盲改",
    "② 学习型重要度(访问加权 + 时间衰减,近零成本)",
    "③ 向量检索(语义召回,仍零幻觉)→ ④ 分层摘要归纳",
    "✕ 生成式记忆重写默认排除:幻觉记忆 = 不可逆信任损伤",
  ]);
  card(s, 0.7 + cw2 + 0.23, y0 + ch2 + 0.2, cw2, 2.32, "A/B 实验框架(抽象层之上)", [
    "变体插点 = 上下文构建接口;模板版本号即变体标识",
    "影子评估先行:并行检索、离线评判、绝不服务",
    "班级粒度分配;关系存续期内永不切换变体",
    "记忆编造率 = 熔断指标(必须 ≈ 0,越线自动回退)",
  ]);
  footer(s);
  notes(s, "诚实地讲记忆子系统的现状和路线。左上,当前特性:确定性、行级可审计、零幻觉面——这三条是面对家长和监管「它记得我孩子什么、为什么、怎么删」三连问的答案。右上,边界:没有语义召回,大约十五到二十节课后会显现;重要度还是静态的。左下,演进路线的原则是评估先行——先建 LLM 当裁判的离线评估基建,然后学习型重要度、向量检索、分层摘要;生成式记忆重写默认排除,因为幻觉记忆是不可逆的信任损伤。右下,A/B 框架:插点就是现成的上下文构建接口,影子评估先行,按班级分配,关系存续期内绝不切换变体,编造率是熔断指标。");
}

// ───────────────────────── 11 安全与资产模型 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "SAFETY & ASSET MODEL", "能力沙箱 × 版本化资产实体");
  const cw3 = 5.85, y0 = 1.95, ch3 = 3.6;
  card(s, 0.7, y0, cw3, ch3, "能力沙箱(执行面)", [
    "工具能力 = 闭集枚举(生成 / 迭代 / 对话),不可寻址外部端点",
    "参数 = 声明式白名单;自由文本不进入 prompt 组装",
    "轮次上限由状态机强制,超限走收尾分支(非禁用态)",
    "能力授予 append-only —— 无撤销语义(法定擦除为唯一例外)",
    "执行全程具名计数:调用 / 拒绝 / 降级逐事件可观测",
  ]);
  card(s, 0.7 + cw3 + 0.23, y0, cw3, ch3, "版本化资产实体(数据面)", [
    "角色实体 = 不可变基底(品牌约束)+ 可演进表层(用户资产)",
    "变更 = append-only 不可变快照;同态写入幂等(NO-OP)",
    "作品 → 角色版本血缘外键;时间线可完整回放",
    "衍生投影单写者 —— 旧档案降级为镜像,写路径唯一",
    "完整性预检 SQL 化(版本连续 / 无超前 / 租户隔离,期望恒零)",
  ]);
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: y0 + ch3 + 0.2, w: W - 1.4, h: 0.62, fill: { color: C.deep }, line: { type: "none" } });
  s.addText([
    { text: "课程进度 → 能力授予:", options: { bold: true, fontSize: 13, color: C.glow } },
    { text: "  「课程是入口、伙伴是本体」的商业逻辑在机制层的直接兑现", options: { fontSize: 12.5, color: "CFC7EE" } },
  ], { x: 0.95, y: y0 + ch3 + 0.2, w: W - 1.9, h: 0.62, valign: "middle", fontFace: FONT, margin: 0 });
  footer(s);
  notes(s, "两个承重子系统。左边,能力沙箱管执行面:模型能做的事是闭集枚举,工具永远不可寻址任何外部端点;参数是声明式白名单,自由文本不进 prompt;轮次上限由状态机强制,超限走收尾分支而不是禁用态;能力授予在数据库层面就是只增的,没有撤销语义。右边,版本化资产实体管数据面:角色实体分不可变基底和可演进表层,每次变更是一个不可变快照,作品通过血缘外键挂到版本上,完整性预检全部 SQL 化。底部一句:课程进度驱动能力授予——「课程是入口、伙伴是本体」的商业逻辑在机制层的直接兑现。");
}

// ───────────────────────── 12 访问边界 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "ACCESS & TRUST BOUNDARIES", "多端访问与凭证模型");
  tbl(s, [
    ["链路", "凭证类别", "生命周期", "存储形态", "关键约束"],
    ["课堂(教室内)", "房间码 + 注册链接", "单课时", "—", "运营网部署;投影来源鉴权"],
    ["课后分享", "能力 URL", "90 天", "sha256 哈希", "统一 404;范围 = 单(学生 × 课)"],
    ["监护人门户", "访问令牌", "180 天", "sha256 哈希", "进场即从 URL 抹除;读取 = 衍生投影(DENY 序列化测试)"],
    ["课后会话", "会话令牌", "≤35 分钟(DB CHECK)", "sha256 哈希", "单活跃会话(唯一索引);额度服务端结算;时段窗口"],
    ["运营端点", "—", "—", "—", "白名单外默认拒绝;永不暴露公网"],
  ], { x: 0.7, y: 1.95, w: W - 1.4, colW: [1.9, 2.0, 1.95, 1.6, 4.48], rowH: 0.62, fontSize: 11.5 });
  s.addText("统一原则:凭证只存哈希 · 失效一律均匀拒绝(无存在性 oracle)· 每类凭证独立的传输与留存裁决(风险接受不跨类继承)· 儿童侧数据读取一律为衍生投影,原始交互永不出域", {
    x: 0.7, y: 5.85, w: W - 1.4, h: 0.7, fontSize: 11.5, color: C.ink, fontFace: FONT, margin: 0,
  });
  footer(s);
  notes(s, "多端访问的凭证模型一张表。五条链路,每条有独立的凭证类别、生命周期和约束:课堂在运营网内;课后分享是九十天能力 URL;监护人门户一百八十天令牌,进场即从地址栏抹除;课后会话令牌不超过三十五分钟,数据库层面强制单活跃会话和额度结算;运营端点白名单外默认拒绝。底部四条统一原则,其中两条值得强调:失效一律均匀拒绝,不暴露任何存在性信号;每类凭证有独立的传输与留存裁决,风险接受不跨类继承——这是评审实战抓出来的纪律。");
}

// ───────────────────────── 13 SLO 与容量 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "SLO & CAPACITY", "服务质量目标与容量规划");
  tbl(s, [
    ["能力", "预算(p99 上界)", "超限行为(确定性兜底)"],
    ["LLM 对话", "≤ 8s", "预置话术 + 具名计数"],
    ["语音合成", "≤ 2s", "预置音频"],
    ["语音识别", "≤ 8s", "空转写,轮次可计数跳过"],
    ["图像生成", "≤ 15s 端到端(提交+轮询+审核共享时限)", "预置资产(按学生确定性轮换,防重复)"],
    ["课堂状态同步", "≤ 500ms(解锁 → 全端渲染)", "—"],
  ], { x: 0.7, y: 1.92, w: 7.6, colW: [1.7, 3.4, 2.5], rowH: 0.55, fontSize: 11.5 });
  const rx = 8.55, rw = 4.08;
  card(s, rx, 1.92, rw, 1.5, "容量", [
    "首年周末峰值 300+ ≈ 10–15 教室",
    "黏性路由分片即扩容,无需重构;压测先于首个真实峰值",
  ], { bodySize: 10.5 });
  card(s, rx, 3.55, rw, 1.32, "首响优化(已立项)", [
    "真实 API 后:流式输出 + 分句合成",
    "首可听响应 数秒 → 约 1s",
  ], { bodySize: 10.5 });
  card(s, rx, 5.0, rw, 1.72, "可用性分级", [
    "核心:状态机 / 安全门 / 兜底库 —— 失败不可接受",
    "影子:记忆 / 追踪 / 家长服务 —— 失效不影响课堂,必留痕",
  ], { bodySize: 10 });
  s.addText("预算语义:超时即切换,儿童端响应下界为设计保证;排队等待不计入能力预算(获得槽位后起算)", {
    x: 0.7, y: 5.78, w: 7.6, h: 0.6, fontSize: 11, color: C.grey, fontFace: FONT, margin: 0,
  });
  footer(s);
  notes(s, "服务质量目标。左表是各能力的延迟预算:对话八秒、合成两秒、图像十五秒端到端——关键不是数字,而是超限行为一列:预算到点的瞬间切换到确定性兜底,所以儿童端的响应下界是设计保证。右侧三张卡:容量上,首年周末峰值三百多人约等于十到十五间教室,黏性路由分片即可扩容,不需要重构,压测工具会在第一个真实峰值之前交付;首响优化已立项,真实 API 后用流式加分句把首可听响应压到一秒级;可用性分级,核心组件失败不可接受,影子组件失效不影响课堂但必须留痕。");
}

// ───────────────────────── 14 质量工程 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "QUALITY ENGINEERING", "质量工程:验证者与生成者分离");
  const sw = 2.9, sy = 1.95, sh = 1.58, sg = 0.18;
  const stats = [
    ["16", "冻结契约", "owner / 失败模式 / 漂移预检"],
    ["453", "自动化测试", "全绿;含真实 PG16 双跑冒烟"],
    ["9", "数据迁移", "校验和日志;改动即检出"],
    ["32+", "评审拦截缺陷", "4 致命 + 28 重要,全部修复后合并"],
  ];
  stats.forEach(([num, label, sub], i) => {
    const x = 0.7 + i * (sw + sg);
    s.addShape(pres.shapes.RECTANGLE, { x, y: sy, w: sw, h: sh, fill: { color: C.card }, line: { color: C.line, width: 0.75 }, shadow: shadow() });
    s.addShape(pres.shapes.RECTANGLE, { x, y: sy, w: sw, h: 0.07, fill: { color: C.accent } });
    s.addText(num, { x, y: sy + 0.12, w: sw, h: 0.62, align: "center", fontSize: 32, bold: true, color: C.accent, fontFace: FONT, margin: 0 });
    s.addText(label, { x, y: sy + 0.74, w: sw, h: 0.32, align: "center", fontSize: 13, bold: true, color: C.ink, fontFace: FONT, margin: 0 });
    s.addText(sub, { x: x + 0.1, y: sy + 1.06, w: sw - 0.2, h: 0.48, align: "center", fontSize: 9.5, color: C.grey, fontFace: FONT, margin: 0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 3.82, w: W - 1.4, h: 0.62, fill: { color: C.deep }, line: { type: "none" } });
  s.addText("契约冻结  →  实现  →  多智能体对抗评审  →  修复  →  真实 DB 冒烟  →  CI 双门  →  人工合并", {
    x: 0.7, y: 3.82, w: W - 1.4, h: 0.62, align: "center", valign: "middle", fontSize: 14, bold: true, color: "FFFFFF", fontFace: FONT, margin: 0,
  });
  card(s, 0.7, 4.65, 5.85, 1.9, "对抗评审(每切片强制)", [
    "独立评审智能体交叉攻击 + 质疑确认,验证者 ≠ 生成者",
    "实例:评审以探针证明「配置失误可使模型经提取路径伪造日记实体」—— 合并前封闭",
  ]);
  card(s, 6.78, 4.65, 5.85, 1.9, "可观测性即契约", [
    "封闭事件词表:运行时事件集 ⊆ 契约声明集(CI 断言,无前缀逃逸)",
    "儿童界面禁词扫描(含属性层)进 CI;隐私 DENY 序列化测试",
  ]);
  footer(s);
  notes(s, "质量工程的核心思想是验证者与生成者分离。四个数字:十六份冻结契约、四百五十三项测试、九个数据迁移带校验和、对抗评审累计拦截三十二个以上缺陷——四个致命二十八个重要,全部修复后才允许合并。中间是流程线:契约冻结到人工合并七步。左下是对抗评审的实例:评审员用探针证明了一个配置失误能让模型通过提取路径伪造日记实体,在合并前就封闭了——评审制度连自己测试体系的盲区都能抓出来。右下:可观测性本身就是契约,运行时事件集必须是契约声明集的子集,由 CI 断言。");
}

// ───────────────────────── 15 瓶颈与路线 ─────────────────────────
{
  const s = pres.addSlide();
  header(s, "BLOCKERS & ROADMAP", "当前瓶颈与等待期策略");
  tbl(s, [
    ["外部依赖", "解锁范围", "状态"],
    ["品牌设计文档 + 体验课大纲 × 4", "风格统一的正式前端设计 · 课程内容填充", { text: "本周六后", color: C.accent, bold: true }],
    ["服务号 / 腾讯云账号资源", "真实模型调用 · 内容审核 · 消息触达测试", { text: "待账号资源", color: C.warn, bold: true }],
    ["小程序主体资质", "周度监护人触达通道", { text: "周期数周 · 建议尽早启动", color: C.warn, bold: true }],
  ], { x: 0.7, y: 1.95, w: W - 1.4, colW: [3.7, 5.3, 2.93], rowH: 0.66, fontSize: 12 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.35, w: W - 1.4, h: 1.95, fill: { color: C.soft }, line: { color: C.accent, width: 1 } });
  s.addText([
    { text: "等待期策略:完成全部无外部依赖的地基", options: { bold: true, fontSize: 14, color: C.accent, breakLine: true } },
    { text: "供应商适配层 · 分层记忆 · 版本化资产实体 · 能力沙箱 · 访问边界 · 课后会话骨架 —— 均已就位", options: { fontSize: 12.5, color: C.ink, breakLine: true } },
    { text: "外部资源到位之日,接入即换装,而非开工。恢复开发首件事:监护人配置面 → 反馈抽象层 → 选项集轮换(T1.5)", options: { fontSize: 12.5, color: C.ink } },
  ], { x: 0.95, y: 4.55, w: W - 1.9, h: 1.6, fontFace: FONT, margin: 0 });
  footer(s);
  notes(s, "最后,坦诚讲三个瓶颈:品牌设计文档和四次体验课大纲,本周六之后到位,它们解锁正式前端设计和课程内容;服务号和腾讯云账号资源,解锁真实模型调用和内容审核测试;小程序主体资质申请周期数周,建议尽早启动。等待期的策略一句话:把所有不依赖外部的地基打完——供应商适配层、分层记忆、资产实体、能力沙箱、访问边界、课后会话骨架,全部已就位。外部资源到位之日,接入即换装,而非开工。");
}

// ───────────────────────── 16 结尾 ─────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.deep };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: H - 0.29, w: W, h: 0.29, fill: { color: C.accent } });
  s.addText("接入是换装,不是开工", { x: 1.05, y: 2.55, w: 11.2, h: 1.0, fontSize: 44, bold: true, color: "FFFFFF", fontFace: FONT, margin: 0 });
  s.addText([
    { text: "架构地基已就位:契约体系 · 记忆管线 · 资产实体 · 能力沙箱 · 访问边界", options: { breakLine: true, fontSize: 16, color: "CFC7EE" } },
    { text: "真实 API 与品牌输入到位之日,系统即点亮", options: { fontSize: 16, color: C.glow } },
  ], { x: 1.1, y: 3.75, w: 11, h: 1.0, fontFace: FONT, margin: 0 });
  s.addText("Q & A", { x: 1.1, y: 5.3, w: 4, h: 0.5, fontSize: 16, color: "9C92C8", charSpacing: 4, fontFace: FONT, margin: 0 });
  notes(s, "总结一句话:接入是换装,不是开工。契约体系、记忆管线、资产实体、能力沙箱、访问边界——架构地基已经全部就位,真实 API 和品牌输入到位之日,系统即点亮。我的汇报到这里,欢迎提问。");
}

pres.writeFile({ fileName: "docs/reports/2026-06-12-架构层进展.pptx" }).then(() => {
  console.log("saved: docs/reports/2026-06-12-架构层进展.pptx (16 slides)");
});
