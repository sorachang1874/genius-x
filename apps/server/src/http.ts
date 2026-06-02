/**
 * Thin Fastify HTTP layer: room-code join (no password — Better Auth is shadow) + a
 * read-only session-state endpoint. MVP: the room code IS the session id.
 */
import Fastify, { type FastifyInstance } from "fastify";
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

  app.post("/session/join", async (req, reply) => {
    const body = req.body as SessionJoinRequest;
    const sessionId = body.roomCode; // MVP: room code is the session id
    let session = await store.load(sessionId);
    if (!session) {
      const fresh: ClassSession = {
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
      session = fresh;
    }
    const studentId = randomUUID();
    session.students[studentId] = freshStudentState();
    await store.save(session);
    const res: SessionJoinResponse = { studentId, sessionId, role: "student" };
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
