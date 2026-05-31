# Contracts

Prose contracts for shared semantics. Each one owns a domain: owner matrix, allowed
values, derivation, consumers, fallback policy, deletion conditions, and the fast
preflight that catches drift. The typed realization lives in `@genius-x/contracts`.

A field that is not in a contract here is **not ready for normal-path use**.

| Contract | Domain | Status |
| --- | --- | --- |
| [`course-engine.md`](course-engine.md) | Stage state machine + WebSocket classroom sync | skeleton |
| [`ai-gateway.md`](ai-gateway.md) | AI call pipeline: safety, budget, routing, fallback, audit | skeleton |
| [`safety.md`](safety.md) | Input/output review + degradation visibility | skeleton |

To add a new contract, copy the playbook `CONTRACT.template.md`.
