# @genius-x/contracts

**Single source of truth for everything shared across the system.** Frontend, backend,
and the AI gateway all import from here so they cannot drift from each other.

> Agent owner: **Agent E (contracts/schema)**. Changes here are cross-cutting — treat
> every change as a contract change (see `docs/contracts/` and the playbook's
> contract-first rules). Do not let `apps/*` or other packages redefine these types locally.

## What lives here

| Area | What goes in | Status |
| --- | --- | --- |
| Course config schema | `lesson-*.json` shape: stages, durations, unlock rules, aiInteraction blocks | skeleton |
| API types | Request/response types for `apps/server` HTTP endpoints | skeleton |
| WebSocket events | `ServerMessage` / `ClientMessage` union types for classroom sync | skeleton |
| AI response schemas | Validated output shapes returned by `@genius-x/ai-gateway` | skeleton |
| State-machine events | Stage transition events for the course engine | skeleton |
| Shared enums | Stage IDs, roles, artifact types, memory keys | skeleton |
| Error codes | Stable error code registry | skeleton |
| Migration rules | Versioning + how old shapes migrate to new ones | skeleton |

## Source documents

These types are the typed realization of:

- `docs/product/genius-x-mvp-prd.md` (§4 course engine, §5 AI gateway, §6 data model, §8 WebSocket)
- `docs/contracts/*` (the prose contracts — owner matrices, allowed values, deletion conditions)

## Rule

If a field affects user-visible behavior or workflow recovery, define it here **before**
relying on it, and give it an owner matrix in `docs/contracts/`. A field that is not in a
contract doc is not ready for normal-path use.
