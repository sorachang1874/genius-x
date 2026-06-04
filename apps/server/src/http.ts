/**
 * Thin Fastify HTTP layer: room-code join (no password — Better Auth is shadow) + a
 * read-only session-state endpoint. MVP: the room code IS the session id.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import type { SessionJoinRequest, SessionJoinResponse, ClassSession } from "@genius-x/contracts";
import type { SessionStore } from "./session/store";
import { freshStudentState } from "./sync/controller";

export function buildHttp(
  store: SessionStore,
  lessonId: string,
  lessonConfigVersion: string,
  firstStageId: string,
): FastifyInstance {
  const app = Fastify();

  // Enable CORS for cross-origin requests (dev: separate origins for Vite + Fastify)
  void app.register(cors, { origin: "*" });

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
