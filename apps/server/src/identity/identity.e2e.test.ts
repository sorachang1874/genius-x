/**
 * Identity Service integration tests — the PHANDBOOK Step-3 scenarios end to end:
 * full enrollment flow, guardian consent update, profile update (displayName + genius_x
 * fields), and interop with the seeded demo tenant. Real Postgres semantics via PGlite +
 * the production migration runner.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_DEMO_TENANT_ID } from "../http";
import { newIdentityTestContext } from "./identity.testutil";

describe("identity e2e — full enrollment lifecycle", () => {
  it("parent enrolls two children → class updates progress → consent re-agreed → admin lists", async () => {
    const ctx = await newIdentityTestContext();
    const tenantId = await ctx.makeTenant("北京示范校区");

    // 1. Parent account (phone-identified), idempotent re-create returns the same parent.
    const created = await ctx.service.createParent({ tenantId, phoneNumber: "+8613700000001" });
    expect(created.created).toBe(true);
    const again = await ctx.service.createParent({ tenantId, phoneNumber: "+8613700000001" });
    expect(again).toMatchObject({ parentId: created.parentId, created: false });

    // 2. Enroll two children under the same parent.
    const meimei = await ctx.service.enrollStudent({
      parentId: created.parentId,
      displayName: "美美",
      age: 6,
      consent: { consentVersion: "v1.0", dataRetentionAgreed: true },
    });
    const didi = await ctx.service.enrollStudent({
      parentId: created.parentId,
      displayName: "弟弟",
      age: 4,
      consent: { consentVersion: "v1.0", dataRetentionAgreed: true, parentCoWorkAllowed: true },
    });
    expect(meimei.tenantId).toBe(tenantId);
    expect(didi.tenantId).toBe(tenantId);

    // 3. The classroom runs Lesson 1: server-internal progress writes. P4.5-B single-
    //    writer rule: PROJECTED companion fields are REJECTED here (the IP mirror owns
    //    them); the ritual field + progress remain this surface's job.
    await expect(
      ctx.service.applyProgressUpdate(meimei.id, {
        geniusX: { avatarUrl: "cos://demo/meimei-avatar.png", backgroundSetting: "彩虹城堡" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" }); // fail closed, never accept-and-ignore
    const afterLesson = await ctx.service.applyProgressUpdate(meimei.id, {
      geniusX: { birthdaySpeech: "美美你好，我出生啦！" },
      progress: { completedLessonIds: ["lesson-001"], badges: ["lesson-001-complete"] },
    });
    expect(afterLesson.progress.completedLessonIds).toContain("lesson-001");
    expect(afterLesson.geniusX.birthdaySpeech).toBe("美美你好，我出生啦！");

    // 4. Parent edits the profile (allowlist only) — companion state survives untouched.
    const renamed = await ctx.service.updateStudent(meimei.id, { displayName: "美美酱" });
    expect(renamed.displayName).toBe("美美酱");
    expect(renamed.geniusX.birthdaySpeech).toBe("美美你好，我出生啦！");

    // 5. Consent policy bumps to v1.1; parent re-agrees and opens co-work.
    const consent = await ctx.service.updateConsent(meimei.id, {
      consentVersion: "v1.1",
      dataRetentionAgreed: true,
      parentCoWorkAllowed: true,
    });
    expect(consent.consentVersion).toBe("v1.1");
    expect(consent.parentId).toBe(created.parentId);

    // 6. Admin lists the tenant: both children, nothing else, fully hydrated.
    const list = await ctx.service.listTenantStudents(tenantId);
    expect(list.students).toHaveLength(2);
    expect(list.nextCursor).toBeUndefined();
    expect(new Set(list.students.map((s) => s.displayName))).toEqual(new Set(["美美酱", "弟弟"]));

    // 7. The persistent profile survives a fresh read (what the next lesson's join sees).
    const reread = await ctx.service.getStudent(meimei.id);
    expect(reread).toEqual(renamed);

    // 8. Contract preflights stay green after the whole flow.
    const orphan = await ctx.sql.query(
      "SELECT COUNT(*)::int AS n FROM students s WHERE NOT EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.student_id = s.id)",
    );
    expect((orphan.rows[0] as { n: number }).n).toBe(0);
  });

  it("works against the seeded demo tenant (the Step-5 classroom-join fixture)", async () => {
    const ctx = await newIdentityTestContext({ seed: true });

    // The seeded students are visible through the service, in the demo tenant.
    const list = await ctx.service.listTenantStudents(DEFAULT_DEMO_TENANT_ID);
    expect(list.students.map((s) => s.displayName).sort()).toEqual(["乐乐", "小明", "朵朵", "轩轩"]);

    // A seeded student reads back exactly as the classroom join will consume it (Step 5):
    // lookup by persistent id → tenant check → displayName pre-fill.
    const xiaoming = list.students.find((s) => s.displayName === "小明")!;
    const fetched = await ctx.service.getStudent(xiaoming.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.tenantId).toBe(DEFAULT_DEMO_TENANT_ID); // join's TENANT_MISMATCH guard input
    expect(fetched!.age).toBe(7);

    // Enrolling a fifth child under a seeded parent interoperates cleanly.
    const fifth = await ctx.service.enrollStudent({
      parentId: xiaoming.parentId,
      displayName: "妹妹",
      age: 5,
      consent: { consentVersion: "v1.0", dataRetentionAgreed: true },
    });
    expect(fifth.tenantId).toBe(DEFAULT_DEMO_TENANT_ID);
    const after = await ctx.service.listTenantStudents(DEFAULT_DEMO_TENANT_ID);
    expect(after.students).toHaveLength(5);
  });

  it("cross-tenant guardianship is impossible end to end (DB-enforced)", async () => {
    const ctx = await newIdentityTestContext();
    const tenantA = await ctx.makeTenant("租户甲");
    const tenantB = await ctx.makeTenant("租户乙");
    const parentB = await ctx.makeParent(tenantB);

    // Service derives tenant from the parent, so a cross-tenant enrollment cannot even be
    // EXPRESSED through the API. Assert the DB backstop holds for raw writes too.
    const student = await ctx.service.enrollStudent({
      parentId: parentB,
      displayName: "乙娃",
      age: 7,
      consent: { consentVersion: "v1.0", dataRetentionAgreed: true },
    });
    expect(student.tenantId).toBe(tenantB);

    await expect(
      ctx.sql.query("UPDATE students SET tenant_id = $1 WHERE id = $2", [tenantA, student.id]),
    ).rejects.toThrow(/foreign key/i); // composite FK: tenant must stay the parent's tenant
  });
});
