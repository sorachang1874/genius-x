/**
 * Share endpoints (Phase 3) — split by EXPOSURE POSTURE (parent-share.md "Deployment
 * exposure rule"): the public share GET is the ONE route an internet-facing proxy may
 * forward; the operator mint stays with the identity-admin posture (never internet-exposed
 * until Better Auth). Registering them through separate functions keeps the public surface
 * explicit and lets a future second listener mount ONLY the public route (DF-v2-16).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ShareService, ShareServiceError } from "./service";

const mintBodySchema = z.strictObject({ lessonId: z.string() });

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ShareServiceError) {
    return reply.code(err.httpStatus).send(err.toResponse());
  }
  const e = err as { name?: string; code?: string; constraint?: string };
  console.error("[share-http] unexpected error:", { name: e?.name, code: e?.code, constraint: e?.constraint });
  return reply.code(500).send({ error: "INTERNAL" });
}

/**
 * The PUBLIC surface — the ONE unauthenticated read in the system, gated by the capability
 * token. Uniform 404 (no validity oracle); the raw token is never logged (error paths log
 * code/name only, never params).
 */
export function registerPublicShareRoute(app: FastifyInstance, service: ShareService): void {
  app.get("/share/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      return reply.send(await service.getShareView(token));
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

/**
 * OPERATOR mint (same unauthenticated-but-operator-bounded posture as the identity admin
 * endpoints — never internet-exposed in Phase 3; auth arrives with Better Auth). The raw
 * token appears in this response exactly once. The response also carries the composed
 * capability `url` — the server (webBaseUrl) is the SINGLE URL composer, so the operator
 * tool can never print a wrong-origin link around a valid token.
 */
export function registerOperatorShareRoutes(app: FastifyInstance, service: ShareService, webBaseUrl: string): void {
  app.post("/students/:id/share", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = mintBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", detail: "body must be { lessonId }" });
    }
    try {
      const minted = await service.mintShareToken({ studentId: id, lessonId: parsed.data.lessonId });
      return reply.code(201).send({ ...minted, url: `${webBaseUrl}/?share=${minted.token}` });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
