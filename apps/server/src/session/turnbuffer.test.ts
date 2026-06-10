/**
 * TurnBufferStore — contract bounds (ROUNDS = child+companion pairs), key isolation,
 * drain-once, session sweep. Bounding is the SHARED pure boundTurnBuffer from
 * @genius-x/contracts (one algorithm for store + gateway), so testing it here covers both.
 */
import { describe, it, expect } from "vitest";
import {
  boundTurnBuffer,
  clampTurnText,
  TURN_BUFFER_MAX_ROUNDS,
  TURN_BUFFER_MAX_BYTES,
  TURN_ENTRY_MAX_BYTES,
  type TurnBufferEntry,
} from "@genius-x/contracts";
import { InMemoryTurnBufferStore } from "./turnbuffer";

const e = (role: "child" | "companion", text: string): TurnBufferEntry => ({ role, text });
const round = (i: number): TurnBufferEntry[] => [e("child", `问${i}`), e("companion", `答${i}`)];

describe("boundTurnBuffer (contract bounds — ROUNDS are pairs, not entries)", () => {
  it("keeps exactly TURN_BUFFER_MAX_ROUNDS full rounds; the N+1th round evicts the OLDEST round", () => {
    const nine = Array.from({ length: TURN_BUFFER_MAX_ROUNDS + 1 }, (_, i) => round(i)).flat(); // 9 rounds = 18 entries
    const { entries } = boundTurnBuffer(nine);
    expect(entries).toHaveLength(TURN_BUFFER_MAX_ROUNDS * 2); // 8 ROUNDS = 16 entries — the frozen depth
    expect(entries[0]).toEqual(e("child", "问1")); // round 0 evicted whole; head is a CHILD turn
    expect(entries[entries.length - 1]).toEqual(e("companion", `答${TURN_BUFFER_MAX_ROUNDS}`));
  });

  it("byte eviction re-aligns the head to a child turn (history never opens with an orphan reply)", () => {
    const fat = `内容${"很长".repeat(1500)}`; // ~6KB+ per entry after clamp interplay
    const mixed = [e("child", fat), e("companion", fat), e("child", fat), e("companion", fat), e("child", "短"), e("companion", "短答")];
    const { entries } = boundTurnBuffer(mixed);
    expect(Buffer.byteLength(JSON.stringify(entries))).toBeLessThanOrEqual(TURN_BUFFER_MAX_BYTES);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.role).toBe("child"); // never companion-first
  });

  it("a single oversized entry is CLAMPED (counted) — the byte bound cannot be bypassed", () => {
    const huge = e("child", "超".repeat(20_000)); // ~60KB CJK
    const { entries, clampedEntries } = boundTurnBuffer([huge]);
    expect(clampedEntries).toBe(1);
    expect(Buffer.byteLength(entries[0]!.text)).toBeLessThanOrEqual(TURN_ENTRY_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(entries))).toBeLessThanOrEqual(TURN_BUFFER_MAX_BYTES);
  });

  it("clampTurnText is byte-safe for CJK and reports clamped", () => {
    expect(clampTurnText("短句")).toEqual({ text: "短句", clamped: false });
    const c = clampTurnText("长".repeat(3000));
    expect(c.clamped).toBe(true);
    expect(Buffer.byteLength(c.text)).toBeLessThanOrEqual(TURN_ENTRY_MAX_BYTES);
  });
});

describe("InMemoryTurnBufferStore", () => {
  it("append/read roundtrip; keys are isolated per (session, student, stage)", async () => {
    const tb = new InMemoryTurnBufferStore();
    const k1 = { sessionId: "s1", studentId: "k1", stageId: "icebreak" };
    await tb.append(k1, e("child", "你好"));
    await tb.append(k1, e("companion", "你好呀！"));
    expect(await tb.read(k1)).toHaveLength(2);
    expect(await tb.read({ ...k1, studentId: "k2" })).toHaveLength(0); // other child: empty
    expect(await tb.read({ ...k1, stageId: "talent" })).toHaveLength(0); // other scene: empty
  });

  it("drain returns the buffer exactly once (consolidation semantics)", async () => {
    const tb = new InMemoryTurnBufferStore();
    const k = { sessionId: "s1", studentId: "k1", stageId: "talent" };
    await tb.append(k, e("child", "我会唱歌"));
    expect(await tb.drain(k)).toHaveLength(1);
    expect(await tb.drain(k)).toHaveLength(0); // second drain: empty
    expect(await tb.read(k)).toHaveLength(0);
  });

  it("clearSession sweeps ALL of one session's buffers and ONLY that session's", async () => {
    const tb = new InMemoryTurnBufferStore();
    await tb.append({ sessionId: "s1", studentId: "k1", stageId: "icebreak" }, e("child", "a"));
    await tb.append({ sessionId: "s1", studentId: "k2", stageId: "talent" }, e("child", "b"));
    await tb.append({ sessionId: "s2", studentId: "k1", stageId: "icebreak" }, e("child", "c"));
    await tb.clearSession("s1");
    expect(await tb.read({ sessionId: "s1", studentId: "k1", stageId: "icebreak" })).toHaveLength(0);
    expect(await tb.read({ sessionId: "s1", studentId: "k2", stageId: "talent" })).toHaveLength(0);
    expect(await tb.read({ sessionId: "s2", studentId: "k1", stageId: "icebreak" })).toHaveLength(1); // untouched
  });

  it("key components cannot collide via embedded delimiters (cross-child contamination guard)", async () => {
    const tb = new InMemoryTurnBufferStore();
    await tb.append({ sessionId: 's1","k1', studentId: "x", stageId: "g" }, e("child", "evil"));
    expect(await tb.read({ sessionId: "s1", studentId: 'k1","x', stageId: "g" })).toHaveLength(0);
  });
});
