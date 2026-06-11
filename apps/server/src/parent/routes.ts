/**
 * Parent surface routes (Phase 6, parent-surface.md) — TOKEN-GATED (Bearer/?token=):
 * the exposure rule extends to `GET/POST /parent/*` only; the operator MINT stays at the
 * identity-admin posture. Uniform 404 throughout (no oracle: unknown token = expired
 * token = not-your-child).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Work } from "@genius-x/contracts";
import { ShareServiceError, scrubDeniedKeys } from "../share/service";
import { WorkspaceServiceError, type WorkspaceService } from "../workspace/service";
import type { ParentSurfaceService } from "./service";

const noteSchema = z.strictObject({ text: z.string() });

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ShareServiceError) return reply.code(err.httpStatus).send(err.toResponse());
  // listWorks throws these (e.g. malformed ?cursor=) — routine bad input, never a 500
  if (err instanceof WorkspaceServiceError) return reply.code(err.httpStatus).send(err.toResponse());
  const e = err as { name?: string; code?: string };
  console.error("[parent-http] unexpected error:", { name: e?.name, code: e?.code });
  return reply.code(500).send({ error: "INTERNAL" });
}

function tokenOf(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return (req.query as { token?: string })?.token ?? "";
}

/** PUBLIC-ish (token-gated) parent surface. */
export function registerParentRoutes(app: FastifyInstance, service: ParentSurfaceService, workspace: WorkspaceService): void {
  const resolve = async (req: FastifyRequest, reply: FastifyReply): Promise<{ parentId: string } | null> => {
    const parent = await service.resolveParent(tokenOf(req));
    if (!parent) {
      void reply.code(404).send({ error: "PARENT_NOT_FOUND" }); // uniform — token or scope, no oracle
      return null;
    }
    return parent;
  };

  app.get("/parent/children", async (req, reply) => {
    try {
      const parent = await resolve(req, reply);
      if (!parent) return reply;
      return reply.send({ children: await service.listChildren(parent.parentId) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/parent/children/:id/timeline", async (req, reply) => {
    try {
      const parent = await resolve(req, reply);
      if (!parent) return reply;
      const timeline = await service.timeline(parent.parentId, (req.params as { id: string }).id);
      if (!timeline) return reply.code(404).send({ error: "PARENT_NOT_FOUND" }); // scope = same uniform shape
      return reply.send(timeline);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/parent/children/:id/works", async (req, reply) => {
    try {
      const parent = await resolve(req, reply);
      if (!parent) return reply;
      const studentId = (req.params as { id: string }).id;
      // Scope gate: one indexed single-row query (review fix — the timeline-as-gate
      // coupling ran the full projection just to discard it).
      const scoped = await service.scopedStudent(parent.parentId, studentId);
      if (!scoped) return reply.code(404).send({ error: "PARENT_NOT_FOUND" });
      const cursor = (req.query as { cursor?: string })?.cursor;
      const page = await workspace.listWorks(studentId, cursor !== undefined ? { cursor } : {});
      // The parent-share DENY discipline extends: scrub contentJson; strip operator
      // metadata + internal ids from the wire (the Phase-2 read shape is operator-tier).
      const dropped: string[] = [];
      const works = page.works.map((w: Work) => ({
        type: w.type,
        ...(w.contentUrl !== undefined && { contentUrl: w.contentUrl }),
        ...(w.contentText !== undefined && { contentText: w.contentText }),
        ...(w.contentJson !== undefined && { contentJson: scrubDeniedKeys(w.contentJson, dropped) as Record<string, unknown> }),
        ...(w.thumbnailUrl !== undefined && { thumbnailUrl: w.thumbnailUrl }),
        createdAt: w.createdAt,
      }));
      if (dropped.length > 0) console.warn("[parent-scrub] dropped DENIED keys:", { keys: dropped });
      return reply.send({ works, ...(page.nextCursor !== undefined && { nextCursor: page.nextCursor }) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/parent/children/:id/note", async (req, reply) => {
    try {
      const parent = await resolve(req, reply);
      if (!parent) return reply;
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", detail: "body must be { text }" });
      const r = await service.addNote(parent.parentId, (req.params as { id: string }).id, { text: parsed.data.text });
      return reply.code(201).send(r);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

/** OPERATOR mint (identity-admin posture — never internet-exposed). Raw token ONCE. */
export function registerParentAccessMint(app: FastifyInstance, service: ParentSurfaceService): void {
  app.post("/parents/:id/access", async (req, reply) => {
    try {
      return reply.code(201).send(await service.mintAccess((req.params as { id: string }).id));
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
