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
| [`workspace.md`](workspace.md) | Student workspace: works, interactions, memories | **frozen v1.1** (v1 + Phase-4/4.5 pending amendments) | Phase 2 |
| [`agent-context.md`](agent-context.md) | Agent context: hot/cold split, turn buffer, `LlmRequest.history`, episodic memory, safety parity, budget floor | **frozen v1** (implementation: Phase 4 Steps 2–5) | Phase 4 |
| [`ip-character.md`](ip-character.md) | IP character entity: layered canon model, version snapshots, works lineage, GeniusXProfile transition | **frozen v1** (implementation: Phase 4.5) | Phase 4.5 |
| [`brand-style.md`](brand-style.md) | Brand style: gateway-level injection rule + trace stamping (binding); style VALUES are v0 placeholders pending the brand design doc (DF-v2-18) | **frozen v0** (injection rule implemented) | Phase 4+ (values: external) |
| [`tool.md`](tool.md) | Tools = in-scene creation instruments: closed gateway-bound mechanics, brand composition, no-free-text inputs, `image_refine` | **frozen v1** (implementation: P5 Step 3) | Phase 5 |
| [`scene.md`](scene.md) | Scene library + in-class selection (decision ⑤); scene==stage formalized; mechanics×prompts rule | **frozen v1** (owner = C, lead decision 2026-06-10; implementation: P5 Step 2) | Phase 5 |
| [`parent-share.md`](parent-share.md) | Parent read-only share artifact (capability URL, privacy filter, deployment exposure rule — v1.4 adds token-gated `/parent/*`) | **frozen v1.4** | Phase 3 (co-working = Phase 6) |
| [`parent-surface.md`](parent-surface.md) | Authenticated parent home: capability-token auth seam (SMS/WeChat mint later), growth timeline, co-working v1 = the relayed parent note | **frozen v1** (implementation: P6 Steps 2-3) | Phase 6 |
| `content.md` | Media storage, processing, and CDN delivery | planned — not yet authored | Phase 7 |

**Contract freeze protocol**: Phase N contracts are authored and frozen by the lead
before Phase N implementation begins. Workers import contracts read-only.

See also `docs/architecture/interaction-map.md` for the cross-module call/event flows.

To add a new contract, copy the playbook `CONTRACT.template.md` from
`../../../ai-assisted-engineering-playbook/templates/`.
