/**
 * IdentityService unit tests — per-method contract coverage against real Postgres semantics
 * (PGlite + the real migration via the production runner). Frozen contracts:
 * docs/contracts/identity.md + enrollment.md.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { IdentityService, IdentityServiceError, IDENTITY_ERROR_STATUS } from "./service";
import { newIdentityTestContext, type IdentityTestContext } from "./identity.testutil";

let ctx: IdentityTestContext;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  tenantA = await ctx.makeTenant("租户A");
  tenantB = await ctx.makeTenant("租户B");
});

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (err) {
    if (err instanceof IdentityServiceError) return err.code;
    throw err;
  }
}

describe("error registry", () => {
  it("IdentityServiceError maps codes to the contract HTTP statuses", () => {
    expect(new IdentityServiceError("STUDENT_NOT_FOUND").httpStatus).toBe(404);
    expect(new IdentityServiceError("TENANT_MISMATCH").httpStatus).toBe(403);
    expect(new IdentityServiceError("INVALID_AGE").httpStatus).toBe(400);
    expect(new IdentityServiceError("PARENT_ALREADY_EXISTS").httpStatus).toBe(409);
    expect(IDENTITY_ERROR_STATUS.CONSENT_REQUIRED).toBe(400); // exhaustive map (typechecked)
  });

  it("toResponse carries code + operator detail (never child-facing)", () => {
    const err = new IdentityServiceError("INVALID_AGE", "age must be an integer in 4-10, got 3");
    expect(err.toResponse()).toEqual({ error: "INVALID_AGE", detail: "age must be an integer in 4-10, got 3" });
  });
});

describe("createParent (idempotent create-or-return)", () => {
  it("creates a parent (created=true)", async () => {
    const res = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613900000001" });
    expect(res.created).toBe(true);
    expect(res.tenantId).toBe(tenantA);
    expect(res.parentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("plain duplicate phone returns the EXISTING parent (created=false, same id)", async () => {
    const first = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613900000002" });
    const second = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613900000002" });
    expect(second.created).toBe(false);
    expect(second.parentId).toBe(first.parentId);
  });

  it("plain duplicate wechat returns the existing parent", async () => {
    const first = await ctx.service.createParent({ tenantId: tenantA, wechatOpenId: "wx_u1" });
    const second = await ctx.service.createParent({ tenantId: tenantA, wechatOpenId: "wx_u1" });
    expect(second).toMatchObject({ parentId: first.parentId, created: false });
  });

  it("the same phone in ANOTHER tenant is a fresh parent (tenant-scoped idempotency)", async () => {
    const a = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613900000003" });
    const b = await ctx.service.createParent({ tenantId: tenantB, phoneNumber: "+8613900000003" });
    expect(b.created).toBe(true);
    expect(b.parentId).not.toBe(a.parentId);
  });

  it("AMBIGUOUS conflict (phone→parent1, wechat→parent2) → 409 PARENT_ALREADY_EXISTS", async () => {
    const p1 = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613900000004" });
    const p2 = await ctx.service.createParent({ tenantId: tenantA, wechatOpenId: "wx_u2" });
    expect(p1.parentId).not.toBe(p2.parentId);
    expect(
      await code(ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613900000004", wechatOpenId: "wx_u2" })),
    ).toBe("PARENT_ALREADY_EXISTS");
  });

  it("no identifiers → always a fresh parent (no idempotency key)", async () => {
    const a = await ctx.service.createParent({ tenantId: tenantA });
    const b = await ctx.service.createParent({ tenantId: tenantA });
    expect(a.created && b.created).toBe(true);
    expect(a.parentId).not.toBe(b.parentId);
  });

  it("unknown tenant → TENANT_NOT_FOUND; bad uuid / empty identifier → INVALID_INPUT", async () => {
    expect(await code(ctx.service.createParent({ tenantId: "99999999-9999-4999-8999-999999999998" }))).toBe(
      "TENANT_NOT_FOUND",
    );
    expect(await code(ctx.service.createParent({ tenantId: "not-a-uuid" }))).toBe("INVALID_INPUT");
    expect(await code(ctx.service.createParent({ tenantId: tenantA, phoneNumber: "" }))).toBe("INVALID_INPUT");
  });
});

describe("enrollStudent (atomic student + consent)", () => {
  it("enrolls and returns the full Student; tenant derives from parent; consent row created", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const student = await ctx.service.enrollStudent({
      parentId,
      displayName: "  小测 ", // trimmed
      age: 7,
      consent: { ...CONSENT_V1, parentCoWorkAllowed: true },
    });
    expect(student).toMatchObject({
      tenantId: tenantA,
      parentId,
      displayName: "小测",
      age: 7,
      geniusX: {},
      progress: { completedLessonIds: [], currentPhase: 1, badges: [] },
    });
    expect(student.enrolledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const consent = await ctx.sql.query("SELECT * FROM guardian_consents WHERE student_id = $1", [student.id]);
    expect(consent.rows).toHaveLength(1);
    expect(consent.rows[0]).toMatchObject({
      parent_id: parentId,
      consent_version: "v1.0",
      data_retention_agreed: true,
      parent_co_work_allowed: true,
      media_usage_allowed: false, // defaulted false when absent
    });
  });

  it("unknown parent → PARENT_NOT_FOUND (and no orphan rows left behind)", async () => {
    expect(
      await code(
        ctx.service.enrollStudent({
          parentId: "99999999-9999-4999-8999-999999999997",
          displayName: "无主",
          age: 7,
          consent: CONSENT_V1,
        }),
      ),
    ).toBe("PARENT_NOT_FOUND");
    const orphans = await ctx.sql.query("SELECT 1 FROM students WHERE display_name = '无主'");
    expect(orphans.rows).toHaveLength(0);
  });

  it("age out of range / non-integer → INVALID_AGE (service-level, before the DB)", async () => {
    const parentId = await ctx.makeParent(tenantA);
    for (const age of [3, 11, 6.5]) {
      expect(
        await code(ctx.service.enrollStudent({ parentId, displayName: "年龄", age, consent: CONSENT_V1 })),
      ).toBe("INVALID_AGE");
    }
  });

  it("blank name → INVALID_INPUT; retention not agreed / missing consent → CONSENT_REQUIRED; bad version → INVALID_INPUT", async () => {
    const parentId = await ctx.makeParent(tenantA);
    expect(await code(ctx.service.enrollStudent({ parentId, displayName: "   ", age: 7, consent: CONSENT_V1 }))).toBe(
      "INVALID_INPUT",
    );
    expect(
      await code(
        ctx.service.enrollStudent({
          parentId,
          displayName: "未同意",
          age: 7,
          consent: { consentVersion: "v1.0", dataRetentionAgreed: false },
        }),
      ),
    ).toBe("CONSENT_REQUIRED");
    expect(
      await code(
        ctx.service.enrollStudent({
          parentId,
          displayName: "无版本",
          age: 7,
          consent: { consentVersion: "1.0", dataRetentionAgreed: true },
        }),
      ),
    ).toBe("INVALID_INPUT");
  });

  it("a parent can enroll multiple students (contract-legal)", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s1 = await ctx.service.enrollStudent({ parentId, displayName: "老大", age: 8, consent: CONSENT_V1 });
    const s2 = await ctx.service.enrollStudent({ parentId, displayName: "老二", age: 5, consent: CONSENT_V1 });
    expect(s1.id).not.toBe(s2.id);
    expect(s1.parentId).toBe(s2.parentId);
  });
});

describe("getStudent", () => {
  it("round-trips an enrolled student; absent → null; bad uuid → INVALID_INPUT", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const enrolled = await ctx.service.enrollStudent({ parentId, displayName: "查询", age: 6, consent: CONSENT_V1 });
    const fetched = await ctx.service.getStudent(enrolled.id);
    expect(fetched).toEqual(enrolled);
    expect(await ctx.service.getStudent("99999999-9999-4999-8999-999999999996")).toBeNull();
    expect(await code(ctx.service.getStudent("nope"))).toBe("INVALID_INPUT");
  });
});

describe("updateStudent (parent-facing allowlist)", () => {
  it("updates displayName and age; bumps updatedAt (app-managed NOW()); leaves server-owned fields alone", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "改名前", age: 6, consent: CONSENT_V1 });
    // Backdate so a dropped `updated_at = NOW()` clause FAILS (>= would pass on equality).
    await ctx.sql.query("UPDATE students SET updated_at = '2000-01-01' WHERE id = $1", [s.id]);
    const updated = await ctx.service.updateStudent(s.id, { displayName: "改名后", age: 7 });
    expect(updated).toMatchObject({ id: s.id, displayName: "改名后", age: 7 });
    expect(updated.geniusX).toEqual(s.geniusX);
    expect(updated.progress).toEqual(s.progress);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse("2000-01-02"));
  });

  it("strictly bumps updatedAt on applyProgressUpdate too (same app-managed convention)", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "时钟", age: 6, consent: CONSENT_V1 });
    await ctx.sql.query("UPDATE students SET updated_at = '2000-01-01' WHERE id = $1", [s.id]);
    const updated = await ctx.service.applyProgressUpdate(s.id, { progress: { badges: ["b"] } });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse("2000-01-02"));
  });

  it("PRIVILEGE BOUNDARY: smuggled geniusX/progress keys are ignored (route zod must reject; service never reads them)", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "防越权", age: 6, consent: CONSENT_V1 });
    const hostile = { displayName: "改了名", geniusX: { name: "HACK" }, progress: { currentPhase: 4 } } as never;
    const updated = await ctx.service.updateStudent(s.id, hostile);
    expect(updated.displayName).toBe("改了名");
    expect(updated.geniusX).toEqual({}); // untouched
    expect(updated.progress.currentPhase).toBe(1); // untouched
  });

  it("rejects: empty update, invalid age, blank name, unknown student", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "边界", age: 6, consent: CONSENT_V1 });
    expect(await code(ctx.service.updateStudent(s.id, {}))).toBe("INVALID_INPUT");
    expect(await code(ctx.service.updateStudent(s.id, { age: 11 }))).toBe("INVALID_AGE");
    expect(await code(ctx.service.updateStudent(s.id, { displayName: " " }))).toBe("INVALID_INPUT");
    expect(await code(ctx.service.updateStudent("99999999-9999-4999-8999-999999999995", { age: 7 }))).toBe(
      "STUDENT_NOT_FOUND",
    );
  });
});

describe("updateConsent (single-row overwrite)", () => {
  it("overwrites to a new version, keeps exactly one row, refreshes consentGivenAt", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "同意", age: 7, consent: CONSENT_V1 });
    const updated = await ctx.service.updateConsent(s.id, {
      consentVersion: "v1.1",
      dataRetentionAgreed: true,
      parentCoWorkAllowed: true,
      mediaUsageAllowed: true,
    });
    expect(updated).toMatchObject({
      studentId: s.id,
      parentId,
      consentVersion: "v1.1",
      parentCoWorkAllowed: true,
      mediaUsageAllowed: true,
    });
    const rows = await ctx.sql.query("SELECT COUNT(*)::int AS n FROM guardian_consents WHERE student_id = $1", [s.id]);
    expect((rows.rows[0] as { n: number }).n).toBe(1); // overwrite, not append
  });

  it("rejects: retention=false → CONSENT_REQUIRED; unknown student → STUDENT_NOT_FOUND", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "撤回", age: 7, consent: CONSENT_V1 });
    expect(
      await code(ctx.service.updateConsent(s.id, { consentVersion: "v1.1", dataRetentionAgreed: false })),
    ).toBe("CONSENT_REQUIRED");
    expect(await code(ctx.service.updateConsent("99999999-9999-4999-8999-999999999994", CONSENT_V1))).toBe(
      "STUDENT_NOT_FOUND",
    );
  });
});

describe("applyProgressUpdate (server-internal — the Classroom Service path)", () => {
  it("merges ritual + progress partials; PROJECTED companion fields are REJECTED (P4.5-B single writer)", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "进度", age: 7, consent: CONSENT_V1 });
    // The IP character MIRROR owns the projected columns from 4.5 on — this surface fails
    // closed (accept-and-ignore would be the forbidden silent fallback).
    await expect(
      ctx.service.applyProgressUpdate(s.id, { geniusX: { avatarUrl: "cos://avatar/1.png", backgroundSetting: "太空站" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const afterLesson = await ctx.service.applyProgressUpdate(s.id, {
      geniusX: { birthdaySpeech: "你好呀！" }, // the ritual field stays writable here
      progress: { completedLessonIds: ["lesson-001"], badges: ["first-friend"] },
    });
    expect(afterLesson.geniusX).toEqual({ birthdaySpeech: "你好呀！" });
    expect(afterLesson.progress).toEqual({
      completedLessonIds: ["lesson-001"],
      currentPhase: 1, // kept
      badges: ["first-friend"],
    });
  });

  it("rejects: phase out of 1-4 / empty update → INVALID_INPUT; unknown student → STUDENT_NOT_FOUND", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "阶段", age: 7, consent: CONSENT_V1 });
    expect(await code(ctx.service.applyProgressUpdate(s.id, { progress: { currentPhase: 5 } }))).toBe("INVALID_INPUT");
    expect(await code(ctx.service.applyProgressUpdate(s.id, {}))).toBe("INVALID_INPUT");
    expect(
      await code(ctx.service.applyProgressUpdate("99999999-9999-4999-8999-999999999993", { progress: { currentPhase: 2 } })),
    ).toBe("STUDENT_NOT_FOUND");
  });
});

describe("recordLessonCompletion (server-internal lesson-end write-back)", () => {
  it("appends the lesson + companion fields atomically; re-runs are idempotent", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "结课", age: 7, consent: CONSENT_V1 });

    const first = await ctx.service.recordLessonCompletion(s.id, "lesson-001", {
      birthdaySpeech: "你好呀！", // P4.5-B: projected fields (avatar etc.) flow via the IP mirror now
    });
    expect(first.progress.completedLessonIds).toEqual(["lesson-001"]);
    expect(first.geniusX).toMatchObject({ birthdaySpeech: "你好呀！" });

    const again = await ctx.service.recordLessonCompletion(s.id, "lesson-001", {});
    expect(again.progress.completedLessonIds).toEqual(["lesson-001"]); // no duplicate
    expect(again.geniusX.birthdaySpeech).toBe("你好呀！"); // COALESCE keeps the ritual field on empty re-run

    const second = await ctx.service.recordLessonCompletion(s.id, "lesson-002", {});
    expect(second.progress.completedLessonIds).toEqual(["lesson-001", "lesson-002"]);
  });

  it("rejects: blank/oversized lessonId and oversized geniusX text → INVALID_INPUT; unknown student → STUDENT_NOT_FOUND", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "结课边界", age: 7, consent: CONSENT_V1 });
    expect(await code(ctx.service.recordLessonCompletion(s.id, "   ", {}))).toBe("INVALID_INPUT");
    expect(await code(ctx.service.recordLessonCompletion(s.id, "L".repeat(201), {}))).toBe("INVALID_INPUT");
    expect(
      await code(ctx.service.recordLessonCompletion(s.id, "lesson-001", { birthdaySpeech: "长".repeat(5000) })),
    ).toBe("INVALID_INPUT");
    expect(
      await code(ctx.service.recordLessonCompletion("99999999-9999-4999-8999-999999999980", "lesson-001", {})),
    ).toBe("STUDENT_NOT_FOUND");
  });
});

describe("listTenantStudents (tenant isolation + cursor pagination)", () => {
  it("returns ONLY the tenant's own students (isolation), pages with a stable cursor", async () => {
    // Fresh tenants so counts are exact.
    const tenantC = await ctx.makeTenant("分页租户");
    const tenantD = await ctx.makeTenant("隔离租户");
    const parentC = await ctx.makeParent(tenantC);
    const parentD = await ctx.makeParent(tenantD);
    for (let i = 0; i < 5; i++) {
      await ctx.service.enrollStudent({ parentId: parentC, displayName: `C${i}`, age: 5 + (i % 5), consent: CONSENT_V1 });
    }
    await ctx.service.enrollStudent({ parentId: parentD, displayName: "D0", age: 6, consent: CONSENT_V1 });

    const page1 = await ctx.service.listTenantStudents(tenantC, { limit: 2 });
    expect(page1.students).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    const page2 = await ctx.service.listTenantStudents(tenantC, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.students).toHaveLength(2);
    expect(page2.nextCursor).toBeDefined();
    const page3 = await ctx.service.listTenantStudents(tenantC, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.students).toHaveLength(1);
    expect(page3.nextCursor).toBeUndefined(); // last page

    const all = [...page1.students, ...page2.students, ...page3.students];
    expect(new Set(all.map((s) => s.id)).size).toBe(5); // no dupes, no gaps
    expect(all.every((s) => s.tenantId === tenantC)).toBe(true); // isolation
  });

  it("rejects: unknown tenant → TENANT_NOT_FOUND; bad cursor / bad limit → INVALID_INPUT", async () => {
    expect(await code(ctx.service.listTenantStudents("99999999-9999-4999-8999-999999999992"))).toBe(
      "TENANT_NOT_FOUND",
    );
    expect(await code(ctx.service.listTenantStudents(tenantA, { cursor: "!!!" }))).toBe("INVALID_INPUT");
    expect(await code(ctx.service.listTenantStudents(tenantA, { limit: 0 }))).toBe("INVALID_INPUT");
  });

  it("clamps an over-max limit instead of rejecting (contract: server clamps)", async () => {
    const res = await ctx.service.listTenantStudents(tenantA, { limit: 5000 });
    expect(res.students.length).toBeLessThanOrEqual(100);
  });
});

describe("createParent identifier reconciliation (operator-visible, never silent)", () => {
  it("backfills a missing second identifier onto the matched parent", async () => {
    const first = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613955550001" });
    const combined = await ctx.service.createParent({
      tenantId: tenantA,
      phoneNumber: "+8613955550001",
      wechatOpenId: "wx_backfill_1",
    });
    expect(combined).toMatchObject({ parentId: first.parentId, created: false });
    const row = await ctx.sql.query("SELECT wechat_open_id FROM parents WHERE id = $1", [first.parentId]);
    expect((row.rows[0] as { wechat_open_id: string | null }).wechat_open_id).toBe("wx_backfill_1"); // not dropped

    // The wechat-only follow-up now resolves to the SAME parent (no duplicate family).
    const byWechat = await ctx.service.createParent({ tenantId: tenantA, wechatOpenId: "wx_backfill_1" });
    expect(byWechat).toMatchObject({ parentId: first.parentId, created: false });
  });

  it("keeps the stored value and logs (no raw PII) when a supplied identifier contradicts it", async () => {
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((msg: unknown) => {
      warnings.push(String(msg));
    });
    try {
      const first = await ctx.service.createParent({
        tenantId: tenantA,
        phoneNumber: "+8613955550002",
        wechatOpenId: "wx_contradict_1",
      });
      const second = await ctx.service.createParent({
        tenantId: tenantA,
        wechatOpenId: "wx_contradict_1",
        phoneNumber: "+8613955550003", // contradicts the stored phone
      });
      expect(second).toMatchObject({ parentId: first.parentId, created: false });
      const row = await ctx.sql.query("SELECT phone_number FROM parents WHERE id = $1", [first.parentId]);
      expect((row.rows[0] as { phone_number: string }).phone_number).toBe("+8613955550002"); // stored kept

      const contradiction = warnings.find((w) => w.includes("identifier-contradiction"));
      expect(contradiction).toBeDefined(); // operator-visible
      expect(contradiction).not.toContain("+8613955550003"); // ids/field names only — no raw PII
      expect(contradiction).not.toContain("+8613955550002");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("trims identifiers to ONE idempotency key; whitespace-only → INVALID_INPUT", async () => {
    const a = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "+8613955550004" });
    const b = await ctx.service.createParent({ tenantId: tenantA, phoneNumber: "  +8613955550004 " });
    expect(b).toMatchObject({ parentId: a.parentId, created: false });
    expect(await code(ctx.service.createParent({ tenantId: tenantA, phoneNumber: "   " }))).toBe("INVALID_INPUT");
  });
});

describe("createParent race recovery (the ON CONFLICT + re-select path)", () => {
  it("returns the concurrent winner (created=false) when a duplicate commits between select and insert", async () => {
    const tenant = await ctx.makeTenant("竞态租户");
    let injectedId: string | null = null;
    const racingDb = {
      query: async (text: string, params?: unknown[]) => {
        if (injectedId === null && /INSERT INTO parents/.test(text)) {
          // Simulate a concurrent identical create committing first.
          const winner = await ctx.sql.query(
            "INSERT INTO parents (tenant_id, phone_number) VALUES ($1, '+8613955550005') RETURNING id",
            [tenant],
          );
          injectedId = (winner.rows[0] as { id: string }).id;
        }
        return ctx.sql.query(text, params);
      },
    };
    const racingService = new IdentityService(racingDb);
    const res = await racingService.createParent({ tenantId: tenant, phoneNumber: "+8613955550005" });
    expect(res).toMatchObject({ parentId: injectedId, created: false }); // winner, not a dupe
    const count = await ctx.sql.query(
      "SELECT COUNT(*)::int AS n FROM parents WHERE tenant_id = $1 AND phone_number = '+8613955550005'",
      [tenant],
    );
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it("throws the terminal PARENT_ALREADY_EXISTS when the conflict cannot be re-resolved", async () => {
    const scripted = {
      query: async (text: string) => {
        if (/FROM tenants/.test(text)) return { rows: [{ ok: 1 }] };
        if (/INSERT INTO parents/.test(text)) return { rows: [] }; // conflict suppressed
        return { rows: [] }; // re-select finds nothing (pathological)
      },
    };
    const service = new IdentityService(scripted);
    expect(
      await code(service.createParent({ tenantId: tenantA, phoneNumber: "+8613955550006" })),
    ).toBe("PARENT_ALREADY_EXISTS");
  });
});

describe("archived tenants refuse new writes (reads still work)", () => {
  it("createParent and enrollStudent → TENANT_NOT_FOUND; listing still allowed", async () => {
    const tenant = await ctx.makeTenant("归档租户");
    const parentId = await ctx.makeParent(tenant);
    await ctx.service.enrollStudent({ parentId, displayName: "归档前", age: 7, consent: CONSENT_V1 });
    await ctx.sql.query("UPDATE tenants SET status = 'archived' WHERE id = $1", [tenant]);

    expect(await code(ctx.service.createParent({ tenantId: tenant }))).toBe("TENANT_NOT_FOUND");
    expect(
      await code(ctx.service.enrollStudent({ parentId, displayName: "归档后", age: 7, consent: CONSENT_V1 })),
    ).toBe("TENANT_NOT_FOUND");

    const list = await ctx.service.listTenantStudents(tenant); // reads allowed
    expect(list.students).toHaveLength(1);
  });
});

describe("server-internal input hardening (no zod backstop on this path)", () => {
  it("applyProgressUpdate rejects non-string array elements with a TYPED error (no raw PII escape)", async () => {
    const parentId = await ctx.makeParent(tenantA);
    const s = await ctx.service.enrollStudent({ parentId, displayName: "数组", age: 7, consent: CONSENT_V1 });
    expect(
      await code(ctx.service.applyProgressUpdate(s.id, { progress: { badges: [null] as never } })),
    ).toBe("INVALID_INPUT"); // IdentityServiceError, not a raw pg error carrying the row
  });

  it("enrollStudent: missing consent object → CONSENT_REQUIRED; displayName over 64 chars → INVALID_INPUT", async () => {
    const parentId = await ctx.makeParent(tenantA);
    expect(
      await code(
        ctx.service.enrollStudent({ parentId, displayName: "无书", age: 7, consent: undefined as never }),
      ),
    ).toBe("CONSENT_REQUIRED");
    expect(
      await code(
        ctx.service.enrollStudent({ parentId, displayName: "名".repeat(65), age: 7, consent: CONSENT_V1 }),
      ),
    ).toBe("INVALID_INPUT");
  });
});
