import { describe, it, expect } from "vitest";
import type { TraceEvent, TraceSink } from "@genius-x/contracts";
import { AiGateway, type GatewayDeps } from "./gateway";
import { KeywordSafetyFilter } from "./safety";
import { PresetFallbackLibrary } from "./fallback";
import { FakeProvider, type FakeContent } from "./providers/fake";
import type { FakeProviderConfig, ProviderAdapter } from "./providers/types";

const NOW = "2026-06-03T00:00:00.000Z";

function makeGateway(cfg: FakeProviderConfig = {}, content: FakeContent = {}, timeouts?: GatewayDeps["timeouts"]) {
  const events: TraceEvent[] = [];
  const trace: TraceSink = { record: (e) => events.push(e) };
  const deps: GatewayDeps = {
    provider: new FakeProvider(cfg, content),
    safety: new KeywordSafetyFilter(),
    fallback: new PresetFallbackLibrary(),
    trace,
    now: () => NOW,
    ...(timeouts ? { timeouts } : {}),
  };
  return { gw: new AiGateway(deps), events };
}

describe("AiGateway.llm", () => {
  it("returns primary output on the happy path (not degraded)", async () => {
    const { gw } = makeGateway();
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "你好" });
    expect(r.meta.degraded).toBe(false);
    expect(r.meta.source).toBe("primary");
  });

  it("falls back (degraded) on provider failure", async () => {
    const { gw, events } = makeGateway({ llm: { fail: true } });
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "你好" });
    expect(r.meta.degraded).toBe(true);
    expect(r.meta.source).toBe("library");
    expect(events.some((e) => e.kind === "fallback")).toBe(true);
  });

  it("falls back when the output trips the safety filter", async () => {
    const { gw } = makeGateway({ llm: { filteredOutput: true } });
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "你好" });
    expect(r.meta.degraded).toBe(true);
  });

  it("falls back (and skips the provider) on filtered input", async () => {
    const { gw } = makeGateway();
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "我们来聊暴力吧" });
    expect(r.meta.degraded).toBe(true);
  });

  it("falls back on timeout (provider exceeds the budget)", async () => {
    const { gw } = makeGateway({ llm: { timeout: true } }, {}, { llm: 30 });
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "你好" });
    expect(r.meta.degraded).toBe(true);
  });
});

describe("AiGateway other capabilities", () => {
  it("tts/asr/imageGen return primary on happy path", async () => {
    const { gw } = makeGateway();
    expect((await gw.tts({ text: "hi" })).meta.degraded).toBe(false);
    expect((await gw.asr({ audioRef: "ref" })).meta.degraded).toBe(false);
    const img = await gw.imageGen({ kind: "img2img", source: "ref", count: 3 });
    expect(img.imageUrls).toHaveLength(3);
    expect(img.meta.degraded).toBe(false);
  });

  it("imageGen falls back to preset images on failure", async () => {
    const { gw } = makeGateway({ image: { fail: true } });
    const img = await gw.imageGen({ kind: "img2img", source: "ref", count: 3 });
    expect(img.meta.degraded).toBe(true);
    expect(img.imageUrls.length).toBeGreaterThan(0);
  });
});

describe("AiGateway.extractMemory", () => {
  it("returns a memory whose key is declared by the lesson", async () => {
    const { gw } = makeGateway({}, { llmText: '{"key":"favorite_toy","value":"奥特曼"}' });
    const m = await gw.extractMemory({ transcript: "我喜欢奥特曼", allowedKeys: ["favorite_toy"], promptVersion: "memory_v1" });
    expect(m).toEqual({ key: "favorite_toy", value: "奥特曼" });
  });

  it("rejects a key the lesson did not declare (→ null)", async () => {
    const { gw, events } = makeGateway({}, { llmText: '{"key":"home_address","value":"x"}' });
    const m = await gw.extractMemory({ transcript: "...", allowedKeys: ["favorite_toy"], promptVersion: "memory_v1" });
    expect(m).toEqual({ key: null, value: null });
    expect(events.some((e) => (e.payload as { reason?: string }).reason === "memory_key_not_allowed")).toBe(true);
  });

  it("returns null on non-JSON output", async () => {
    const { gw } = makeGateway({}, { llmText: "不是 JSON" });
    const m = await gw.extractMemory({ transcript: "...", allowedKeys: ["favorite_toy"], promptVersion: "memory_v1" });
    expect(m).toEqual({ key: null, value: null });
  });

  it("skips the provider and returns null when the transcript is unsafe", async () => {
    let called = false;
    const provider = stub({ llm: async (r) => { called = true; return { capability: "llm", text: r.input, meta: { source: "primary", degraded: false } }; } });
    const { gw, events } = gatewayWith(provider);
    const m = await gw.extractMemory({ transcript: "讲点暴力的", allowedKeys: ["favorite_toy"], promptVersion: "memory_v1" });
    expect(m).toEqual({ key: null, value: null });
    expect(called).toBe(false);
    expect(events.some((e) => e.kind === "safety")).toBe(true);
  });
});

// --- hardened-boundary tests (Codex M2a findings 1,2,3,5) ---

function stub(over: Partial<ProviderAdapter>): ProviderAdapter {
  return {
    llm: async () => ({ capability: "llm", text: "ok", meta: { source: "primary", degraded: false } }),
    tts: async () => ({ capability: "tts", audioUrl: "u", meta: { source: "primary", degraded: false } }),
    asr: async () => ({ capability: "asr", transcript: "t", meta: { source: "primary", degraded: false } }),
    imageSubmit: async () => ({ jobId: "j" }),
    imagePoll: async () => ({ capability: "image_gen", imageUrls: ["a"], meta: { source: "primary", degraded: false } }),
    ...over,
  };
}

function gatewayWith(provider: ProviderAdapter, timeouts?: GatewayDeps["timeouts"]) {
  const events: TraceEvent[] = [];
  const trace: TraceSink = { record: (e) => events.push(e) };
  const deps: GatewayDeps = { provider, safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace, now: () => NOW, ...(timeouts ? { timeouts } : {}) };
  return { gw: new AiGateway(deps), events };
}

describe("AiGateway — hardened boundary", () => {
  it("never throws even when the TraceSink throws (trace is shadow)", async () => {
    const trace: TraceSink = { record: () => { throw new Error("sink down"); } };
    const deps: GatewayDeps = { provider: new FakeProvider({ llm: { fail: true } }), safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace, now: () => NOW };
    const gw = new AiGateway(deps);
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "你好" }); // hits fallback → emits trace (throws) → must still return
    expect(r.meta.degraded).toBe(true);
  });

  it("tts and asr fall back on provider failure", async () => {
    const { gw: g1 } = makeGateway({ tts: { fail: true } });
    expect((await g1.tts({ text: "hi" })).meta.degraded).toBe(true);
    const { gw: g2 } = makeGateway({ asr: { fail: true } });
    expect((await g2.asr({ audioRef: "ref" })).meta.degraded).toBe(true);
  });

  it("imageGen falls back when polling never completes (always pending)", async () => {
    const provider = stub({ imagePoll: async () => ({ status: "pending" }) });
    const { gw } = gatewayWith(provider, { image: 60 });
    const img = await gw.imageGen({ kind: "img2img", source: "ref", count: 3 });
    expect(img.meta.degraded).toBe(true);
  });

  it("falls back on a malformed provider result (schema miss)", async () => {
    const provider = stub({ llm: async () => ({ capability: "nope" } as unknown as Awaited<ReturnType<ProviderAdapter["llm"]>>) });
    const { gw } = gatewayWith(provider);
    const r = await gw.llm({ promptVersion: "icebreak_v1", input: "你好" });
    expect(r.meta.degraded).toBe(true);
  });

  it("tts/asr/imageGen fall back on a malformed provider result", async () => {
    const bad = { capability: "x" } as never;
    expect((await gatewayWith(stub({ tts: async () => bad })).gw.tts({ text: "h" })).meta.degraded).toBe(true);
    expect((await gatewayWith(stub({ asr: async () => bad })).gw.asr({ audioRef: "r" })).meta.degraded).toBe(true);
    expect((await gatewayWith(stub({ imagePoll: async () => bad })).gw.imageGen({ kind: "img2img", source: "r", count: 3 })).meta.degraded).toBe(true);
  });

  it("falls back on invalid AiMeta (bad source/degraded)", async () => {
    const provider = stub({ llm: async () => ({ capability: "llm", text: "x", meta: { source: "bogus", degraded: "no" } } as unknown as Awaited<ReturnType<ProviderAdapter["llm"]>>) });
    const r = await gatewayWith(provider).gw.llm({ promptVersion: "icebreak_v1", input: "你好" });
    expect(r.meta.degraded).toBe(true);
  });

  it("imageGen falls back when a single poll never settles", async () => {
    const provider = stub({ imagePoll: () => new Promise(() => {}) }); // never resolves
    const { gw } = gatewayWith(provider, { image: 60 });
    const img = await gw.imageGen({ kind: "img2img", source: "ref", count: 3 });
    expect(img.meta.degraded).toBe(true);
  });

  it("falls back when an injected image moderator blocks the result", async () => {
    const events: TraceEvent[] = [];
    const deps: GatewayDeps = { provider: new FakeProvider(), safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace: { record: (e) => events.push(e) }, now: () => NOW, imageModerator: async () => ({ ok: false, reasons: ["nsfw"] }) };
    const img = await new AiGateway(deps).imageGen({ kind: "img2img", source: "r", count: 3 });
    expect(img.meta.degraded).toBe(true);
    expect(events.some((e) => e.kind === "safety")).toBe(true);
  });
});

// --- brand style injection (docs/contracts/brand-style.md, P4 Step 1b) ---

import type { BrandStyleContract } from "@genius-x/contracts";
import type { ImageGenRequest } from "./providers/types";
import { BRAND_STYLE_V0 } from "./brand-style";

describe("brand style injection (brand-style.md)", () => {
  function brandGateway(brandStyle?: BrandStyleContract, failSubmit = false) {
    const submitted: ImageGenRequest[] = [];
    const provider = stub({
      imageSubmit: async (r: ImageGenRequest) => {
        submitted.push(r);
        if (failSubmit) throw new Error("provider down");
        return { jobId: "j" };
      },
    });
    const events: TraceEvent[] = [];
    const deps: GatewayDeps = {
      provider,
      safety: new KeywordSafetyFilter(),
      fallback: new PresetFallbackLibrary(),
      trace: { record: (e) => events.push(e) },
      now: () => NOW,
      ...(brandStyle && { brandStyle }),
    };
    return { gw: new AiGateway(deps), events, submitted };
  }

  it("text2img gets the versioned suffix appended; styleVersion stamped in ai_response", async () => {
    const { gw, events, submitted } = brandGateway(BRAND_STYLE_V0);
    await gw.imageGen({ kind: "text2img", source: "一只可爱的 尖耳 卡通动物角色", count: 3 });
    expect(submitted[0]!.source).toBe(`一只可爱的 尖耳 卡通动物角色，${BRAND_STYLE_V0.promptSuffix}`);
    const ok = events.find((e) => e.kind === "ai_response" && (e.payload as { capability?: string }).capability === "image_gen");
    expect((ok!.payload as { styleVersion?: string }).styleVersion).toBe("style-v0");
  });

  it("img2img source is untouched (no prompt to suffix) but stays brand-attributed in traces", async () => {
    const { gw, events, submitted } = brandGateway(BRAND_STYLE_V0);
    await gw.imageGen({ kind: "img2img", source: "ref://doodle", count: 3 });
    expect(submitted[0]!.source).toBe("ref://doodle"); // refs are not prompts
    const ok = events.find((e) => e.kind === "ai_response" && (e.payload as { capability?: string }).capability === "image_gen");
    expect((ok!.payload as { styleVersion?: string }).styleVersion).toBe("style-v0");
  });

  it("FALLBACK traces carry styleVersion too — degraded generations stay brand-attributed", async () => {
    const { gw, events } = brandGateway(BRAND_STYLE_V0, true);
    const img = await gw.imageGen({ kind: "text2img", source: "x", count: 3 });
    expect(img.meta.degraded).toBe(true);
    const fb = events.find((e) => e.kind === "fallback" && (e.payload as { capability?: string }).capability === "image_gen");
    expect((fb!.payload as { styleVersion?: string }).styleVersion).toBe("style-v0");
  });

  it("a gateway WITHOUT a brand contract traces brand_style_absent per call (loud, never silent)", async () => {
    const { gw, events, submitted } = brandGateway(undefined);
    await gw.imageGen({ kind: "text2img", source: "x", count: 3 });
    expect(submitted[0]!.source).toBe("x"); // unstyled — and the operator can see it:
    expect(events.some((e) => (e.payload as { note?: string }).note === "brand_style_absent")).toBe(true);
  });
});

describe("image pre-submit input review (brand-style.md / agent-context.md safety parity)", () => {
  it("an unsafe text2img source NEVER reaches the provider — fallback images + safety trace", async () => {
    let submitted = false;
    const provider = stub({ imageSubmit: async () => { submitted = true; return { jobId: "j" }; } });
    const events: TraceEvent[] = [];
    const gw = new AiGateway({ provider, safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace: { record: (e) => events.push(e) }, now: () => NOW, brandStyle: BRAND_STYLE_V0 });
    const img = await gw.imageGen({ kind: "text2img", source: "一个暴力的角色", count: 3 });
    expect(submitted).toBe(false); // blocked BEFORE submit
    expect(img.meta.degraded).toBe(true);
    expect(img.imageUrls.length).toBeGreaterThan(0); // the child still gets images
    expect(events.some((e) => e.kind === "safety" && (e.payload as { capability?: string }).capability === "image_gen")).toBe(true);
    const fb = events.find((e) => e.kind === "fallback" && (e.payload as { reason?: string }).reason === "input_filtered");
    expect((fb!.payload as { styleVersion?: string }).styleVersion).toBe("style-v0"); // brand-attributed degradation
  });

  it("img2img refs are NOT input-reviewed (refs are not prose) and still submit", async () => {
    let submitted = false;
    const provider = stub({ imageSubmit: async () => { submitted = true; return { jobId: "j" }; } });
    const gw = new AiGateway({ provider, safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace: { record: () => {} }, now: () => NOW, brandStyle: BRAND_STYLE_V0 });
    await gw.imageGen({ kind: "img2img", source: "ref://doodle-暴力", count: 3 }); // a ref CONTAINING a banned substring is still a ref
    expect(submitted).toBe(true);
  });

  it("a moderation-BLOCKED generation emits a brand-attributed fallback trace (image_moderation_failed)", async () => {
    const events: TraceEvent[] = [];
    const gw = new AiGateway({
      provider: stub({}),
      safety: new KeywordSafetyFilter(),
      fallback: new PresetFallbackLibrary(),
      trace: { record: (e) => events.push(e) },
      now: () => NOW,
      brandStyle: BRAND_STYLE_V0,
      imageModerator: async () => ({ ok: false, reasons: ["nsfw"] }),
    });
    const img = await gw.imageGen({ kind: "text2img", source: "正常的角色", count: 3 });
    expect(img.meta.degraded).toBe(true);
    const fb = events.find((e) => e.kind === "fallback" && (e.payload as { reason?: string }).reason === "image_moderation_failed");
    expect(fb).toBeDefined();
    expect((fb!.payload as { styleVersion?: string }).styleVersion).toBe("style-v0");
  });
});

// --- P4 Step 2: history extension + safety parity (agent-context.md) ---

import type { LlmRequest as LlmReq } from "./providers/types";

describe("LlmRequest.history (hot-path context)", () => {
  function capturing() {
    const seen: LlmReq[] = [];
    const provider = stub({
      llm: async (r: LlmReq) => { seen.push(r); return { capability: "llm", text: "回应", meta: { source: "primary", degraded: false } }; },
    });
    const { gw, events } = gatewayWith(provider);
    return { gw, events, seen };
  }

  it("history passes through to the provider; absent history = exactly the stateless call", async () => {
    const { gw, seen } = capturing();
    await gw.llm({ promptVersion: "talent_v1", input: "继续讲" });
    expect(seen[0]!.history).toBeUndefined();
    const history = [{ role: "child" as const, text: "我想要三条尾巴" }, { role: "companion" as const, text: "三条尾巴超酷的！" }];
    await gw.llm({ promptVersion: "talent_v1", input: "还要会飞", history });
    expect(seen[1]!.history).toEqual(history); // newest last, untouched
  });

  it("oversized history truncates oldest-first WITH a trace (never silent)", async () => {
    const { gw, events, seen } = capturing();
    const oversized = Array.from({ length: 20 }, (_, i) => ({ role: "child" as const, text: `第${i}句` }));
    await gw.llm({ promptVersion: "talent_v1", input: "x", history: oversized });
    expect(seen[0]!.history!.length).toBeLessThan(20);
    expect(seen[0]!.history![seen[0]!.history!.length - 1]!.text).toBe("第19句"); // newest kept
    const t = events.find((e) => (e.payload as { reason?: string }).reason === "history_truncated");
    expect(t).toBeDefined();
  });
});

describe("AiMeta.filtered (the buffering/recording signal)", () => {
  it("input-filtered fallback carries meta.filtered='input'", async () => {
    const { gw } = makeGateway();
    const r = await gw.llm({ promptVersion: "talent_v1", input: "讲点暴力的" });
    expect(r.meta.degraded).toBe(true);
    expect(r.meta.filtered).toBe("input");
  });

  it("output-filtered fallback carries meta.filtered='output'; plain failures carry NO filtered", async () => {
    const { gw } = makeGateway({ llm: { filteredOutput: true } });
    const r = await gw.llm({ promptVersion: "talent_v1", input: "正常输入" });
    expect(r.meta.filtered).toBe("output");
    const { gw: gw2 } = makeGateway({ llm: { fail: true } });
    const r2 = await gw2.llm({ promptVersion: "talent_v1", input: "正常输入" });
    expect(r2.meta.degraded).toBe(true);
    expect(r2.meta.filtered).toBeUndefined(); // provider failure ≠ safety filter
  });
});

describe("extractMemory output review (safety parity — the audit hole)", () => {
  it("a mined VALUE that trips the output filter is dropped + safety-traced, never returned", async () => {
    const { gw, events } = makeGateway({}, { llmText: '{"key":"favorite_toy","value":"特别暴力的玩具"}' });
    const m = await gw.extractMemory({ transcript: "正常的话", allowedKeys: ["favorite_toy"], promptVersion: "memory_v1" });
    expect(m).toEqual({ key: null, value: null });
    const t = events.find((e) => e.kind === "safety" && (e.payload as { stage?: string }).stage === "output");
    expect(t).toBeDefined();
  });
});

describe("llmHistory adapter capability (history_unsupported — loud, never silent)", () => {
  it("an adapter declaring 'unsupported' gets NO history; the strip is traced", async () => {
    const seen: LlmReq[] = [];
    const provider: ProviderAdapter = {
      llmHistory: "unsupported",
      ...stub({ llm: async (r: LlmReq) => { seen.push(r); return { capability: "llm", text: "ok", meta: { source: "primary", degraded: false } }; } }),
    };
    const { gw, events } = gatewayWith(provider);
    await gw.llm({ promptVersion: "talent_v1", input: "x", history: [{ role: "child", text: "上一句" }] });
    expect(seen[0]!.history).toBeUndefined(); // stripped
    const t = events.find((e) => (e.payload as { reason?: string }).reason === "history_unsupported");
    expect(t).toBeDefined();
    expect((t!.payload as { promptVersion?: string }).promptVersion).toBe("talent_v1"); // attributable
  });
});

describe("extractEpisode (end-of-scene consolidation — AI-first schema validation)", () => {
  const ROUNDS = [
    { role: "child" as const, text: "我想要三条尾巴" },
    { role: "companion" as const, text: "三条尾巴超酷的！" },
  ];

  it("returns a schema-valid episode and traces ai_response", async () => {
    const { gw, events } = makeGateway({}, { llmText: '{"summary":"孩子给朋友设计了三条尾巴","tags":["创作","尾巴"]}' });
    const ep = await gw.extractEpisode({ rounds: ROUNDS, promptVersion: "episode_v1" });
    expect(ep).toEqual({ summary: "孩子给朋友设计了三条尾巴", tags: ["创作", "尾巴"] });
    expect(events.some((e) => e.kind === "ai_response" && (e.payload as { capability?: string }).capability === "extract_episode")).toBe(true);
  });

  it("FakeProvider's scripted episode keeps demo consolidation valid without canned content", async () => {
    const { gw } = makeGateway();
    const ep = await gw.extractEpisode({ rounds: ROUNDS, promptVersion: "episode_v1" });
    expect(ep).not.toBeNull();
    expect(ep!.tags).toEqual(["fake"]);
  });

  it("schema violations are REJECTED with a trace — oversize is never silently truncated", async () => {
    const big = JSON.stringify({ summary: "长".repeat(600), tags: ["x"] });
    const { gw, events } = makeGateway({}, { llmText: big });
    expect(await gw.extractEpisode({ rounds: ROUNDS, promptVersion: "episode_v1" })).toBeNull();
    expect(events.some((e) => (e.payload as { reason?: string }).reason === "episode_schema_miss")).toBe(true);
    const { gw: gw2 } = makeGateway({}, { llmText: "不是 JSON" });
    expect(await gw2.extractEpisode({ rounds: ROUNDS, promptVersion: "episode_v1" })).toBeNull();
  });

  it("an unsafe SUMMARY is dropped + safety-traced (output parity)", async () => {
    const { gw, events } = makeGateway({}, { llmText: '{"summary":"特别暴力的一幕","tags":[]}' });
    expect(await gw.extractEpisode({ rounds: ROUNDS, promptVersion: "episode_v1" })).toBeNull();
    expect(events.some((e) => e.kind === "safety" && (e.payload as { stage?: string }).stage === "output")).toBe(true);
  });

  it("unsafe ROUNDS never reach the provider (input parity)", async () => {
    let called = false;
    const provider = stub({ llm: async () => { called = true; return { capability: "llm", text: "{}", meta: { source: "primary", degraded: false } }; } });
    const { gw, events } = gatewayWith(provider);
    expect(await gw.extractEpisode({ rounds: [{ role: "child", text: "讲点暴力的" }], promptVersion: "episode_v1" })).toBeNull();
    expect(called).toBe(false);
    expect(events.some((e) => e.kind === "safety" && (e.payload as { stage?: string }).stage === "input")).toBe(true);
  });
});

describe("LlmRequest.context (cold path — context_v1)", () => {
  it("context passes through to the provider; contextVersion stamped in ai_response", async () => {
    const seen: LlmReq[] = [];
    const provider = stub({ llm: async (r: LlmReq) => { seen.push(r); return { capability: "llm", text: "回应", meta: { source: "primary", degraded: false } }; } });
    const { gw, events } = gatewayWith(provider);
    await gw.llm({ promptVersion: "talent_v1", input: "继续", context: { version: "context_v1", text: "【你的伙伴设定】\n你的名字：小泥" } });
    expect(seen[0]!.context).toMatchObject({ version: "context_v1" });
    const ok = events.find((e) => e.kind === "ai_response");
    expect((ok!.payload as { contextVersion?: string }).contextVersion).toBe("context_v1");
  });

  it("a FILTERED context block is DROPPED (call proceeds context-less) + safety-traced — never fatal", async () => {
    const seen: LlmReq[] = [];
    const provider = stub({ llm: async (r: LlmReq) => { seen.push(r); return { capability: "llm", text: "回应", meta: { source: "primary", degraded: false } }; } });
    const { gw, events } = gatewayWith(provider);
    const r = await gw.llm({ promptVersion: "talent_v1", input: "正常输入", context: { version: "context_v1", text: "记得那段暴力的故事" } });
    expect(r.meta.degraded).toBe(false); // the call itself succeeded
    expect(seen[0]!.context).toBeUndefined(); // context dropped, not served
    const t = events.find((e) => e.kind === "safety" && (e.payload as { stage?: string }).stage === "context");
    expect(t).toBeDefined();
  });
});

describe("concurrency gate (DF-v2-19 — the class-burst floor)", () => {
  it("maxConcurrentCalls bounds in-flight provider calls; FIFO; queue waits traced", async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = stub({
      llm: async () => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 25));
        inFlight--;
        return { capability: "llm", text: "ok", meta: { source: "primary", degraded: false } };
      },
    });
    const events: TraceEvent[] = [];
    const gw = new AiGateway({
      provider, safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(),
      trace: { record: (e) => events.push(e) }, now: () => NOW,
      maxConcurrentCalls: 2, queueWaitTraceMs: 5,
    });
    await Promise.all(Array.from({ length: 6 }, (_, i) => gw.llm({ promptVersion: "talent_v1", input: `第${i}个` })));
    expect(peak).toBe(2); // never more than the gate
    expect(events.some((e) => (e.payload as { reason?: string }).reason === "gateway_queue_wait")).toBe(true); // pressure visible
  });

  it("no gate configured = exactly the old unbounded behavior", async () => {
    let peak = 0; let inFlight = 0;
    const provider = stub({
      llm: async () => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return { capability: "llm", text: "ok", meta: { source: "primary", degraded: false } };
      },
    });
    const { gw } = gatewayWith(provider);
    await Promise.all(Array.from({ length: 4 }, () => gw.llm({ promptVersion: "talent_v1", input: "x" })));
    expect(peak).toBe(4);
  });
});

describe("per-child fallback rotation (no duplicate 'personal' friends in degraded mode)", () => {
  it("different seeds yield different preset sets; same seed is deterministic; seedless = legacy", () => {
    const lib = new PresetFallbackLibrary();
    const a = lib.imageGen(3, "33333333-3333-4333-8333-000000000001").imageUrls;
    const b = lib.imageGen(3, "33333333-3333-4333-8333-000000000002").imageUrls;
    expect(a).not.toEqual(b); // two classmates: distinct friends
    expect(lib.imageGen(3, "33333333-3333-4333-8333-000000000001").imageUrls).toEqual(a); // deterministic
    expect(lib.imageGen(3).imageUrls).toEqual(["fallback://img/preset-0.png", "fallback://img/preset-1.png", "fallback://img/preset-2.png"]); // back-compat
  });

  it("a degraded image call serves the CHILD'S OWN rotation (seed threads end-to-end)", async () => {
    const { gw } = makeGateway({ image: { fail: true } });
    const a = await gw.imageGen({ kind: "img2img", source: "ref", count: 3, seed: "child-a" });
    const b = await gw.imageGen({ kind: "img2img", source: "ref", count: 3, seed: "child-b" });
    expect(a.meta.degraded).toBe(true);
    expect(a.imageUrls).not.toEqual(b.imageUrls);
  });
});
