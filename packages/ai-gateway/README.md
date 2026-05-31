# @genius-x/ai-gateway

**The single entry point for every AI call.** Business code never calls an AI provider
directly — it calls the gateway, which owns safety, budget, routing, and fallback.

> Agent owner: **Agent D (AI gateway)**. Contract: `docs/contracts/ai-gateway.md`.

## Responsibilities (see PRD §5)

1. **Request building** — assemble prompts from versioned templates, inject student profile.
2. **Safety filter** — input + output review. AI must never emit unsafe content to a child.
3. **Token / cost budget** — per-student, per-stage ceilings; truncate, never error.
4. **Provider routing** — primary / fallback providers behind one interface (flexible, not
   a frozen contract — providers are swappable by design).
5. **Fallback library** — preset responses when AI times out / fails / is filtered.
   **Invisible to the child, but every fallback use is logged and counted** (see the
   playbook's "user-invisible fallback must stay operator-visible" principle).
6. **Audit log** — every request/response recorded (redacted) for review and rollback.

## Design rule

The course state machine must advance **regardless of AI success**. If AI fails, the
gateway returns a fallback so the classroom never stalls — and records that it did so.

## Prompt templates

Each template (`icebreak_v1`, `shape_dialogue_v1`, ...) is a **versioned contract**:
input variables, output schema, eval set, safety constraints, fallback responses. Track
them with the playbook `PROMPT_CONTRACT` template. Output is validated against a schema
in `@genius-x/contracts` before it reaches a client.
