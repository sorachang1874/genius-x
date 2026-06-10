/**
 * Workspace HTTP routes (Phase 2) — READS ONLY, per the frozen workspace.md privilege
 * boundary (writes are in-process from the classroom; parent/child clients never write
 * in Phase 2). Operator/admin posture until Phase-3 auth + parent filtering.
 *
 * Error discipline identical to the identity routes: zod strict query shapes → 400
 * INVALID_INPUT (paths/codes only, no values); WorkspaceServiceError → registry status;
 * anything else hits buildHttp's sanitized-500 setErrorHandler backstop.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { WorkspaceService, WorkspaceServiceError } from "./service";

/** Strict (unknown query params → 400, same fail-closed rule as the identity routes). */
const listQuerySchema = z.strictObject({
  limit: z.coerce.number().optional(),
  cursor: z.string().optional(),
});

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof WorkspaceServiceError) {
    return reply.code(err.httpStatus).send(err.toResponse());
  }
  const e = err as { name?: string; code?: string; constraint?: string };
  console.error("[workspace-http] unexpected error:", { name: e?.name, code: e?.code, constraint: e?.constraint });
  return reply.code(500).send({ error: "INTERNAL" });
}

function sendInvalidShape(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const detail = error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join("; ");
  return reply.code(400).send({ error: "INVALID_INPUT", detail });
}

export function registerWorkspaceRoutes(app: FastifyInstance, service: WorkspaceService): void {
  app.get("/students/:id/workspace", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await service.getWorkspaceSummary(id));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  const list = (
    path: string,
    fn: (service: WorkspaceService, id: string, q: { limit?: number; cursor?: string }) => Promise<unknown>,
  ): void => {
    app.get(path, async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) return sendInvalidShape(reply, parsed.error);
      try {
        const { limit, cursor } = parsed.data;
        return reply.send(
          await fn(service, id, { ...(limit !== undefined && { limit }), ...(cursor !== undefined && { cursor }) }),
        );
      } catch (err) {
        return sendError(reply, err);
      }
    });
  };

  list("/students/:id/works", (s, id, q) => s.listWorks(id, q));
  list("/students/:id/interactions", (s, id, q) => s.listInteractions(id, q));
  list("/students/:id/memories", (s, id, q) => s.listMemories(id, q));

  app.get("/works/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await service.getWork(id));
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
