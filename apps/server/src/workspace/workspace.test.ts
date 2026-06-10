/**
 * WorkspaceService tests — contract coverage against real Postgres semantics (PGlite +
 * migrations 001+002 via the production runner). Frozen contract: docs/contracts/workspace.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { InteractionContext, WorkMetadata } from "@genius-x/contracts";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService, WorkspaceServiceError } from "./service";

let ctx: IdentityTestContext;
let svc: WorkspaceService;
let tenant: string;
let studentId: string;
let otherStudentId: string;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };
const META: WorkMetadata = { lessonId: "lesson-001", stageId: "shape", sessionId: "s1", degraded: false };
const CTX: InteractionContext = { lessonId: "lesson-001", stageId: "talent", sessionId: "s1", initiatedBy: "student" };

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (err) {
    if (err instanceof WorkspaceServiceError) return err.code;
    throw err;
  }
}

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  svc = new WorkspaceService(ctx.sql);
  tenant = await ctx.makeTenant("工作区租户");
  const parentId = await ctx.makeParent(tenant);
  studentId = (await ctx.service.enrollStudent({ parentId, displayName: "作品娃", age: 7, consent: CONSENT_V1 })).id;
  otherStudentId = (await ctx.service.enrollStudent({ parentId, displayName: "邻居娃", age: 6, consent: CONSENT_V1 })).id;
});

describe("server-internal writes", () => {
  it("recordWork derives tenant from the student; round-trips via getWork", async () => {
    const work = await svc.recordWork({
      studentId,
      type: "avatar_image",
      contentUrl: "fake://avatar.png",
      metadata: { ...META, aiParams: { promptVersion: "image_v1" } },
    });
    expect(work.tenantId).toBe(tenant); // derived, never caller-supplied
    expect(work.metadata).toMatchObject({ lessonId: "lesson-001", stageId: "shape", degraded: false });
    expect(await svc.getWork(work.id)).toEqual(work);
  });

  it("rejects: empty works, oversized refs, undeclared vocabulary, unknown student", async () => {
    expect(await code(svc.recordWork({ studentId, type: "avatar_image", metadata: META }))).toBe("INVALID_INPUT"); // no content
    expect(
      await code(svc.recordWork({ studentId, type: "not_declared", contentText: "x", metadata: META }, { declaredArtifactTypes: ["birth_certificate"] })),
    ).toBe("INVALID_INPUT"); // vocabulary rejection (contract: write rejected)
    expect(
      await code(
        svc.recordInteraction({
          studentId,
          occurredAt: new Date().toISOString(),
          context: CTX,
          input: { kind: "voice", contentRef: "r".repeat(513) },
          output: { kind: "text", degraded: false },
        }),
      ),
    ).toBe("INVALID_INPUT"); // ref too large (refs never payloads)
    expect(
      await code(svc.recordWork({ studentId: "99999999-9999-4999-8999-999999999979", type: "t", contentText: "x", metadata: META })),
    ).toBe("STUDENT_NOT_FOUND");
  });

  it("recordMemory links itself into the source interaction's memoriesExtracted (atomic)", async () => {
    const interaction = await svc.recordInteraction({
      studentId,
      occurredAt: new Date().toISOString(),
      context: CTX,
      input: { kind: "voice", contentRef: "audio-ref-1", text: "我最喜欢积木" },
      output: { kind: "text", text: "积木真好玩呀！", degraded: false },
    });
    expect(interaction.memoriesExtracted).toEqual([]);

    const memory = await svc.recordMemory(
      { studentId, key: "favorite_toy", value: "积木", context: { ...CTX, sourceInteractionId: interaction.id } },
      { declaredMemoryKeys: ["favorite_toy", "favorite_animal"] },
    );
    expect(memory.importance).toBe(0.5); // baseline (Phase 4 scores)

    const after = await svc.listInteractions(studentId, { limit: 50 });
    const linked = after.interactions.find((i) => i.id === interaction.id);
    expect(linked?.memoriesExtracted).toEqual([memory.id]); // the contract's update path
  });

  it("rejects undeclared memory keys when the lesson vocabulary is provided", async () => {
    expect(
      await code(
        svc.recordMemory(
          { studentId, key: "shoe_size", value: "30", context: CTX },
          { declaredMemoryKeys: ["favorite_toy"] },
        ),
      ),
    ).toBe("INVALID_INPUT");
  });
});

describe("reads (the HTTP surface semantics)", () => {
  it("summary counts + lastActivityAt; unknown student → STUDENT_NOT_FOUND", async () => {
    const summary = await svc.getWorkspaceSummary(studentId);
    expect(summary).toMatchObject({ studentId, tenantId: tenant });
    expect(summary.workCount).toBeGreaterThanOrEqual(1);
    expect(summary.interactionCount).toBeGreaterThanOrEqual(1);
    expect(summary.memoryCount).toBeGreaterThanOrEqual(1);
    expect(summary.lastActivityAt).toBeDefined();

    const empty = await svc.getWorkspaceSummary(otherStudentId);
    expect(empty).toMatchObject({ workCount: 0, interactionCount: 0, memoryCount: 0 });
    expect(empty.lastActivityAt).toBeUndefined();

    expect(await code(svc.getWorkspaceSummary("99999999-9999-4999-8999-999999999978"))).toBe("STUDENT_NOT_FOUND");
    expect(await code(svc.getWork("99999999-9999-4999-8999-999999999977"))).toBe("WORK_NOT_FOUND");
  });

  it("works list is RECENCY-first and pages stably (no dupes/gaps) under same-timestamp rows", async () => {
    for (let i = 0; i < 5; i++) {
      await svc.recordWork({ studentId: otherStudentId, type: "doodle", contentText: `画${i}`, metadata: META });
    }
    const page1 = await svc.listWorks(otherStudentId, { limit: 2 });
    expect(page1.works).toHaveLength(2);
    const page2 = await svc.listWorks(otherStudentId, { limit: 2, cursor: page1.nextCursor! });
    const page3 = await svc.listWorks(otherStudentId, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.works).toHaveLength(1);
    expect(page3.nextCursor).toBeUndefined();
    const all = [...page1.works, ...page2.works, ...page3.works];
    expect(new Set(all.map((w) => w.id)).size).toBe(5); // no dupes, no gaps
    // recency-first: each page's createdAt is non-increasing
    const times = all.map((w) => Date.parse(w.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("memories list is IMPORTANCE-first and pages across equal importances", async () => {
    await svc.recordMemory({ studentId: otherStudentId, key: "k1", value: "v1", context: CTX, importance: 0.9 });
    await svc.recordMemory({ studentId: otherStudentId, key: "k2", value: "v2", context: CTX, importance: 0.2 });
    await svc.recordMemory({ studentId: otherStudentId, key: "k3", value: "v3", context: CTX, importance: 0.9 });
    const page1 = await svc.listMemories(otherStudentId, { limit: 2 });
    expect(page1.memories.map((m) => m.importance)).toEqual([0.9, 0.9]);
    const page2 = await svc.listMemories(otherStudentId, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.memories[0]!.importance).toBe(0.2);
    const ids = [...page1.memories, ...page2.memories].map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("rejects malformed cursors and non-positive limits", async () => {
    expect(await code(svc.listWorks(studentId, { cursor: "!!!" }))).toBe("INVALID_INPUT");
    expect(await code(svc.listWorks(studentId, { limit: 0 }))).toBe("INVALID_INPUT");
    expect(await code(svc.listMemories(studentId, { cursor: "AAAA" }))).toBe("INVALID_INPUT");
  });
});

describe("review mandates (cross-student pointers + blob bounds)", () => {
  it("recordMemory with ANOTHER student's interaction → typed INVALID_INPUT (never a cross link)", async () => {
    const foreign = await svc.recordInteraction({
      studentId: otherStudentId,
      occurredAt: new Date().toISOString(),
      context: CTX,
      input: { kind: "voice", contentRef: "ref-x" },
      output: { kind: "text", degraded: false },
    });
    expect(
      await code(
        svc.recordMemory({ studentId, key: "k9", value: "v9", context: { ...CTX, sourceInteractionId: foreign.id } }),
      ),
    ).toBe("INVALID_INPUT");
    // and the foreign interaction's array stayed untouched
    const after = await svc.listInteractions(otherStudentId, { limit: 50 });
    expect(after.interactions.find((i) => i.id === foreign.id)?.memoriesExtracted).toEqual([]);
  });

  it("rejects oversized contentJson / aiParams at the service boundary (typed, pre-DB)", async () => {
    expect(
      await code(
        svc.recordWork({ studentId, type: "t", contentJson: { blob: "x".repeat(70000) }, metadata: META }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await code(
        svc.recordWork({
          studentId,
          type: "t",
          contentText: "ok",
          metadata: { ...META, aiParams: { dump: "y".repeat(20000) } },
        }),
      ),
    ).toBe("INVALID_INPUT");
  });
});

describe("microsecond cursor precision (round-2 review: real-PG row skips)", () => {
  it("pages WITHOUT losing rows whose created_at differs only in microseconds", async () => {
    const parentId = await ctx.makeParent(tenant);
    const kid = (await ctx.service.enrollStudent({ parentId, displayName: "微秒娃", age: 7, consent: CONSENT_V1 })).id;
    // Insert with EXPLICIT microsecond timestamps (PGlite's NOW() is ms-aligned and masks this).
    const times = ["2026-06-09T10:00:00.123456Z", "2026-06-09T10:00:00.123400Z", "2026-06-09T10:00:00.123300Z", "2026-06-09T10:00:00.122000Z"];
    for (const [i, t] of times.entries()) {
      await ctx.sql.query(
        `INSERT INTO works (student_id, tenant_id, type, content_text, lesson_id, stage_id, degraded, created_at)
         SELECT s.id, s.tenant_id, 't', $2, 'lesson-001', 'shape', false, $3::timestamptz FROM students s WHERE s.id = $1`,
        [kid, `w${i}`, t],
      );
    }
    const page1 = await svc.listWorks(kid, { limit: 2 });
    const page2 = await svc.listWorks(kid, { limit: 2, cursor: page1.nextCursor! });
    const all = [...page1.works, ...page2.works];
    expect(all).toHaveLength(4); // NO silent skip across the microsecond boundary
    expect(new Set(all.map((w) => w.contentText)).size).toBe(4);
  });
});
