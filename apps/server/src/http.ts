/**
 * Thin Fastify HTTP layer: room-code join (no password — Better Auth is shadow) + a
 * read-only session-state endpoint. MVP: the room code IS the session id.
 *
 * Phase 1 (Step 5): a STUDENT join requires the persistent `studentId` from enrollment —
 * looked up via the Identity Service, tenant-checked against the session, displayName
 * pre-filled from the profile. NO ephemeral fallback (enrollment.md → Migration): a student
 * join that cannot be resolved fails LOUDLY for operators (400/404/403/503) while the child
 * UI renders it as a warm non-failure (Agent B; frozen child-facing reconciliation).
 * Assistants/teachers keep ephemeral registration (they have no persistent identity yet).
 */
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import type { Role, SessionJoinRequest, SessionJoinResponse, ClassSession, Student, TraceSink } from "@genius-x/contracts";
import type { SessionStore } from "./session/store";
import { IdentityServiceError, type IdentityService } from "./identity/service";
import { registerIdentityRoutes } from "./identity/routes";
import type { WorkspaceService } from "./workspace/service";
import { registerWorkspaceRoutes } from "./workspace/routes";
import type { ShareService } from "./share/service";
import { registerPublicShareRoute, registerOperatorShareRoutes } from "./share/routes";
import { freshStudentState } from "./sync/controller";

const ROLES: ReadonlySet<string> = new Set(["student", "assistant", "teacher", "parent", "admin"] satisfies Role[]);

/**
 * The seeded demo tenant (migrations/001_phase1_identity_seed.sql) — the Phase-1 default
 * session tenant, so the Step-5 join check `student.tenantId === session.tenantId` matches
 * enrolled demo students. The migration test asserts seed ↔ this constant stay in sync.
 */
export const DEFAULT_DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

export interface HttpOptions {
  lessonId: string;
  lessonConfigVersion: string;
  firstStageId: string;
  /**
   * Phase 1 (Step 5): ONE tenant per server process — set from TENANT_ID in live/production
   * (fail-closed at boot, see index.ts); the demo default is dev-only. Per-room/class
   * tenant resolution is deferred (docs/DEFERRED.md DF-v2-12).
   */
  tenantId?: string;
  /**
   * Identity Service (Phase 1). Absent ⇒ enrollment/admin endpoints are NOT registered
   * (404) — a deployment mode, not a fallback: the composition root logs the disabled
   * state loudly (operator-visible), and student joins 503.
   */
  identity?: IdentityService;
  /** Workspace Service (Phase 2). Absent ⇒ workspace READ endpoints not registered (404). */
  workspace?: WorkspaceService;
  /** Share Service (Phase 3). Absent ⇒ GET /share/:token not registered (404). */
  share?: ShareService;
  /**
   * Parent web origin for the mint route's composed capability URL (the server is the
   * SINGLE URL composer — parent-share.md). Default: dev Vite origin.
   */
  webBaseUrl?: string;
  /**
   * CORS origin. "*" for dev (separate Vite/Fastify origins); pin via CORS_ORIGIN in
   * operator deployments — identity/workspace endpoints carry child PII, no auth until P3.
   */
  corsOrigin?: string;
  /**
   * Operator-visible counting (enrollment.md: "the operator sees the real 400/404/403 +
   * COUNT"): every refused student join records a join_rejected trace. Optional — the
   * default no-op keeps tests/dev terse; server.ts threads its real sink.
   */
  trace?: TraceSink;
}

export function buildHttp(store: SessionStore, options: HttpOptions): FastifyInstance {
  const { lessonId, lessonConfigVersion, firstStageId, identity, workspace, share, trace } = options;
  const tenantId = options.tenantId ?? DEFAULT_DEMO_TENANT_ID;
  const corsOrigin = options.corsOrigin ?? "*";
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

  // EXPOSURE POSTURES (parent-share.md "Deployment exposure rule"): everything below until
  // the public share route is OPERATOR-bounded (unauthenticated child PII — never
  // internet-exposed until Better Auth); GET /share/:token is the ONE route an
  // internet-facing proxy may forward (plus the static H5).
  if (identity) registerIdentityRoutes(app, identity);
  if (workspace) registerWorkspaceRoutes(app, workspace);
  if (share) registerOperatorShareRoutes(app, share, options.webBaseUrl ?? "http://localhost:5173");
  // --- public surface ---
  if (share) registerPublicShareRoute(app, share);

  /** Fresh session shell (create-if-absent), bound to this server's tenant. */
  const newSession = (sessionId: string): ClassSession => ({
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
  });

  /**
   * Refuse a student join — LOUDLY (frozen reconciliation: "the operator still sees the
   * real 400/404/403 + count; only the child sees warmth"): operator log (ids only, never
   * PII) + a counted join_rejected trace + the contract-shaped wire body.
   */
  const rejectJoin = (
    reply: FastifyReply,
    status: number,
    error: string,
    ctx: Record<string, unknown>,
    detail?: string,
  ): FastifyReply => {
    console.error(`[HTTP] student join refused: ${error}`, ctx);
    trace?.record({
      at: new Date().toISOString(),
      kind: "join_rejected",
      payload: { error, status, ...ctx },
    });
    return reply.code(status).send({ error, ...(detail ? { detail } : {}) });
  };

  app.post("/session/join", async (req, reply) => {
    const body = (req.body ?? {}) as SessionJoinRequest;
    const sessionId = typeof body.roomCode === "string" ? body.roomCode.trim() : "";
    if (sessionId === "" || sessionId.length > 128) {
      // ≤128 keeps the session id valid as workspace.sessionId (DB CHECK) downstream.
      return reply.code(400).send({ error: "INVALID_INPUT", detail: "roomCode is required (<=128 chars)" });
    }
    const role = body.role ?? "student";
    if (!ROLES.has(role)) {
      // Unknown role must not fall through to the ephemeral branch (session-shell spam +
      // a non-Role echoed in the response would violate the frozen SessionJoinResponse).
      return reply.code(400).send({ error: "INVALID_INPUT", detail: "unknown role" });
    }

    if (role === "student") {
      // --- Phase 1 persistent join: lookup, never mint (no ephemeral fallback) ---
      if (!identity) {
        // Identity is a CORE dependency for student joins (enrollment.md: DB down ⇒ new
        // joins fail loudly). Operator-visible; the child UI shows a warm non-failure.
        return rejectJoin(reply, 503, "IDENTITY_UNAVAILABLE", { sessionId, reason: "identity_not_wired" });
      }
      if (!body.studentId) {
        return rejectJoin(reply, 400, "INVALID_INPUT", { sessionId, reason: "missing_studentId" }, "studentId is required for student join");
      }
      let student: Student | null;
      try {
        student = await identity.getStudent(body.studentId);
      } catch (err) {
        if (err instanceof IdentityServiceError) {
          return rejectJoin(reply, err.httpStatus, err.code, { sessionId, studentId: body.studentId }, err.detail);
        }
        return rejectJoin(reply, 503, "IDENTITY_UNAVAILABLE", {
          sessionId,
          reason: "identity_lookup_failed",
          name: (err as Error)?.name,
          code: (err as { code?: string })?.code,
        });
      }
      if (!student) {
        return rejectJoin(reply, 404, "STUDENT_NOT_FOUND", { sessionId, studentId: body.studentId });
      }
      const resolved = student;

      // atomic: create-if-absent + tenant check + register, without racing concurrent joins
      const outcome = await store.update(sessionId, async (current) => {
        const session: ClassSession = current ?? newSession(sessionId);
        if (resolved.tenantId !== session.tenantId) {
          return { out: "TENANT_MISMATCH" as const }; // no `next`: a rejected join persists nothing
        }
        if (!session.students[resolved.id]) {
          const state = freshStudentState();
          // Profile is the source of truth for the 伙伴出生证 — the join-body `name` is
          // IGNORED for students (a client cannot override the enrolled identity).
          state.displayName = resolved.displayName;
          session.students[resolved.id] = state;
        } else {
          // Idempotent re-join (reconnect mid-class): runtime state kept, but the one
          // profile-owned field refreshes — the profile stays the source of truth even
          // if a parent renamed the child since the first join.
          session.students[resolved.id]!.displayName = resolved.displayName;
        }
        return { next: session, out: "OK" as const };
      });
      if (outcome === "TENANT_MISMATCH") {
        return rejectJoin(reply, 403, "TENANT_MISMATCH", { sessionId, studentId: resolved.id });
      }
      const res: SessionJoinResponse = { studentId: resolved.id, sessionId, role };
      return reply.send(res);
    }

    // --- assistants/teachers: ephemeral registration (unchanged; no persistent identity yet) ---
    const assistantId = role === "assistant" ? randomUUID() : undefined;
    await store.update(sessionId, async (current) => {
      const session: ClassSession = current ?? newSession(sessionId);
      if (assistantId && !session.assistants.includes(assistantId)) {
        session.assistants.push(assistantId);
      }
      return { next: session, out: undefined };
    });
    const res: SessionJoinResponse = {
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
