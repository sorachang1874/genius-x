/**
 * Identity HTTP routes tests — the six frozen endpoints over app.inject, backed by the
 * PGlite IdentityService. Covers the review-mandated gates: exact wire keys on
 * POST /parents (no `created` leak), strictObject privilege rejection on PATCH, and the
 * sanitized 500 (no PII in body or logs).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Student } from "@genius-x/contracts";
import { InMemorySessionStore } from "../session/store";
import { buildHttp } from "../http";
import type { IdentityService } from "./service";
import { newIdentityTestContext, type IdentityTestContext } from "./identity.testutil";

let ctx: IdentityTestContext;
let tenant: string;
let app: FastifyInstance;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  tenant = await ctx.makeTenant("路由租户");
  app = buildHttp(new InMemorySessionStore(), { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro", identity: ctx.service });
});

afterAll(async () => {
  await app.close();
});

async function enrollViaHttp(parentId: string, displayName: string, age = 7): Promise<Student> {
  const res = await app.inject({
    method: "POST",
    url: "/students",
    payload: { parentId, displayName, age, consent: CONSENT_V1 },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Student;
}

describe("POST /parents", () => {
  it("201 on create with EXACTLY the frozen wire keys (no `created` leak); 200 on duplicate", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/parents",
      payload: { tenantId: tenant, phoneNumber: "+8613866660001" },
    });
    expect(first.statusCode).toBe(201);
    const body = first.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["parentId", "tenantId"]); // exact contract shape
    expect(body.tenantId).toBe(tenant);

    const dup = await app.inject({
      method: "POST",
      url: "/parents",
      payload: { tenantId: tenant, phoneNumber: "+8613866660001" },
    });
    expect(dup.statusCode).toBe(200); // existing
    const dupBody = dup.json() as Record<string, unknown>;
    expect(Object.keys(dupBody).sort()).toEqual(["parentId", "tenantId"]); // exact keys on 200 too
    expect(dupBody.parentId).toBe(body.parentId);
  });

  it("PARSER BOUNDARY: malformed JSON / empty JSON body / wrong content-type → contract-shaped 400", async () => {
    const malformed = await app.inject({
      method: "POST",
      url: "/parents",
      headers: { "content-type": "application/json" },
      payload: '{"tenantId":', // truncated JSON — bypasses zod, hits the setErrorHandler
    });
    expect(malformed.statusCode).toBe(400);
    expect((malformed.json() as { error: string }).error).toBe("INVALID_INPUT");

    const empty = await app.inject({
      method: "POST",
      url: "/parents",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(empty.statusCode).toBe(400);
    expect((empty.json() as { error: string }).error).toBe("INVALID_INPUT");

    const xml = await app.inject({
      method: "POST",
      url: "/parents",
      headers: { "content-type": "application/xml" },
      payload: "<parent/>",
    });
    expect(xml.statusCode).toBe(400);
    expect((xml.json() as { error: string }).error).toBe("INVALID_INPUT");
  });

  it("400 INVALID_INPUT on unknown keys (strict); 404 TENANT_NOT_FOUND; 409 on ambiguous conflict", async () => {
    const unknownKey = await app.inject({
      method: "POST",
      url: "/parents",
      payload: { tenantId: tenant, nickname: "不存在的字段" },
    });
    expect(unknownKey.statusCode).toBe(400);
    expect((unknownKey.json() as { error: string }).error).toBe("INVALID_INPUT");

    const noTenant = await app.inject({
      method: "POST",
      url: "/parents",
      payload: { tenantId: "99999999-9999-4999-8999-999999999990" },
    });
    expect(noTenant.statusCode).toBe(404);
    expect((noTenant.json() as { error: string }).error).toBe("TENANT_NOT_FOUND");

    // phone → parent X, wechat → parent Y ⇒ ambiguous
    await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant, phoneNumber: "+8613866660002" } });
    await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant, wechatOpenId: "wx_route_amb" } });
    const ambiguous = await app.inject({
      method: "POST",
      url: "/parents",
      payload: { tenantId: tenant, phoneNumber: "+8613866660002", wechatOpenId: "wx_route_amb" },
    });
    expect(ambiguous.statusCode).toBe(409);
    expect((ambiguous.json() as { error: string }).error).toBe("PARENT_ALREADY_EXISTS");
  });
});

describe("POST /students", () => {
  it("201 with the full persistent Student; semantic errors map to contract codes", async () => {
    const parent = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant } })
    ).json()) as { parentId: string };

    const student = await enrollViaHttp(parent.parentId, "路由学生", 6);
    expect(student).toMatchObject({
      tenantId: tenant,
      parentId: parent.parentId,
      displayName: "路由学生",
      age: 6,
      geniusX: {},
      progress: { completedLessonIds: [], currentPhase: 1, badges: [] },
    });

    const badAge = await app.inject({
      method: "POST",
      url: "/students",
      payload: { parentId: parent.parentId, displayName: "三岁", age: 3, consent: CONSENT_V1 },
    });
    expect(badAge.statusCode).toBe(400);
    expect((badAge.json() as { error: string }).error).toBe("INVALID_AGE");

    const noConsent = await app.inject({
      method: "POST",
      url: "/students",
      payload: {
        parentId: parent.parentId,
        displayName: "未同意",
        age: 7,
        consent: { consentVersion: "v1.0", dataRetentionAgreed: false },
      },
    });
    expect(noConsent.statusCode).toBe(400);
    expect((noConsent.json() as { error: string }).error).toBe("CONSENT_REQUIRED");

    const noParent = await app.inject({
      method: "POST",
      url: "/students",
      payload: {
        parentId: "99999999-9999-4999-8999-999999999989",
        displayName: "无主",
        age: 7,
        consent: CONSENT_V1,
      },
    });
    expect(noParent.statusCode).toBe(404);
    expect((noParent.json() as { error: string }).error).toBe("PARENT_NOT_FOUND");
  });

  it("400 INVALID_INPUT on wrong shape (age as string) — zod boundary, detail has no values", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/students",
      payload: { parentId: "x", displayName: "形状", age: "seven", consent: CONSENT_V1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; detail?: string };
    expect(body.error).toBe("INVALID_INPUT");
    expect(body.detail).toContain("age"); // path named
    expect(body.detail).not.toContain("seven"); // received value NOT echoed
  });
});

describe("GET /students/:id", () => {
  it("200 roundtrip; 404 unknown; 400 malformed id", async () => {
    const parent = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant } })
    ).json()) as { parentId: string };
    const student = await enrollViaHttp(parent.parentId, "取回", 8);

    const ok = await app.inject({ method: "GET", url: `/students/${student.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual(student);

    const missing = await app.inject({ method: "GET", url: "/students/99999999-9999-4999-8999-999999999988" });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: string }).error).toBe("STUDENT_NOT_FOUND");

    const malformed = await app.inject({ method: "GET", url: "/students/not-a-uuid" });
    expect(malformed.statusCode).toBe(400);
    expect((malformed.json() as { error: string }).error).toBe("INVALID_INPUT");
  });
});

describe("PATCH /students/:id (parent-privilege boundary)", () => {
  it("200 on allowlisted fields; smuggled geniusX/progress → 400, student untouched", async () => {
    const parent = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant } })
    ).json()) as { parentId: string };
    const student = await enrollViaHttp(parent.parentId, "越权前", 6);

    const ok = await app.inject({
      method: "PATCH",
      url: `/students/${student.id}`,
      payload: { displayName: "改名OK", age: 7 },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as Student).displayName).toBe("改名OK");

    const smuggle = await app.inject({
      method: "PATCH",
      url: `/students/${student.id}`,
      payload: { displayName: "黑客", geniusX: { name: "HACK" }, progress: { currentPhase: 4 } },
    });
    expect(smuggle.statusCode).toBe(400); // strictObject rejects server-owned keys
    expect((smuggle.json() as { error: string }).error).toBe("INVALID_INPUT");

    const after = (await (await app.inject({ method: "GET", url: `/students/${student.id}` })).json()) as Student;
    expect(after.displayName).toBe("改名OK"); // the smuggle attempt changed NOTHING
    expect(after.geniusX).toEqual({});
    expect(after.progress.currentPhase).toBe(1);
  });

  it("empty body → 400 INVALID_INPUT (no updatable fields)", async () => {
    const parent = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant } })
    ).json()) as { parentId: string };
    const student = await enrollViaHttp(parent.parentId, "空补丁", 6);
    const res = await app.inject({ method: "PATCH", url: `/students/${student.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("INVALID_INPUT");
  });

  it("unknown student → 404; malformed :id → 400 (both PATCH endpoints)", async () => {
    const valid = { displayName: "无人" };
    const consent = { consentVersion: "v1.1", dataRetentionAgreed: true };
    const u404 = await app.inject({
      method: "PATCH",
      url: "/students/99999999-9999-4999-8999-999999999985",
      payload: valid,
    });
    expect(u404.statusCode).toBe(404);
    expect((u404.json() as { error: string }).error).toBe("STUDENT_NOT_FOUND");
    const c404 = await app.inject({
      method: "PATCH",
      url: "/students/99999999-9999-4999-8999-999999999985/consent",
      payload: consent,
    });
    expect(c404.statusCode).toBe(404);
    expect((c404.json() as { error: string }).error).toBe("STUDENT_NOT_FOUND");

    const u400 = await app.inject({ method: "PATCH", url: "/students/not-a-uuid", payload: valid });
    expect(u400.statusCode).toBe(400);
    const c400 = await app.inject({ method: "PATCH", url: "/students/not-a-uuid/consent", payload: consent });
    expect(c400.statusCode).toBe(400);
  });
});

describe("PATCH /students/:id/consent", () => {
  it("200 overwrite to v1.1; retention=false → 400 CONSENT_REQUIRED", async () => {
    const parent = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant } })
    ).json()) as { parentId: string };
    const student = await enrollViaHttp(parent.parentId, "续签", 7);

    const ok = await app.inject({
      method: "PATCH",
      url: `/students/${student.id}/consent`,
      payload: { consentVersion: "v1.1", dataRetentionAgreed: true, parentCoWorkAllowed: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ studentId: student.id, consentVersion: "v1.1", parentCoWorkAllowed: true });

    const refuse = await app.inject({
      method: "PATCH",
      url: `/students/${student.id}/consent`,
      payload: { consentVersion: "v1.2", dataRetentionAgreed: false },
    });
    expect(refuse.statusCode).toBe(400);
    expect((refuse.json() as { error: string }).error).toBe("CONSENT_REQUIRED");
  });
});

describe("GET /tenants/:id/students (admin)", () => {
  it("200 paginated walk via query params; 404 unknown tenant; 400 non-numeric limit", async () => {
    const fresh = await ctx.makeTenant("分页路由");
    const parent = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: fresh } })
    ).json()) as { parentId: string };
    for (let i = 0; i < 3; i++) await enrollViaHttp(parent.parentId, `P${i}`, 5 + i);

    const page1 = await app.inject({ method: "GET", url: `/tenants/${fresh}/students?limit=2` });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json() as { students: Student[]; nextCursor?: string };
    expect(p1.students).toHaveLength(2);
    expect(p1.nextCursor).toBeDefined();

    const page2 = await app.inject({
      method: "GET",
      url: `/tenants/${fresh}/students?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`,
    });
    const p2 = page2.json() as { students: Student[]; nextCursor?: string };
    expect(p2.students).toHaveLength(1);
    expect(p2.nextCursor).toBeUndefined();

    const missing = await app.inject({ method: "GET", url: "/tenants/99999999-9999-4999-8999-999999999987/students" });
    expect(missing.statusCode).toBe(404);

    const badLimit = await app.inject({ method: "GET", url: `/tenants/${fresh}/students?limit=abc` });
    expect(badLimit.statusCode).toBe(400);
    expect((badLimit.json() as { error: string }).error).toBe("INVALID_INPUT");
  });

  it("fail-closed query semantics pinned: empty ?limit= → 400; unknown query param → 400", async () => {
    const emptyLimit = await app.inject({ method: "GET", url: `/tenants/${tenant}/students?limit=` });
    expect(emptyLimit.statusCode).toBe(400); // "" coerces to 0 → service rejects
    const unknown = await app.inject({ method: "GET", url: `/tenants/${tenant}/students?surprise=1` });
    expect(unknown.statusCode).toBe(400); // strictObject query
  });

  it("TENANT FILTER HOLDS under a foreign-tenant cursor (cross-tenant pagination probe)", async () => {
    const tenantX = await ctx.makeTenant("游标X");
    const tenantY = await ctx.makeTenant("游标Y");
    const px = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenantX } })
    ).json()) as { parentId: string };
    const py = (await (
      await app.inject({ method: "POST", url: "/parents", payload: { tenantId: tenantY } })
    ).json()) as { parentId: string };
    for (let i = 0; i < 2; i++) await enrollViaHttp(px.parentId, `X${i}`, 6);
    const yStudent = await enrollViaHttp(py.parentId, "Y0", 7);

    // Cursor encoding ANOTHER tenant's student id must not leak that tenant's rows.
    const foreignCursor = Buffer.from(yStudent.id, "utf8").toString("base64url");
    const res = await app.inject({
      method: "GET",
      url: `/tenants/${tenantX}/students?cursor=${encodeURIComponent(foreignCursor)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { students: Student[] };
    expect(body.students.every((s) => s.tenantId === tenantX)).toBe(true); // only tenant X
  });
});

describe("error sanitization + deployment modes", () => {
  it("unexpected service error → 500 INTERNAL with NO PII in body or logs", async () => {
    const boom = new Error("boom 小明 +8613800000001"); // simulated raw error carrying PII
    const stub = { getStudent: async () => { throw boom; } } as unknown as IdentityService;
    const stubApp = buildHttp(new InMemorySessionStore(), { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro", identity: stub });
    const logged: unknown[][] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      const res = await stubApp.inject({ method: "GET", url: "/students/99999999-9999-4999-8999-999999999986" });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("小明");
      expect(res.body).not.toContain("+8613800000001");
      expect((res.json() as { error: string }).error).toBe("INTERNAL");
      const flat = JSON.stringify(logged);
      expect(flat).not.toContain("小明"); // err.message never logged
      expect(flat).not.toContain("+8613800000001");
    } finally {
      errSpy.mockRestore();
      await stubApp.close();
    }
  });

  it("identity absent ⇒ NONE of the six endpoints are registered (404)", async () => {
    const bare = buildHttp(new InMemorySessionStore(), { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro" });
    try {
      const id = "99999999-9999-4999-8999-999999999984";
      const probes = [
        bare.inject({ method: "POST", url: "/parents", payload: { tenantId: tenant } }),
        bare.inject({ method: "POST", url: "/students", payload: {} }),
        bare.inject({ method: "GET", url: `/students/${id}` }),
        bare.inject({ method: "PATCH", url: `/students/${id}`, payload: {} }),
        bare.inject({ method: "PATCH", url: `/students/${id}/consent`, payload: {} }),
        bare.inject({ method: "GET", url: `/tenants/${id}/students` }),
      ];
      for (const res of await Promise.all(probes)) expect(res.statusCode).toBe(404);
    } finally {
      await bare.close();
    }
  });
});
