/**
 * Thin Fastify HTTP layer: room-code join (no password — Better Auth is shadow) + a
 * read-only session-state endpoint. MVP: the room code IS the session id.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import type { SessionJoinRequest, SessionJoinResponse, ClassSession } from "@genius-x/contracts";
import type { SessionStore } from "./session/store";
import type { IdentityService } from "./identity/service";
import { registerIdentityRoutes } from "./identity/routes";
import { freshStudentState } from "./sync/controller";

/**
 * The seeded demo tenant (migrations/001_phase1_identity_seed.sql) — the Phase-1 default
 * session tenant, so the Step-5 join check `student.tenantId === session.tenantId` matches
 * enrolled demo students. The migration test asserts seed ↔ this constant stay in sync.
 */
export const DEFAULT_DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

export function buildHttp(
  store: SessionStore,
  lessonId: string,
  lessonConfigVersion: string,
  firstStageId: string,
  // Phase 1: single demo tenant; real per-room tenant resolution lands in Step 5
  // (the persistent-join rewrite). See identity.md.
  tenantId = DEFAULT_DEMO_TENANT_ID,
  // Identity Service (Phase 1 Step 4). Absent ⇒ enrollment/admin endpoints are NOT
  // registered (404) — a deployment mode, not a fallback: the composition root logs the
  // disabled state loudly (operator-visible), and Step 5 will require it for student joins.
  identity?: IdentityService,
  // CORS origin. "*" for dev (separate Vite/Fastify origins); pin via CORS_ORIGIN in
  // operator deployments — identity endpoints carry child PII and have no auth until Phase 3.
  corsOrigin: string = "*",
): FastifyInstance {
  const app = Fastify();

  void app.register(cors, { origin: corsOrigin });

  // Contract-shape backstop for errors that never reach a route's own try/catch:
  //   - Fastify body-parser failures (FST_ERR_CTP_*: malformed/empty JSON, wrong
  //     content-type) → 400 INVALID_INPUT (they bypass the zod boundary entirely);
  //   - anything else → sanitized 500 INTERNAL.
  // NEVER err.message on the wire or in logs: Fastify's default handler serializes it
  // verbatim, and DB/internal messages can carry row contents (child names = PII).
  app.setErrorHandler((err, _req, reply) => {
    const code = (err as { code?: string })?.code;
    console.error("[http] unhandled error:", { name: (err as Error)?.name, code });
    if (typeof code === "string" && code.startsWith("FST_ERR_CTP_")) {
      return reply.code(400).send({ error: "INVALID_INPUT", detail: code });
    }
    return reply.code(500).send({ error: "INTERNAL" });
  });

  if (identity) registerIdentityRoutes(app, identity);

  app.post("/session/join", async (req, reply) => {
    const body = req.body as SessionJoinRequest;
    const sessionId = body.roomCode; // MVP: room code is the session id
    const role = body.role ?? "student";
    const studentId = role === "student" ? randomUUID() : undefined;
    const assistantId = role === "assistant" ? randomUUID() : undefined;

    console.log(`[HTTP] /session/join: role=${role}, studentId=${studentId}, assistantId=${assistantId}`);

    // atomic: create-if-absent + add this student/assistant, without racing concurrent joins
    await store.update(sessionId, async (current) => {
      const session: ClassSession = current ?? {
        sessionId,
        tenantId,
        lessonId,
        lessonConfigVersion,
        classId: sessionId,
        currentStageId: firstStageId,
        global: "standby",
        stageStartTime: new Date().toISOString(),
        students: {},
        assistants: [],
      };

      if (role === "assistant") {
        // register assistant if not already registered
        if (assistantId && !session.assistants.includes(assistantId)) {
          session.assistants.push(assistantId);
        }
      } else {
        // student join logic
        if (!studentId) throw new Error("studentId should be defined for student role");
        const student = freshStudentState();
        const name = body.name?.trim();
        if (name) student.displayName = name; // for the 伙伴出生证 (contracts-v1.4)
        session.students[studentId] = student;
        console.log(`[HTTP] Added student ${studentId} to session. Total students: ${Object.keys(session.students).length}`);
      }

      console.log(`[HTTP] Session students after update: ${JSON.stringify(Object.keys(session.students))}`);
      return { next: session, out: undefined };
    });

    const res: SessionJoinResponse = {
      ...(studentId && { studentId }),
      sessionId,
      role,
      ...(assistantId && { assistantId }),
    };
    return reply.send(res);
  });

  app.get("/session/:id/state", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await store.load(id);
    if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    return reply.send(session);
  });

  return app;
}
