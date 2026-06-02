# Contracts

Prose contracts for shared semantics. Each one owns a domain: owner matrix, allowed
values, derivation, consumers, fallback policy, deletion conditions, and the fast
preflight that catches drift. The typed realization lives in `@genius-x/contracts`.

A field that is not in a contract here is **not ready for normal-path use**.

Each boundary contract states: public interface (typed IO), consumes/produces, SLOs,
acceptance criteria, and failure mode. Internal module design is NOT frozen here — it is
produced per-task as a design note and lead-reviewed before coding (docs/agents/README.md).

| Contract | Domain | Status |
| --- | --- | --- |
| [`course-engine.md`](course-engine.md) | Stage state machine + WebSocket classroom sync | boundary v1 |
| [`ai-gateway.md`](ai-gateway.md) | AI capability surface: safety, budget, routing, fallback, audit | boundary v1 |
| [`client-server.md`](client-server.md) | iPad client ↔ server wire protocol | boundary v1 |
| [`safety.md`](safety.md) | Input/output review + degradation visibility | boundary v1 |
| [`data-and-privacy.md`](data-and-privacy.md) | Data-asset retention + children's privacy/compliance | frozen v0 |

See also `docs/architecture/interaction-map.md` for the cross-module call/event flows.

To add a new contract, copy the playbook `CONTRACT.template.md`.
