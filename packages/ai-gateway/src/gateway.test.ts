import { describe, it, expect } from "vitest";
import type { TraceEvent, TraceSink } from "@genius-x/contracts";
import { AiGateway, type GatewayDeps } from "./gateway";
import { KeywordSafetyFilter } from "./safety";
import { PresetFallbackLibrary } from "./fallback";
import { FakeProvider, type FakeContent } from "./providers/fake";
import type { FakeProviderConfig } from "./providers/types";

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
});
