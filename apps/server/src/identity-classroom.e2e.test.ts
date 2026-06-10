/**
 * Phase 1 END-TO-END (Step 6, the handbook's DoD scenario): parent enrolls over HTTP →
 * student joins the classroom with the PERSISTENT id → real Socket.IO lesson walk
 * intro→closure → the profile in PostgreSQL (PGlite) shows the completed lesson and the
 * companion fields the class produced. The full MVP→Phase-1 loop, over real transports.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ClientMessage, ServerMessage, Student } from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { InMemorySessionStore } from "./session/store";
import { startClassroomServer, type ServerHandle } from "./server";
import { newIdentityTestContext, type IdentityTestContext } from "./identity/identity.testutil";

const ROOM = "phase1-e2e";

function connect(url: string, sessionId: string, studentId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { sessionId, studentId }, transports: ["websocket"], forceNew: true, reconnection: false, timeout: 5000 });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 15);
    };
    tick();
  });
}

let ctx: IdentityTestContext;
let tenant: string;
let handle: ServerHandle;
/** Event-driven completion signal: the write-back emits traces — no DB polling needed. */
const traces: { kind: string; payload: Record<string, unknown> }[] = [];

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  tenant = await ctx.makeTenant("E2E校区");
  handle = await startClassroomServer({
    port: 0,
    host: "127.0.0.1",
    store: new InMemorySessionStore(),
    identity: ctx.service,
    tenantId: tenant,
    trace: { record: (e) => traces.push(e) },
  });
});

afterAll(async () => {
  await handle.close();
});

describe("Phase 1 — enroll → join → full lesson → profile persists", () => {
  it("runs the whole loop over real HTTP + WebSocket and lands in PostgreSQL", async () => {
    let sock: Socket | undefined;
    try {
      // 1. ENROLL over the real HTTP API (parent → student with consent).
      const parentRes = await fetch(`${handle.url}/parents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, phoneNumber: "+8613100000001" }),
      });
      expect(parentRes.status).toBe(201);
      const { parentId } = (await parentRes.json()) as { parentId: string };

      const enrollRes = await fetch(`${handle.url}/students`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentId,
          displayName: "全链路",
          age: 7,
          consent: { consentVersion: "v1.0", dataRetentionAgreed: true },
        }),
      });
      expect(enrollRes.status).toBe(201);
      const student = (await enrollRes.json()) as Student;
      expect(student.progress.completedLessonIds).toEqual([]); // nothing yet

      // 2. JOIN the classroom with the persistent id.
      const joinRes = await fetch(`${handle.url}/session/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: ROOM, studentId: student.id }),
      });
      expect(joinRes.status).toBe(200);
      expect(((await joinRes.json()) as { studentId: string }).studentId).toBe(student.id);

      // Assistant registers too (drives the stage unlocks).
      const assistantRes = await fetch(`${handle.url}/session/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: ROOM, role: "assistant" }),
      });
      const { assistantId } = (await assistantRes.json()) as { assistantId: string };

      // 3. CLASS over the real socket: resume shows the PROFILE name, then walk to closure.
      sock = await connect(handle.url, ROOM, student.id);
      const got: ServerMessage[] = [];
      sock.on("server_message", (m: ServerMessage) => got.push(m));
      const send = (m: ClientMessage): void => {
        sock!.emit("client_message", m);
      };
      const unlocked = (stageId: string) => () => got.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === stageId);

      send({ type: "HELLO", studentId: student.id });
      const resume = await waitFor(() => got.find((m) => m.type === "RESUME_STATE"));
      expect(resume.type === "RESUME_STATE" && resume.you.displayName).toBe("全链路"); // from the profile

      send({ type: "ASSISTANT_UNLOCK", stageId: "icebreak", assistantId });
      await waitFor(unlocked("icebreak"));
      send({ type: "ASSISTANT_UNLOCK", stageId: "shape", assistantId });
      await waitFor(unlocked("shape"));
      // The child picks an avatar — this output must land on the persistent profile.
      send({ type: "STAGE_COMPLETE", studentId: student.id, stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "cos://e2e/avatar.png" } });
      send({ type: "ASSISTANT_UNLOCK", stageId: "talent", assistantId });
      await waitFor(unlocked("talent"));
      send({ type: "FORCE_ADVANCE", stageId: "birth", assistantId }); // talent gate needs AI turns; operator advance
      await waitFor(unlocked("birth"));
      // Wait for the pre-generated birth speech to be READY before completing the stage —
      // pins the prepared→profile speech path deterministically (the late-prepare race has
      // its own dedicated controller test).
      await waitFor(() => got.find((m) => m.type === "AI_READY"));
      send({ type: "STAGE_COMPLETE", studentId: student.id, stageId: "birth", payload: { kind: "done" } });
      send({ type: "TEACHER_UNLOCK", stageId: "closure" });
      await waitFor(unlocked("closure"));

      // 4. PROFILE PERSISTS — EVENT-DRIVEN: await the write-back's own completion trace
      // (fire-and-forget has no synchronous signal; the trace IS the event), then a single
      // DB read asserts the durable state. No polling of the database.
      await waitFor(() => traces.find((t) => t.payload.reason === "profile_writeback_ok" && t.payload.studentId === student.id));
      const updated = (await ctx.service.getStudent(student.id))!;
      expect(updated.progress.completedLessonIds).toEqual([lesson001.lessonId]);
      expect(updated.geniusX.avatarUrl).toBe("cos://e2e/avatar.png"); // Shape output landed
      expect(typeof updated.geniusX.birthdaySpeech).toBe("string"); // Birth speech landed too
      expect(updated.geniusX.birthdaySpeech!.length).toBeGreaterThan(0);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(student.updatedAt));

      // 5. IDEMPOTENT: the next lesson run of the same lesson doesn't duplicate.
      await ctx.service.recordLessonCompletion(student.id, lesson001.lessonId, {});
      const again = await ctx.service.getStudent(student.id);
      expect(again!.progress.completedLessonIds).toEqual([lesson001.lessonId]);
    } finally {
      sock?.disconnect();
    }
  }, 20000);

  it("PER-STUDENT ISOLATION: one student's write-back failure never stops the others nor the class", async () => {
    // Two students at closure: one REAL enrolled UUID and one bogus dev-style id. The class
    // must reach closure; the real student's profile must persist; the bogus one must fail
    // with a typed operator trace only.
    const localTraces: { kind: string; payload: Record<string, unknown> }[] = [];
    const store = new InMemorySessionStore();
    const local = await startClassroomServer({
      port: 0,
      host: "127.0.0.1",
      store,
      identity: ctx.service,
      tenantId: tenant,
      trace: { record: (e) => localTraces.push(e) },
    });
    let sock: Socket | undefined;
    try {
      const parentRes = await fetch(`${local.url}/parents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, phoneNumber: "+8613100000002" }),
      });
      const { parentId } = (await parentRes.json()) as { parentId: string };
      const real = (await (
        await fetch(`${local.url}/students`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentId, displayName: "隔离真", age: 8, consent: { consentVersion: "v1.0", dataRetentionAgreed: true } }),
        })
      ).json()) as Student;

      const fresh = () => ({ stageStatus: { birth: "completed" as const }, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {}, memories: {}, pendingMemory: [], prepared: {} });
      await store.save({
        sessionId: "wb-fail",
        tenantId: tenant,
        lessonId: lesson001.lessonId,
        lessonConfigVersion: lesson001.lessonConfigVersion,
        classId: "wb-fail",
        currentStageId: "birth",
        global: "active",
        stageStartTime: new Date().toISOString(),
        students: { [real.id]: fresh(), "not-a-real-student": fresh() },
        assistants: ["a1"],
      });
      sock = await connect(local.url, "wb-fail", real.id);
      const got: ServerMessage[] = [];
      sock.on("server_message", (m: ServerMessage) => got.push(m));
      sock.emit("client_message", { type: "TEACHER_UNLOCK", stageId: "closure" } satisfies ClientMessage);
      await waitFor(() => got.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "closure")); // class advanced fine

      // Event-driven: both outcomes arrive as traces — failure for the bogus id…
      await waitFor(() => localTraces.find((t) => t.payload.reason === "profile_writeback_failed"));
      const failed = localTraces.find((t) => t.payload.reason === "profile_writeback_failed");
      expect(failed?.payload.studentId).toBe("not-a-real-student");
      expect(failed?.payload.error).toBe("INVALID_INPUT"); // typed code only — no raw message/PII
      // …and SUCCESS for the real student (isolation: the failure did not stop the loop).
      await waitFor(() => localTraces.find((t) => t.payload.reason === "profile_writeback_ok" && t.payload.studentId === real.id));
      const persisted = (await ctx.service.getStudent(real.id))!;
      expect(persisted.progress.completedLessonIds).toEqual([lesson001.lessonId]);
    } finally {
      sock?.disconnect();
      await local.close();
    }
  }, 20000);
});
