/**
 * HTTP layer tests — Phase 1 (Step 5) persistent student join: lookup via Identity Service,
 * tenant check, displayName from the profile, NO ephemeral fallback. Assistants keep
 * ephemeral registration. Backed by PGlite (real Postgres semantics, no docker).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Student, TraceEvent, TraceSink, ServerMessage } from "@genius-x/contracts";
import { AiGateway, FakeProvider, KeywordSafetyFilter, PresetFallbackLibrary } from "@genius-x/ai-gateway";
import { lesson001 } from "@genius-x/course-config";
import { InMemorySessionStore } from "./session/store";
import { buildHttp } from "./http";
import { makeReducer } from "./engine";
import { ClassroomController } from "./sync/controller";
import { IdentityService } from "./identity/service";
import { newIdentityTestContext, type IdentityTestContext } from "./identity/identity.testutil";

class FakeTrace implements TraceSink {
  events: TraceEvent[] = [];
  record(e: TraceEvent): void {
    this.events.push(e);
  }
}

let ctx: IdentityTestContext;
let tenant: string;
let otherTenant: string;
let enrolled: Student;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  tenant = await ctx.makeTenant("教室租户");
  otherTenant = await ctx.makeTenant("外部租户");
  const parentId = await ctx.makeParent(tenant);
  enrolled = await ctx.service.enrollStudent({ parentId, displayName: "档案名", age: 7, consent: CONSENT_V1 });
});

function makeApp(store = new InMemorySessionStore()) {
  return { store, app: buildHttp(store, { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro", tenantId: tenant, identity: ctx.service }) };
}

describe("POST /session/join — persistent student join (Phase 1)", () => {
  it("valid studentId: joins, keys runtime state by the PERSISTENT id, displayName from profile (body name IGNORED)", async () => {
    const { store, app } = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r1", studentId: enrolled.id, name: "客户端乱填的名字" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { studentId: string; sessionId: string; role: string };
    expect(body).toMatchObject({ studentId: enrolled.id, sessionId: "r1", role: "student" });

    const session = await store.load("r1");
    expect(session!.tenantId).toBe(tenant);
    expect(session!.students[enrolled.id]).toBeDefined();
    expect(session!.students[enrolled.id]!.displayName).toBe("档案名"); // profile wins
    await app.close();
  });

  it("re-join is idempotent: existing runtime state survives a reconnect", async () => {
    const { store, app } = makeApp();
    await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "r2", studentId: enrolled.id } });
    // Simulate mid-class progress, then a reconnect join.
    await store.update("r2", async (current) => {
      current!.students[enrolled.id]!.interactionCounts["icebreak"] = 3;
      return { next: current!, out: undefined };
    });
    const again = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r2", studentId: enrolled.id },
    });
    expect(again.statusCode).toBe(200);
    const session = await store.load("r2");
    expect(session!.students[enrolled.id]!.interactionCounts["icebreak"]).toBe(3); // kept
    expect(Object.keys(session!.students)).toHaveLength(1); // no duplicate entry
    await app.close();
  });

  it("missing studentId → 400 INVALID_INPUT (NO ephemeral fallback — frozen migration rule)", async () => {
    const { store, app } = makeApp();
    const res = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "r3" } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("INVALID_INPUT");
    expect(await store.load("r3")).toBeNull(); // nothing minted for a rejected join
    await app.close();
  });

  it("unknown studentId → 404 STUDENT_NOT_FOUND; malformed → 400 INVALID_INPUT", async () => {
    const { app } = makeApp();
    const unknown = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r4", studentId: "99999999-9999-4999-8999-999999999983" },
    });
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: string }).error).toBe("STUDENT_NOT_FOUND");

    const malformed = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r4", studentId: "not-a-uuid" },
    });
    expect(malformed.statusCode).toBe(400);
    expect((malformed.json() as { error: string }).error).toBe("INVALID_INPUT");
    await app.close();
  });

  it("student from another tenant → 403 TENANT_MISMATCH; rejected join persists NO session", async () => {
    const { store, app } = makeApp();
    const foreignParent = await ctx.makeParent(otherTenant);
    const foreign = await ctx.service.enrollStudent({
      parentId: foreignParent,
      displayName: "外租户学生",
      age: 8,
      consent: CONSENT_V1,
    });
    const res = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r5", studentId: foreign.id },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe("TENANT_MISMATCH");
    expect(await store.load("r5")).toBeNull(); // create-if-absent did NOT mint for a rejected join
    await app.close();
  });

  it("missing roomCode → 400", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "POST", url: "/session/join", payload: { studentId: enrolled.id } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("identity service absent → student join 503 IDENTITY_UNAVAILABLE (loud); assistants unaffected", async () => {
    const bare = buildHttp(new InMemorySessionStore(), { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro", tenantId: tenant }); // no identity
    const student = await bare.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r6", studentId: enrolled.id },
    });
    expect(student.statusCode).toBe(503);
    expect((student.json() as { error: string }).error).toBe("IDENTITY_UNAVAILABLE");

    const assistant = await bare.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r6", role: "assistant" },
    });
    expect(assistant.statusCode).toBe(200); // classroom staff flow does not depend on identity
    await bare.close();
  });
});

describe("POST /session/join — operator visibility + hardening (Step-5 review mandates)", () => {
  it("every rejection is COUNTED via join_rejected traces and logged (contract: 400/404/403 + count)", async () => {
    const trace = new FakeTrace();
    const store = new InMemorySessionStore();
    const app = buildHttp(store, { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro", tenantId: tenant, identity: ctx.service, trace });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "t1" } }); // 400 missing
      await app.inject({
        method: "POST",
        url: "/session/join",
        payload: { roomCode: "t1", studentId: "99999999-9999-4999-8999-999999999982" },
      }); // 404
      const foreignParent = await ctx.makeParent(otherTenant);
      const foreign = await ctx.service.enrollStudent({
        parentId: foreignParent,
        displayName: "外人",
        age: 7,
        consent: CONSENT_V1,
      });
      await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "t1", studentId: foreign.id } }); // 403

      const rejected = trace.events.filter((e) => e.kind === "join_rejected");
      expect(rejected.map((e) => e.payload.error)).toEqual(["INVALID_INPUT", "STUDENT_NOT_FOUND", "TENANT_MISMATCH"]);
      expect(errSpy).toHaveBeenCalledTimes(3); // loud, not silent
      // No PII in logs: ids only (the foreign child's display name must never appear).
      expect(JSON.stringify(errSpy.mock.calls)).not.toContain("外人");
    } finally {
      errSpy.mockRestore();
      await app.close();
    }
  });

  it("identity PRESENT but DB down → 503 IDENTITY_UNAVAILABLE (the loud 5xx contract row)", async () => {
    const broken = new IdentityService({ query: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:5432")) });
    const store = new InMemorySessionStore();
    const app = buildHttp(store, { lessonId: "lesson-001", lessonConfigVersion: "1.0.0", firstStageId: "intro", tenantId: tenant, identity: broken });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await app.inject({
        method: "POST",
        url: "/session/join",
        payload: { roomCode: "db-down", studentId: enrolled.id },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: string }).error).toBe("IDENTITY_UNAVAILABLE");
      expect(await store.load("db-down")).toBeNull(); // nothing persisted
      const assistant = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "db-down", role: "assistant" } });
      expect(assistant.statusCode).toBe(200); // staff flow independent of identity
    } finally {
      errSpy.mockRestore();
      await app.close();
    }
  });

  it("unknown role → 400 (no session-shell minting through the ephemeral branch)", async () => {
    const { store, app } = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "weird", role: "banana" },
    });
    expect(res.statusCode).toBe(400);
    expect(await store.load("weird")).toBeNull();
    await app.close();
  });

  it("re-join refreshes displayName from the profile (profile stays the source of truth)", async () => {
    const { store, app } = makeApp();
    const parentId = await ctx.makeParent(tenant);
    const kid = await ctx.service.enrollStudent({ parentId, displayName: "原名", age: 6, consent: CONSENT_V1 });
    await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "rn", studentId: kid.id } });
    await ctx.service.updateStudent(kid.id, { displayName: "新名" }); // parent renames mid-class
    await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "rn", studentId: kid.id } });
    const session = await store.load("rn");
    expect(session!.students[kid.id]!.displayName).toBe("新名");
    await app.close();
  });

  it("two concurrent FIRST joins to a new room land in ONE session (mutex, no lost write)", async () => {
    const { store, app } = makeApp();
    const parentId = await ctx.makeParent(tenant);
    const second = await ctx.service.enrollStudent({ parentId, displayName: "二号", age: 6, consent: CONSENT_V1 });
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "race", studentId: enrolled.id } }),
      app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "race", studentId: second.id } }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const session = await store.load("race");
    expect(Object.keys(session!.students).sort()).toEqual([enrolled.id, second.id].sort());
    await app.close();
  });

  it("INTEGRATION: HTTP join → WS HELLO resume serves the profile displayName (and DENIES phantoms)", async () => {
    // The controller's guardSession fail-closes on lessonConfigVersion mismatch, so the
    // session must be created with the REAL lesson001 metadata for resume to serve it.
    const store = new InMemorySessionStore();
    const app = buildHttp(store, {
      lessonId: lesson001.lessonId,
      lessonConfigVersion: lesson001.lessonConfigVersion,
      firstStageId: lesson001.stages[0]!.stageId,
      tenantId: tenant,
      identity: ctx.service,
    });
    await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "ws1", studentId: enrolled.id } });

    const sent: { studentId: string; msg: ServerMessage }[] = [];
    const trace = new FakeTrace();
    const controller = new ClassroomController(
      lesson001,
      makeReducer(lesson001),
      store,
      {
        toSession: () => {},
        toStudent: (_sid: string, studentId: string, msg: ServerMessage) => {
          sent.push({ studentId, msg });
        },
      },
      trace,
      { now: () => new Date().toISOString() },
      new AiGateway({
        provider: new FakeProvider(),
        safety: new KeywordSafetyFilter(),
        fallback: new PresetFallbackLibrary(),
        trace,
        now: () => new Date().toISOString(),
      }),
    );

    await controller.resume("ws1", enrolled.id); // the client's HELLO path
    const resume = sent.find((s) => s.msg.type === "RESUME_STATE");
    expect(resume).toBeDefined();
    expect((resume!.msg as Extract<ServerMessage, { type: "RESUME_STATE" }>).you.displayName).toBe("档案名");

    await controller.resume("ws1", "99999999-9999-4999-8999-999999999981"); // phantom HELLO
    expect(sent.filter((s) => s.studentId === "99999999-9999-4999-8999-999999999981")).toHaveLength(0);
    expect(trace.events.some((e) => e.kind === "join_rejected")).toBe(true); // denied + counted
    expect((await store.load("ws1"))!.students["99999999-9999-4999-8999-999999999981"]).toBeUndefined();
    await app.close();
  });
});

describe("POST /session/join — assistants (ephemeral, unchanged)", () => {
  it("registers an assistant; repeat joins register distinct assistants without duplicates", async () => {
    const { store, app } = makeApp();
    const res1 = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "a1", role: "assistant" } });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as { assistantId?: string; studentId?: string; role: string };
    expect(body1.role).toBe("assistant");
    expect(body1.assistantId).toBeDefined();
    expect(body1.studentId).toBeUndefined(); // assistants never mint student records

    const res2 = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "a1", role: "assistant" } });
    const body2 = res2.json() as { assistantId?: string };
    const session = await store.load("a1");
    expect(session!.assistants).toHaveLength(2);
    expect(session!.assistants).toContain(body1.assistantId);
    expect(session!.assistants).toContain(body2.assistantId);
    expect(session!.tenantId).toBe(tenant);
    await app.close();
  });
});

describe("GET /session/:id/state", () => {
  it("404s for an unknown session", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "GET", url: "/session/nope/state" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
