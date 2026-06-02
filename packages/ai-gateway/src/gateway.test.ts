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
