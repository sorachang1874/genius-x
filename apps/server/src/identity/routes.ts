/**
 * Identity HTTP routes (Phase 1, Step 4) — the six frozen endpoints from enrollment.md,
 * wired onto the Fastify app that buildHttp creates.
 *
 * Error discipline (frozen + review-mandated):
 *   - zod shape failure        → 400 INVALID_INPUT (detail = issue paths/codes, never values)
 *   - IdentityServiceError     → err.httpStatus + err.toResponse() (the contract registry)
 *   - anything else            → 500 sanitized: logs ONLY err.name/code/constraint — never
 *     err.message/err.detail, which for DB errors can carry row contents (child names = PII).
 *     500 is deliberately OFF the IdentityErrorCode registry: it is an undefined failure,
 *     not a contract failure mode.
 *
 * POST /parents: the service's `created` flag drives 201 (new) vs 200 (existing) and is
 * STRIPPED from the body — the wire shape is exactly the frozen CreateParentResponse.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
import type {
  ConsentInput,
  CreateParentRequest,
  CreateParentResponse,
  EnrollStudentRequest,
  UpdateStudentRequest,
} from "@genius-x/contracts";
import { IdentityService, IdentityServiceError } from "./service";
import {
  createParentRequestSchema,
  enrollStudentRequestSchema,
  listTenantStudentsQuerySchema,
  updateConsentRequestSchema,
  updateStudentRequestSchema,
} from "./schemas";

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof IdentityServiceError) {
    return reply.code(err.httpStatus).send(err.toResponse());
  }
  // Unexpected error: loud for operators, sanitized on the wire and in logs (no PII).
  const e = err as { name?: string; code?: string; constraint?: string };
  console.error("[identity-http] unexpected error:", {
    name: e?.name,
    code: e?.code,
    constraint: e?.constraint,
  });
  return reply.code(500).send({ error: "INTERNAL" });
}

/**
 * Bridge zod output to the frozen contract types under exactOptionalPropertyTypes: zod types
 * absent optionals as `T | undefined`, the contracts as `field?: T` (same constraint noted in
 * schemas.ts / engine/validate.ts). Sound ONLY for JSON.parse-derived input: JSON cannot carry
 * own `undefined` values and zod v4 emits no keys for absent optionals, so the shallow strip
 * (nested optionals rely on those invariants) plus cast is faithful at this HTTP boundary —
 * do not reuse on non-JSON sources that may pass explicit undefineds.
 */
function toContract<T>(parsed: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as T;
}

/** 400 INVALID_INPUT from a zod failure — paths + issue codes only, never received values. */
function sendInvalidShape(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const detail = error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`)
    .join("; ");
  return reply.code(400).send({ error: "INVALID_INPUT", detail });
}

export function registerIdentityRoutes(app: FastifyInstance, service: IdentityService): void {
  app.post("/parents", async (req, reply) => {
    const parsed = createParentRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalidShape(reply, parsed.error);
    try {
      const { created, ...body } = await service.createParent(toContract<CreateParentRequest>(parsed.data));
      return reply.code(created ? 201 : 200).send(body satisfies CreateParentResponse);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/students", async (req, reply) => {
    const parsed = enrollStudentRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalidShape(reply, parsed.error);
    try {
      return reply.code(201).send(await service.enrollStudent(toContract<EnrollStudentRequest>(parsed.data)));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/students/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const student = await service.getStudent(id); // malformed id throws INVALID_INPUT
      if (!student) return reply.code(404).send({ error: "STUDENT_NOT_FOUND" });
      return reply.send(student);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/students/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // strictObject: smuggled server-owned keys (geniusX/progress) are REJECTED here —
    // the parent-privilege boundary (enrollment.md owner matrix).
    const parsed = updateStudentRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalidShape(reply, parsed.error);
    try {
      return reply.send(await service.updateStudent(id, toContract<UpdateStudentRequest>(parsed.data)));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/students/:id/consent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateConsentRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalidShape(reply, parsed.error);
    try {
      return reply.send(await service.updateConsent(id, toContract<ConsentInput>(parsed.data)));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Admin-only by operator convention in Phase 1 (auth = Phase 3; enrollment.md → Scope).
  app.get("/tenants/:id/students", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = listTenantStudentsQuerySchema.safeParse(req.query);
    if (!parsed.success) return sendInvalidShape(reply, parsed.error);
    try {
      const { limit, cursor } = parsed.data;
      return reply.send(
        await service.listTenantStudents(id, {
          ...(limit !== undefined && { limit }),
          ...(cursor !== undefined && { cursor }),
        }),
      );
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
