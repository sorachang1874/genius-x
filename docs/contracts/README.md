# Contracts

Prose contracts for shared semantics. Each one owns a domain: owner matrix, allowed
values, derivation, consumers, fallback policy, deletion conditions, and the fast
preflight that catches drift. The typed realization lives in `@genius-x/contracts`.

A field that is not in a contract here is **not ready for normal-path use**.

Each boundary contract states: public interface (typed IO), consumes/produces, SLOs,
acceptance criteria, and failure mode. Internal module design is NOT frozen here — it is
produced per-task as a design note and lead-reviewed before coding (docs/agents/README.md).

## MVP Contracts (Classroom-centric, ephemeral sessions)

| Contract | Domain | Status |
| --- | --- | --- |
| [`course-engine.md`](course-engine.md) | Stage state machine + WebSocket classroom sync | boundary v1 |
| [`ai-gateway.md`](ai-gateway.md) | AI capability surface: safety, budget, routing, fallback, audit | boundary v1 |
| [`client-server.md`](client-server.md) | iPad client ↔ server wire protocol | boundary v1 |
| [`safety.md`](safety.md) | Input/output review + degradation visibility | boundary v1 |
| [`data-and-privacy.md`](data-and-privacy.md) | Data-asset retention + children's privacy/compliance | frozen v0 |

## Scalable Architecture v2.0 Contracts (Phase 1+)

These contracts support the transition from classroom-centric ephemeral sessions to
student-centric persistent workspaces with AI agents that co-evolve with children.

See `docs/architecture/scalable-architecture-v2.md` for the full design.

| Contract | Domain | Status | Phase |
| --- | --- | --- | --- |
| [`identity.md`](identity.md) | Student/parent persistent identity, tenant model, guardian consent | **frozen v1** | Phase 1 |
| [`enrollment.md`](enrollment.md) | Enrollment API surface, error codes, classroom-join migration | **frozen v1** | Phase 1 |
| [`workspace.md`](workspace.md) | Student workspace: works, interactions, memories | **frozen v1** | Phase 2 |
| `agent.md` | Per-student AI agent: context building, memory retrieval | planned — not yet authored | Phase 4 |
| `tool.md` | Tool registry and tool-calling framework | planned — not yet authored | Phase 5 |
| `parent-share.md` | Parent read-only artifact + co-working | planned — not yet authored | Phase 3/6 |
| `content.md` | Media storage, processing, and CDN delivery | planned — not yet authored | Phase 7 |

**Contract freeze protocol**: Phase N contracts are authored and frozen by the lead
before Phase N implementation begins. Workers import contracts read-only.

See also `docs/architecture/interaction-map.md` for the cross-module call/event flows.

To add a new contract, copy the playbook `CONTRACT.template.md` from
`../../../ai-assisted-engineering-playbook/templates/`.
