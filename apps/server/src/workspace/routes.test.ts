/**
 * Workspace HTTP routes tests — the read surface over app.inject (status/shape discipline;
 * deep list semantics live in workspace.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Work } from "@genius-x/contracts";
import { InMemorySessionStore } from "../session/store";
import { buildHttp } from "../http";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService } from "./service";

let ctx: IdentityTestContext;
let app: FastifyInstance;
let studentId: string;
let work: Work;

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  const svc = new WorkspaceService(ctx.sql);
  const tenant = await ctx.makeTenant("路由工作区");
  const parentId = await ctx.makeParent(tenant);
  studentId = (
    await ctx.service.enrollStudent({
      parentId,
      displayName: "读取娃",
      age: 7,
      consent: { consentVersion: "v1.0", dataRetentionAgreed: true },
    })
  ).id;
  work = await svc.recordWork({
    studentId,
    type: "avatar_image",
    contentUrl: "fake://a.png",
    metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false },
  });
  await svc.recordWork({
    studentId,
    type: "doodle",
    contentText: "一个圆",
    metadata: { lessonId: "lesson-001", stageId: "shape", degraded: true },
  });
  app = buildHttp(new InMemorySessionStore(), {
    lessonId: "lesson-001",
    lessonConfigVersion: "1.0.0",
    firstStageId: "intro",
    workspace: svc,
  });
});

afterAll(async () => {
  await app.close();
});

describe("workspace read API", () => {
  it("GET /students/:id/workspace → 200 summary; 404 unknown; 400 malformed", async () => {
    const ok = await app.inject({ method: "GET", url: `/students/${studentId}/workspace` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ studentId, workCount: 2 });
    expect((await app.inject({ method: "GET", url: "/students/99999999-9999-4999-8999-999999999976/workspace" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/students/nope/workspace" })).statusCode).toBe(400);
  });

  it("GET /students/:id/works pages over HTTP; strict query (unknown param / bad limit → 400)", async () => {
    const page1 = await app.inject({ method: "GET", url: `/students/${studentId}/works?limit=1` });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json() as { works: Work[]; nextCursor?: string };
    expect(p1.works).toHaveLength(1);
    expect(p1.nextCursor).toBeDefined();
    const page2 = await app.inject({
      method: "GET",
      url: `/students/${studentId}/works?limit=1&cursor=${encodeURIComponent(p1.nextCursor!)}`,
    });
    const p2 = page2.json() as { works: Work[]; nextCursor?: string };
    expect(p2.works).toHaveLength(1);
    expect(p2.nextCursor).toBeUndefined();
    expect(new Set([...p1.works, ...p2.works].map((w) => w.id)).size).toBe(2);

    expect((await app.inject({ method: "GET", url: `/students/${studentId}/works?surprise=1` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/students/${studentId}/works?limit=abc` })).statusCode).toBe(400);
  });

  it("GET /works/:id → 200 full work (operator fields intact); 404; interactions/memories reachable", async () => {
    const ok = await app.inject({ method: "GET", url: `/works/${work.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual(work);
    expect((await app.inject({ method: "GET", url: "/works/99999999-9999-4999-8999-999999999975" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/students/${studentId}/interactions` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/students/${studentId}/memories` })).statusCode).toBe(200);
  });

  it("workspace absent ⇒ read endpoints are not registered (404)", async () => {
    const bare = buildHttp(new InMemorySessionStore(), {
      lessonId: "lesson-001",
      lessonConfigVersion: "1.0.0",
      firstStageId: "intro",
    });
    try {
      for (const url of [
        `/students/${studentId}/workspace`,
        `/students/${studentId}/works`,
        `/works/${work.id}`,
      ]) {
        expect((await bare.inject({ method: "GET", url })).statusCode).toBe(404);
      }
    } finally {
      await bare.close();
    }
  });
});
