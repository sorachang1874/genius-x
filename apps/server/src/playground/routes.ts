/**
 * Playground routes (Phase 6.5 Step 3) — the THIRD internet-facing route family
 * (parent-share.md v1.5): token-gated `GET /playground/*`. Uniform 404 throughout.
 * v0 is READ-ONLY (agent-session.md gate ⑤ — no child playground writes exist here).
 *
 * The unlock MINT lives on the PARENT surface (parent-surface.md v1.2:
 * POST /parent/children/:id/playground-session) — registered here so the playground
 * door ships as one unit, but it authenticates with the PARENT token.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ShareServiceError } from "../share/service";
import type { ParentSurfaceService } from "../parent/service";
import { PlaygroundDeniedError, type PlaygroundService } from "./service";

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ShareServiceError) return reply.code(err.httpStatus).send(err.toResponse());
  const e = err as { name?: string; code?: string };
  console.error("[playground-http] unexpected error:", { name: e?.name, code: e?.code });
  return reply.code(500).send({ error: "INTERNAL" });
}

/** Authorization header ONLY (agent-session.md transport ruling — the parent surface's
 *  `?token=` fallback does NOT inherit to this class: query tokens land in proxy logs). */
function tokenOf(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return "";
}

/** Child-at-home surface — playground session token only. */
export function registerPlaygroundRoutes(app: FastifyInstance, service: PlaygroundService): void {
  app.get("/playground/world", async (req, reply) => {
    try {
      const session = await service.resolveSession(tokenOf(req));
      // Uniform 404: the client renders the asleep-world scene, never error copy.
      if (!session) return reply.code(404).send({ error: "PLAYGROUND_NOT_FOUND" });
      return reply.send(await service.worldView(session.studentId, session.expiresAt));
    } catch (err) {
      // Uniform BODY shape on this family (review fix): a vanished student row must be
      // byte-identical to a bad token — never an oracle.
      if (err instanceof ShareServiceError && err.code === "SHARE_NOT_FOUND") {
        return reply.code(404).send({ error: "PLAYGROUND_NOT_FOUND" });
      }
      return sendError(reply, err);
    }
  });
}

/** The unlock mint — PARENT token gated (the second parent write, parent-surface.md v1.2). */
export function registerPlaygroundMint(app: FastifyInstance, parents: ParentSurfaceService, service: PlaygroundService): void {
  app.post("/parent/children/:id/playground-session", async (req, reply) => {
    try {
      const parent = await parents.resolveParent(tokenOf(req));
      if (!parent) return reply.code(404).send({ error: "PARENT_NOT_FOUND" }); // uniform
      const r = await service.mintSession(parent.parentId, (req.params as { id: string }).id);
      return reply.code(201).send(r);
    } catch (err) {
      if (err instanceof ShareServiceError && err.code === "SHARE_NOT_FOUND") {
        return reply.code(404).send({ error: "PARENT_NOT_FOUND" }); // scope = same uniform shape
      }
      if (err instanceof PlaygroundDeniedError) {
        // Structural discriminant (review fix — never detail-substring matching).
        // Gentle parent-facing copy either way; distinct codes so the H5 words them apart.
        return reply.code(409).send({ error: err.kind === "curfew" ? "COMPANION_ASLEEP" : "COMPANION_RESTING" });
      }
      return sendError(reply, err);
    }
  });
}
