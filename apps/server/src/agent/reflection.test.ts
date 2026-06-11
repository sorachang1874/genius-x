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

  it("lessons can never DECLARE self_narrative; direct writes must be schema-valid", async () => {
    await expect(
      workspace.recordMemory({
        studentId: kidA, key: DIARY_MEMORY_KEY, value: "not json",
        context: { lessonId: "lesson-009", stageId: "x", sessionId: "s9" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
