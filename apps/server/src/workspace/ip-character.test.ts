/**
 * IpCharacterService — the layered entity's pins (ip-character.md v1, Phase 4.5):
 * v1 birth snapshot (partial-backfill signal), refinement = version bump + immutable
 * snapshot, NO-OP idempotency (retries never grow the parent-facing timeline), the
 * pinned mirror projection, contract preflights. PGlite + migrations 001-005.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService } from "./service";
import { IpCharacterService, BASE_CANON_V0 } from "./ip-character";

let ctx: IdentityTestContext;
let svc: IpCharacterService;
let workspace: WorkspaceService;
let tenant: string;
let studentId: string;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };
const BY = { lessonId: "lesson-001", sessionId: "s1", stageId: "birth" };

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  svc = new IpCharacterService(ctx.sql);
  workspace = new WorkspaceService(ctx.sql);
  tenant = await ctx.makeTenant("IP租户");
  const parentId = await ctx.makeParent(tenant);
  studentId = (await ctx.service.enrollStudent({ parentId, displayName: "形象娃", age: 7, consent: CONSENT_V1 })).id;
});

describe("birth snapshot (version 1)", () => {
  it("creates v1 with the locked base canon + the snapshot row; partial when no appearance", async () => {
    const r = await svc.recordLessonOutcome(studentId, { name: "小泥", personality: "勇敢" }, BY);
    expect(r.kind).toBe("created");
    if (r.kind === "created") expect(r.partialBackfill).toBe(true); // no appearanceRef yet
    expect(r.character.version).toBe(1);
    expect(r.character.baseCanon).toEqual(BASE_CANON_V0); // the LOCKED layer
    const snap = await ctx.sql.query("SELECT version FROM ip_character_versions WHERE student_id = $1", [studentId]);
    expect(snap.rows).toHaveLength(1);
  });

  it("MIRROR: projected genius_x columns replaced from the canonical surface", async () => {
    const student = await ctx.service.getStudent(studentId);
    expect(student!.geniusX.name).toBe("小泥");
    expect(student!.geniusX.personalityTag).toBe("勇敢");
  });
});

describe("refinement (the growth timeline)", () => {
  it("a CHANGED surface bumps the version and snapshots it; base canon untouched", async () => {
    const work = await workspace.recordWork({
      studentId, type: "avatar_image", contentUrl: "cos://ip/avatar-v2.png",
      metadata: { lessonId: "lesson-002", stageId: "shape", degraded: false },
    });
    const r = await svc.recordLessonOutcome(studentId, { appearanceRef: work.id, backstory: "来自彩虹城堡" }, { ...BY, lessonId: "lesson-002" });
    expect(r.kind).toBe("refined");
    expect(r.character.version).toBe(2);
    expect(r.character.surface.name).toBe("小泥"); // earlier surface persists under the merge
    expect(r.character.baseCanon).toEqual(BASE_CANON_V0);
    // mirror resolves appearanceRef → the WORK's contentUrl (not the ref)
    const student = await ctx.service.getStudent(studentId);
    expect(student!.geniusX.avatarUrl).toBe("cos://ip/avatar-v2.png");
    expect(student!.geniusX.backgroundSetting).toBe("来自彩虹城堡");
  });

  it("IDEMPOTENT: an identical outcome is a NO-OP — the timeline never grows from a retry", async () => {
    const before = await svc.getCharacter(studentId);
    const r = await svc.recordLessonOutcome(studentId, { name: "小泥", backstory: "来自彩虹城堡" }, BY);
    expect(r.kind).toBe("noop");
    expect(r.character.version).toBe(before!.version);
    const snaps = await ctx.sql.query("SELECT COUNT(*)::int AS n FROM ip_character_versions WHERE student_id = $1", [studentId]);
    expect((snaps.rows[0] as { n: number }).n).toBe(before!.version); // contiguous, no extra row
  });

  it("EMPTY-STRING fields never erase canon (a degraded lesson is not an eraser)", async () => {
    const r = await svc.recordLessonOutcome(studentId, { name: "", personality: "" }, BY);
    expect(r.kind).toBe("noop"); // nothing real changed
    expect((await svc.getCharacter(studentId))!.surface.name).toBe("小泥");
  });
});

describe("contract preflights (ip-character.md Validation)", () => {
  it("contiguity + adjacent-identical + tenant isolation all hold (expect 0s)", async () => {
    const q = async (sql: string): Promise<number> => {
      const r = await ctx.sql.query(sql);
      return Number((r.rows[0] as { count: string | number }).count);
    };
    expect(await q(`SELECT COUNT(*) FROM ip_characters c WHERE NOT EXISTS
      (SELECT 1 FROM ip_character_versions v WHERE v.student_id = c.student_id AND v.version = c.version)`)).toBe(0);
    expect(await q(`SELECT COUNT(*) FROM ip_characters c WHERE
      (SELECT COUNT(*) FROM ip_character_versions v WHERE v.student_id = c.student_id) != c.version`)).toBe(0);
    expect(await q(`SELECT COUNT(*) FROM ip_character_versions a JOIN ip_character_versions b
      ON a.student_id = b.student_id AND b.version = a.version + 1
      WHERE a.base_canon = b.base_canon AND a.surface = b.surface`)).toBe(0);
    expect(await q(`SELECT COUNT(*) FROM ip_character_versions v JOIN students s ON s.id = v.student_id
      WHERE v.tenant_id != s.tenant_id`)).toBe(0);
  });

  it("rejects unknown students (FK) and oversized surface fields (caps)", async () => {
    await expect(svc.recordLessonOutcome("99999999-9999-4999-8999-999999999970", { name: "x" }, BY))
      .rejects.toMatchObject({ code: "STUDENT_NOT_FOUND" });
    await expect(svc.recordLessonOutcome(studentId, { personality: "长".repeat(600) }, BY))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("pointer discipline + mirror healing (P4.5-A review fixes)", () => {
  it("REJECTS a cross-student appearanceRef (same-student pointer discipline)", async () => {
    const parentId = await ctx.makeParent(tenant);
    const other = (await ctx.service.enrollStudent({ parentId, displayName: "别家娃", age: 7, consent: CONSENT_V1 })).id;
    const foreignWork = await workspace.recordWork({
      studentId: other, type: "avatar_image", contentUrl: "cos://other/a.png",
      metadata: { lessonId: "lesson-002", stageId: "shape", degraded: false },
    });
    await expect(svc.recordLessonOutcome(studentId, { appearanceRef: foreignWork.id }, BY))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("REJECTS a non-UUID appearanceRef BEFORE any write (no poisoned snapshots)", async () => {
    const before = await svc.getCharacter(studentId);
    await expect(svc.recordLessonOutcome(studentId, { appearanceRef: "not-a-uuid" }, BY))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await svc.getCharacter(studentId))!.version).toBe(before!.version); // nothing committed
  });

  it("a NO-OP re-run HEALS a stale mirror (the contract's recovery path)", async () => {
    // sabotage the mirror out-of-band (simulating a crash between write and mirror)
    await ctx.sql.query("UPDATE students SET genius_x_name = '坏掉的名字' WHERE id = $1", [studentId]);
    const r = await svc.recordLessonOutcome(studentId, { name: "小泥" }, BY); // identical surface
    expect(r.kind).toBe("noop");
    const student = await ctx.service.getStudent(studentId);
    expect(student!.geniusX.name).toBe("小泥"); // healed
  });

  it("legacy avatar URL is PRESERVED when the surface carries no appearanceRef", async () => {
    const parentId = await ctx.makeParent(tenant);
    const legacy = (await ctx.service.enrollStudent({ parentId, displayName: "老档案娃", age: 8, consent: CONSENT_V1 })).id;
    // pre-4.5 state: profile avatar URL exists but NO avatar_image work (the tolerated failure mode)
    await ctx.sql.query("UPDATE students SET genius_x_avatar_url = 'cos://legacy/avatar.png' WHERE id = $1", [legacy]);
    const r = await svc.recordLessonOutcome(legacy, { name: "新朋友" }, BY);
    expect(r.kind).toBe("created");
    const student = await ctx.service.getStudent(legacy);
    expect(student!.geniusX.avatarUrl).toBe("cos://legacy/avatar.png"); // NOT erased
    expect(student!.geniusX.name).toBe("新朋友"); // other projections replaced
  });
});
