/**
 * M4a end-to-end smoke (fake providers): drive the talent → birth → closure tail over the real
 * socket transport. Proves contracts-v1.4 wiring: talent interactions mine memory + settle
 * `pendingMemory`; birth-unlock pre-generates the 专属台词 and signals AI_READY; `playPrepared`
 * replays the stored output ONLY after ready; projection is control-surface + readiness gated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ClassSession, ClientMessage, ServerMessage, StudentRuntimeState } from "@genius-x/contracts";
import { InMemorySessionStore } from "./session/store";
import { startClassroomServer, type ServerHandle } from "./server";

const NOW = "2026-06-04T00:00:00.000Z";

function fresh(): StudentRuntimeState {
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {}, memories: {}, pendingMemory: [], prepared: {} };
}
function seed(): ClassSession {
  return {
    sessionId: "demo-m4", tenantId: "demo-tenant", lessonId: "lesson-001", lessonConfigVersion: "1.1.0", classId: "demo-m4",
    currentStageId: "talent", global: "active", stageStartTime: NOW,
    students: { k1: fresh() }, assistants: ["a1"],
  };
}

function connect(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { sessionId: "demo-m4", studentId: "k1" }, transports: ["websocket"], forceNew: true, reconnection: false, timeout: 5000 });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
function waitFor<T>(check: () => T | undefined, timeoutMs = 4000): Promise<T> {
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

describe("M4a — talent → birth → closure over the real socket", () => {
  it("mines memory, pre-generates the speech, replays it, projects, and closes", async () => {
    let sock: Socket | undefined;
    try {
      sock = await connect(handle.url);
      const socket = sock;
      const got: ServerMessage[] = [];
      socket.on("server_message", (m: ServerMessage) => got.push(m));
      const send = (m: ClientMessage): void => { socket.emit("client_message", m); };
      const count = (t: ServerMessage["type"]): number => got.filter((m) => m.type === t).length;

      send({ type: "HELLO", studentId: "k1" });
      await waitFor(() => got.find((m) => m.type === "RESUME_STATE"));

      // ready-gate: a playPrepared before anything is prepared must emit NOTHING (no blank).
      send({ type: "INTERACT", studentId: "k1", stageId: "birth", interactionId: "early", input: { kind: "playPrepared", preparedId: "ghost" } });

      // two talent answers → two AI replies; meets the talent→birth gate (minInteractions:2)
      send({ type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentAnswer", audioRef: "ref1" } });
      await waitFor(() => (count("AI_OUTPUT") >= 1 ? true : undefined));
      send({ type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i2", input: { kind: "talentAnswer", audioRef: "ref2" } });
      await waitFor(() => (count("AI_OUTPUT") >= 2 ? true : undefined));

      // birth unlock → server pre-generates the speech → AI_READY (after memories settle)
      send({ type: "ASSISTANT_UNLOCK", stageId: "birth", assistantId: "a1" });
      await waitFor(() => got.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "birth"));
      const ready = await waitFor(() => got.find((m) => m.type === "AI_READY"));
      const preparedId = ready.type === "AI_READY" ? ready.preparedId : "";
      expect(preparedId).toBeTruthy();
      expect(ready.type === "AI_READY" && ready.outputKind).toBe("audio");

      // pendingMemory drained (memories settled) and the prepared entry is ready in authoritative state
      const session = (await store.load("demo-m4"))!;
      expect(session.students.k1!.pendingMemory).toEqual([]);
      expect(session.students.k1!.prepared[preparedId]!.ready).toBe(true);

      // tap the big button → replay the stored speech (a NEW AI_OUTPUT, keyed by preparedId)
      const before = count("AI_OUTPUT");
      send({ type: "INTERACT", studentId: "k1", stageId: "birth", interactionId: "play1", input: { kind: "playPrepared", preparedId } });
      await waitFor(() => (count("AI_OUTPUT") > before ? true : undefined));
      expect(got.some((m) => m.type === "AI_OUTPUT" && m.interactionId === preparedId)).toBe(true);

      // project to the big screen (control-surface + ready gated)
      send({ type: "STAGE_COMPLETE", studentId: "k1", stageId: "birth", payload: { kind: "done" } });
      send({ type: "REQUEST_PROJECTION", studentId: "k1", requestedBy: "a1" });
      const projected = await waitFor(() => got.find((m) => m.type === "PROJECT"));
      expect(projected.type === "PROJECT" && projected.studentId).toBe("k1");

      // teacher closes the class
      send({ type: "TEACHER_UNLOCK", stageId: "closure" });
      await waitFor(() => got.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "closure"));
      expect((await store.load("demo-m4"))!.currentStageId).toBe("closure");

      // the early (not-ready) playPrepared never produced an output
      expect(got.some((m) => m.type === "AI_OUTPUT" && m.interactionId === "ghost")).toBe(false);
    } finally {
      sock?.disconnect();
    }
  }, 20000);
});
