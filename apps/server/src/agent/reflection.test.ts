/**
 * ReflectionService (L1, workspace.md v1.3) — pins: deterministic diary from the
 * session's episodes, idempotency per (student, lesson), honest absence (no episodes ⇒
 * no diary), defensive safety, the closed trace causes, and the cold-context exclusion
 * (a diary must NEVER leak into the semantic block). PGlite + 001-008.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { TraceEvent } from "@genius-x/contracts";
import { DIARY_MEMORY_KEY, EPISODE_MEMORY_KEY, parseDiaryValue } from "@genius-x/contracts";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService } from "../workspace/service";
import { ReflectionService } from "./reflection";

const traced: TraceEvent[] = [];
let ctx: IdentityTestContext;
let workspace: WorkspaceService;
let svc: ReflectionService;
let kidA: string;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };

async function addEpisode(studentId: string, sessionId: string, summary: string): Promise<void> {
  await workspace.recordMemory({
    studentId,
    key: EPISODE_MEMORY_KEY,
    value: JSON.stringify({ summary, tags: [] }),
    context: { lessonId: "lesson-001", stageId: "talent", sessionId },
  });
}

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  workspace = new WorkspaceService(ctx.sql);
  svc = new ReflectionService(workspace, { record: (e) => traced.push(e) });
  const tenant = await ctx.makeTenant("反思租户");
  const parent = await ctx.makeParent(tenant);
  kidA = (await ctx.service.enrollStudent({ parentId: parent, displayName: "反思娃", age: 7, consent: CONSENT_V1 })).id;
});

describe("the deterministic diary (honest tier)", () => {
  it("composes ONE entry from the session's episodes + works count; schema-valid; traced", async () => {
    await addEpisode(kidA, "s1", "我们一起画了一只蓝色的海豚");
    await addEpisode(kidA, "s1", "你给我讲了海底的故事");
    await workspace.recordWork({ studentId: kidA, type: "avatar_image", contentUrl: "fake://a.png", metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false } });
    expect(await svc.reflectOnLesson(kidA, "lesson-001", "s1")).toBe(true);

    const entries = await workspace.listDiaryEntries(kidA, 10);
    expect(entries).toHaveLength(1);
    const d = parseDiaryValue(entries[0]!.value)!;
    expect(d.summary).toContain("我们一起画了一只蓝色的海豚");
    expect(d.summary).toContain("然后");
    expect(d.summary).toContain("1件小东西");
    expect(d).toMatchObject({ lessonId: "lesson-001", madeCount: 1 });
    expect(traced.some((e) => e.payload.reason === "reflection_written")).toBe(true);
  });

  it("IDEMPOTENT per (student, lesson): a re-run no-ops with the contract cause", async () => {
    expect(await svc.reflectOnLesson(kidA, "lesson-001", "s1")).toBe(false);
    expect((await workspace.listDiaryEntries(kidA, 10))).toHaveLength(1);
    expect(traced.some((e) => e.payload.reason === "reflection_skipped" && e.payload.cause === "already_written")).toBe(true);
  });

  it("no episodes ⇒ NO diary (honest absence, never fabricated), traced", async () => {
    expect(await svc.reflectOnLesson(kidA, "lesson-002", "s2")).toBe(false);
    expect(traced.some((e) => e.payload.reason === "reflection_skipped" && e.payload.cause === "no_episodes")).toBe(true);
  });

  it("the diary NEVER leaks into the semantic cold block (workspace.md v1.3 exclusion)", async () => {
    const r = await workspace.retrieveContextMemories(kidA, { semanticTopK: 12, episodeTopK: 3 });
    expect(r.semantic.some((m) => m.key === DIARY_MEMORY_KEY)).toBe(false);
    expect(r.episodes.every((m) => m.key === EPISODE_MEMORY_KEY)).toBe(true);
  });

  it("CONCURRENT reflections cannot duplicate (DB backstop — migration 009 unique index)", async () => {
    const kidB = (await ctx.service.enrollStudent({ parentId: (await ctx.makeParent(await ctx.makeTenant("并发租户"))), displayName: "并发娃", age: 7, consent: CONSENT_V1 })).id;
    await addEpisode(kidB, "s7", "我们一起搭了一座桥");
    const [a, b] = await Promise.all([
      svc.reflectOnLesson(kidB, "lesson-007", "s7"),
      svc.reflectOnLesson(kidB, "lesson-007", "s7"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one wins
    expect(await workspace.listDiaryEntries(kidB, 10)).toHaveLength(1);
  });

  it("truncation is sentence-bounded + COUNTED; trailing punctuation never doubles; madeCount is the CURATED count", async () => {
    const kidC = (await ctx.service.enrollStudent({ parentId: (await ctx.makeParent(await ctx.makeTenant("截断租户"))), displayName: "截断娃", age: 8, consent: CONSENT_V1 })).id;
    await addEpisode(kidC, "s8", `${"我们一起做了一件很长很长的事".repeat(30)}。`); // punctuated, ~420 chars (≤ episode cap 500)
    await addEpisode(kidC, "s8", `${"然后又做了另一件很长的事".repeat(30)}！`); // composed total > 600 ⇒ truncation fires
    // two drafts of ONE type ⇒ curated count = 1, never 2
    await workspace.recordWork({ studentId: kidC, type: "avatar_image", contentUrl: "fake://1.png", metadata: { lessonId: "lesson-008", stageId: "shape", degraded: false } });
    await workspace.recordWork({ studentId: kidC, type: "avatar_image", contentUrl: "fake://2.png", metadata: { lessonId: "lesson-008", stageId: "shape", degraded: false } });
    expect(await svc.reflectOnLesson(kidC, "lesson-008", "s8")).toBe(true);
    const d = parseDiaryValue((await workspace.listDiaryEntries(kidC, 1))[0]!.value)!;
    expect(d.summary.length).toBeLessThanOrEqual(600);
    expect(d.summary).not.toContain("。；"); // stripped punctuation never doubles at joins
    expect(d.summary.endsWith("。") || d.summary.endsWith("…")).toBe(true); // sentence-bounded cut
    expect(d.madeCount).toBe(1); // distinct types, not raw rows
    expect(traced.some((e) => e.payload.reason === "reflection_truncated")).toBe(true);
  });

  it("direct diary writes must be schema-valid (lesson-declaration rejection is pinned in validate.test.ts)", async () => {
    await expect(
      workspace.recordMemory({
        studentId: kidA, key: DIARY_MEMORY_KEY, value: "not json",
        context: { lessonId: "lesson-009", stageId: "x", sessionId: "s9" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
