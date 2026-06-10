/**
 * E-M1 end-to-end smoke: a real Socket.IO client drives Lesson 1 intro→closure over the
 * actual server transport (Fastify + Socket.IO), then reconnects and resumes. Proves the
 * thin transport glue (socket.ts) + controller + store work together. No AI (the talent
 * gate, which needs INTERACTION_DONE from the M2 gateway, is crossed via FORCE_ADVANCE here).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ClassSession, ClientMessage, ServerMessage, StudentRuntimeState } from "@genius-x/contracts";
import { InMemorySessionStore } from "./session/store";
import { startClassroomServer, type ServerHandle } from "./server";

const NOW = "2026-06-03T00:00:00.000Z";

function fresh(): StudentRuntimeState {
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {}, memories: {}, pendingMemory: [], prepared: {} };
}
function seed(): ClassSession {
  return {
    sessionId: "demo", tenantId: "demo-tenant", lessonId: "lesson-001", lessonConfigVersion: "1.4.0", classId: "demo",
    currentStageId: "intro", global: "standby", stageStartTime: NOW,
    students: { k1: fresh() }, assistants: ["a1"],
  };
}

function connect(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { sessionId: "demo", studentId: "k1" }, transports: ["websocket"], forceNew: true, reconnection: false, timeout: 5000 });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
function waitFor<T>(check: () => T | undefined, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

let store: InMemorySessionStore;
let handle: ServerHandle;

beforeAll(async () => {
  store = new InMemorySessionStore();
  await store.save(seed());
  handle = await startClassroomServer({ port: 0, host: "127.0.0.1", store, trace: { record: () => {} } });
});
afterAll(async () => {
  await handle.close();
});

describe("E-M1 — Lesson 1 over the real socket", () => {
  it("walks intro→closure and resumes on reconnect", async () => {
    let sock: Socket | undefined;
    let sock2: Socket | undefined;
    try {
    sock = await connect(handle.url);
    const socket = sock;
    const got: ServerMessage[] = [];
    socket.on("server_message", (m: ServerMessage) => got.push(m));
    const send = (m: ClientMessage): void => {
      socket.emit("client_message", m);
    };
    const unlocked = (stageId: string) => () => got.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === stageId);

    send({ type: "HELLO", studentId: "k1" });
    await waitFor(() => got.find((m) => m.type === "RESUME_STATE"));

    send({ type: "ASSISTANT_UNLOCK", stageId: "icebreak", assistantId: "a1" });
    await waitFor(unlocked("icebreak"));
    send({ type: "ASSISTANT_UNLOCK", stageId: "shape", assistantId: "a1" });
    await waitFor(unlocked("shape"));

    // real guard: child picks an avatar → shape→talent
    send({ type: "STAGE_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "u1" } });
    send({ type: "ASSISTANT_UNLOCK", stageId: "talent", assistantId: "a1" });
    await waitFor(unlocked("talent"));

    // talent→birth gate is minInteractions (INTERACTION_DONE arrives from the gateway in M2);
    // force-advance for this M1 smoke
    send({ type: "FORCE_ADVANCE", stageId: "birth", assistantId: "a1" });
    await waitFor(unlocked("birth"));
    send({ type: "STAGE_COMPLETE", studentId: "k1", stageId: "birth", payload: { kind: "done" } });
    send({ type: "TEACHER_UNLOCK", stageId: "closure" });
    await waitFor(unlocked("closure"));

    expect((await store.load("demo"))!.currentStageId).toBe("closure");

    // reconnect → RESUME_STATE reflects the authoritative closure state
    socket.disconnect();
    sock2 = await connect(handle.url);
    const socket2 = sock2;
    const got2: ServerMessage[] = [];
    socket2.on("server_message", (m: ServerMessage) => got2.push(m));
    socket2.emit("client_message", { type: "HELLO", studentId: "k1" } satisfies ClientMessage);
    const resume = await waitFor(() => got2.find((m) => m.type === "RESUME_STATE"));
    expect(resume.type === "RESUME_STATE" && resume.currentStageId).toBe("closure");
    } finally {
      sock?.disconnect();
      sock2?.disconnect();
    }
  }, 20000);
});
