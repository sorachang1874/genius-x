# Contract: AI Gateway

> Status: **skeleton** — fill before implementing M2. Code: `packages/ai-gateway`.

## Purpose

The single entry point for all AI calls (LLM / TTS / ASR / image gen). Business code never
touches a provider SDK directly. The gateway owns safety, budget, routing, fallback, audit.

## Pipeline (PRD §5.2)

```
request-builder → safety-filter(input) → token-budget → provider-router
  → safety-filter(output) → fallback(on fail/timeout/filtered) → audit-logger
```

## Provider routing — intentionally NOT a frozen contract

Routing is a flexible abstraction: primary/fallback providers are swappable by design.
What IS contractual: the gateway's **public capability interface** and its **output
schemas** (validated, in `@genius-x/contracts`) — callers depend on those, not on which
provider answered.

## Fallback / degradation

- Preset fallback responses per stage (PRD §5.3.3). Used on timeout / failure / filtered.
- **Invisible to the child; every use is logged + counted + surfaced in metrics**
  (see `safety.md` and the degradation principle in `AGENTS.md`).
- Switch policy: primary fails 3× → secondary; secondary fails → local fallback library.

## Token / cost budget (PRD §5.4)

Per-request and per-student-per-class ceilings; on exceed → truncate or fallback, **never
error to the child**. Treat budgets as tunable config, not a hard-frozen contract.

## Prompt templates

Each template (`icebreak_v1`, ...) is a versioned contract — see the playbook
`PROMPT_CONTRACT.template.md`: input vars, output schema, eval set, safety constraints,
fallback responses. Versioned for audit, review, batch eval comparison, and rollback.

## Audit

Every request/response logged (redacted). Do not store raw child audio (PRD §10.3):
discard audio immediately after ASR.
