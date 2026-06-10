/**
 * Phase 1 END-TO-END (Step 6, the handbook's DoD scenario): parent enrolls over HTTP →
 * student joins the classroom with the PERSISTENT id → real Socket.IO lesson walk
 * intro→closure → the profile in PostgreSQL (PGlite) shows the completed lesson and the
 * companion fields the class produced. The full MVP→Phase-1 loop, over real transports.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type {
  ClientMessage,
  ServerMessage,
  Student,
  ListWorksResponse,
  ListInteractionsResponse,
  ListMemoriesResponse,
  WorkspaceSummaryResponse,
} from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { AiGateway, FakeProvider, KeywordSafetyFilter, PresetFallbackLibrary } from "@genius-x/ai-gateway";
import { InMemorySessionStore } from "./session/store";
import { startClassroomServer, type ServerHandle } from "./server";
import { WorkspaceService } from "./workspace/service";
import { ShareService, type NotificationSink } from "./share/service";
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
/** Phase 3: the notification sink IS the share-ready event. */
const shareLinks: { studentId: string; studentDisplayName: string; lessonId: string; url: string; hasArtifacts: boolean }[] = [];
const captureSink: NotificationSink = { lessonShareReady: (info) => { shareLinks.push(info); } };

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  tenant = await ctx.makeTenant("E2E校区");
  // Canned gateway content: the LLM text doubles as the memory-extraction JSON, so the
  // talent interaction deterministically mines favorite_toy=积木 (and the birth speech
  // becomes the same string — content realism is irrelevant here, plumbing is the point).
  const gateway = new AiGateway({
    provider: new FakeProvider({}, { llmText: '{"key":"favorite_toy","value":"积木"}', transcript: "我最喜欢积木" }),
    safety: new KeywordSafetyFilter(),
    fallback: new PresetFallbackLibrary(),
    trace: { record: (e) => traces.push(e) },
    now: () => new Date().toISOString(),
  });
  handle = await startClassroomServer({
    port: 0,
    host: "127.0.0.1",
    store: new InMemorySessionStore(),
    identity: ctx.service,
    workspace: new WorkspaceService(ctx.sql),
    share: new ShareService(ctx.sql),
    notify: captureSink,
    webBaseUrl: "http://parent.test",
    gateway,
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
      // A REAL exchange: voice in → AI reply out (this must land in the workspace).
      send({ type: "INTERACT", studentId: student.id, stageId: "icebreak", interactionId: "e2e-i1", input: { kind: "voice", audioRef: "ref://e2e-voice-1" } });
      await waitFor(() => got.find((m) => m.type === "AI_OUTPUT" && m.interactionId === "e2e-i1"));
      send({ type: "ASSISTANT_UNLOCK", stageId: "shape", assistantId });
      await waitFor(unlocked("shape"));
      // The child picks an avatar — this output must land on the persistent profile.
      send({ type: "STAGE_COMPLETE", studentId: student.id, stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "cos://e2e/avatar.png" } });
      send({ type: "ASSISTANT_UNLOCK", stageId: "talent", assistantId });
      await waitFor(unlocked("talent"));
      // A memory-mining exchange: the canned gateway extracts favorite_toy=积木.
      send({ type: "INTERACT", studentId: student.id, stageId: "talent", interactionId: "e2e-i2", input: { kind: "talentAnswer", option: "积木", audioRef: "ref://e2e-voice-2" } });
      await waitFor(() => got.find((m) => m.type === "AI_OUTPUT" && m.interactionId === "e2e-i2"));
      send({ type: "FORCE_ADVANCE", stageId: "birth", assistantId }); // talent gate needs more turns; operator advance
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

      // 6. WORKSPACE (Phase 2): the class left a portfolio behind — read it over REAL HTTP.
      // Successful workspace writes are fire-and-forget with NO success event, so the reads
      // POLL until the expected rows appear (causal ordering), then assert exactly once.
      const get = async <T>(path: string): Promise<T> => {
        const res = await fetch(`${handle.url}${path}`);
        expect(res.status).toBe(200);
        return (await res.json()) as T;
      };
      await (async () => {
        const deadline = Date.now() + 5000;
        for (;;) {
          const [w, m] = await Promise.all([
            get<ListWorksResponse>(`/students/${student.id}/works`),
            get<ListMemoriesResponse>(`/students/${student.id}/memories`),
          ]);
          const types = new Set(w.works.map((x) => x.type));
          const linked = m.memories.some((x) => x.context.sourceInteractionId !== undefined);
          if (types.has("avatar_image") && types.has("birth_certificate") && linked) return;
          if (Date.now() > deadline) throw new Error("workspace rows did not land in time");
          await new Promise((r) => setTimeout(r, 25));
        }
      })();
      // Works: the chosen avatar + the birth certificate (both from stage completions).
      const works = await get<ListWorksResponse>(`/students/${student.id}/works`);
      const byType = new Map(works.works.map((w) => [w.type, w]));
      expect(byType.has("avatar_image")).toBe(true);
      expect(byType.get("avatar_image")!.contentUrl).toBe("cos://e2e/avatar.png");
      expect(works.works).toHaveLength(2); // EXACTLY once each — no duplicate artifacts
      const cert = byType.get("birth_certificate");
      expect(cert).toBeDefined();
      expect(cert!.contentJson).toMatchObject({
        studentName: "全链路",
        avatarUrl: "cos://e2e/avatar.png",
        lessonId: lesson001.lessonId,
      });
      // personality/background were never mined in this flow ⇒ PARTIAL certificate ⇒
      // the amended contract requires metadata.degraded = true (operator-visible).
      expect(cert!.metadata.degraded).toBe(true);
      expect((cert!.contentJson as { memories: { label: string; value: string }[] }).memories).toContainEqual(
        { label: "最喜欢的玩具", value: "积木" }, // lesson certificate label applied
      );
      // Interactions: both exchanges persisted with refs (never bytes) + transcripts.
      const interactions = await get<ListInteractionsResponse>(`/students/${student.id}/interactions`);
      expect(interactions.interactions.length).toBeGreaterThanOrEqual(2);
      const voice = interactions.interactions.find((i) => i.input.contentRef === "ref://e2e-voice-1");
      expect(voice).toBeDefined();
      expect(voice!.input.text).toBe("我最喜欢积木"); // ASR transcript, the allowed textual form
      expect(voice!.output.degraded).toBe(false);
      // Memories: mined + LINKED into its source interaction record.
      const memories = await get<ListMemoriesResponse>(`/students/${student.id}/memories`);
      const toy = memories.memories.find((m) => m.key === "favorite_toy");
      expect(toy).toBeDefined();
      expect(toy!.value).toBe("积木");
      expect(toy!.importance).toBe(0.5); // baseline until Phase 4
      const sourceId = toy!.context.sourceInteractionId;
      expect(sourceId).toBeDefined();
      const linked = interactions.interactions.find((i) => i.id === sourceId);
      expect(linked?.memoriesExtracted).toContain(toy!.id);
      // Summary counts line up.
      const summary = await get<WorkspaceSummaryResponse>(`/students/${student.id}/workspace`);
      expect(summary.workCount).toBe(2); // exact: a duplicate-write regression must fail here
      expect(summary.interactionCount).toBe(2);
      expect(summary.memoryCount).toBe(1);

      // 7. PARENT SHARE (Phase 3): lesson end auto-minted a capability link (the sink IS
      // the event) — open it over REAL HTTP and verify the filtered view.
      await waitFor(() => shareLinks.find((l) => l.studentDisplayName === "全链路"));
      const link = shareLinks.find((l) => l.studentDisplayName === "全链路")!;
      expect(link.url).toMatch(/^http:\/\/parent\.test\/\?share=[A-Za-z0-9_-]{43}$/);
      expect(link.hasArtifacts).toBe(true); // completed artifact stages ⇒ not a hollow link
      const shareToken = new URL(link.url).searchParams.get("share")!;
      const shareRes = await fetch(`${handle.url}/share/${shareToken}`);
      expect(shareRes.status).toBe(200);
      const shareJson = await shareRes.text();
      const view = JSON.parse(shareJson) as { studentDisplayName: string; certificate?: Record<string, unknown>; works: { type: string }[] };
      expect(view.studentDisplayName).toBe("全链路");
      expect(view.certificate).toMatchObject({ studentName: "全链路", avatarUrl: "cos://e2e/avatar.png" });
      expect(view.works.map((w) => w.type)).toEqual(["avatar_image"]); // cert not repeated
      // DENY list holds on the real wire (the strictest privacy boundary in the system).
      for (const denied of ["aiParams", "degraded", "sessionId", "stageId", "studentId", "tenantId", "parentId"]) {
        expect(shareJson).not.toContain(denied);
      }
      expect(traces.some((t) => t.payload.reason === "share_mint_ok")).toBe(true); // counted
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
