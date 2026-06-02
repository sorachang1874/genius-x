# Contract: Safety & Degradation

> Owner: **Agent D** (enforced inside `packages/ai-gateway`). Cross-cutting boundary —
> highest priority: AI must never emit unsafe content to a child. Types: `SafetyResult`
> (`@genius-x/contracts`). Reuse: 天御 TMS/IMS + keyword pre-filter.

## Public interface

- `reviewInput(text) → SafetyResult` — screen child input before it shapes a prompt.
- `reviewOutput(text|image) → SafetyResult` — screen every AI output before it reaches a client.

`SafetyResult { ok, action: "pass"|"filtered"|"fallback", reasons[] }`. Enforced at ONE
boundary (the gateway), not scattered across consumers.

## Layered filters (PRD §5.3.2)

| Layer | Mechanism | On trigger |
| --- | --- | --- |
| Keyword pre-filter | in-process child-safety word list | replace with fallback |
| 天御 TMS (text) | Tencent text moderation, minor-protection mode | block + fallback |
| 天御 IMS (image) | moderate doodle input + every generated image before display | block + fallback |
| Length / format | output token cap (~150); detect broken JSON / code / URL / PII | truncate / fallback |

## Consumes / Produces

- **Consumes:** 天御 moderation APIs, keyword list (configurable), system-prompt constraints.
- **Produces:** `SafetyResult`; on block → substitutes a fallback (child sees no rejection);
  logs the verdict (operator-visible).

## SLO

- Review latency must fit inside the capability budget (it is part of the ≤8s / ≤15s path).
- Degradation visibility: every filtered/fallback event logged + counted; a rising rate is
  an incident signal, not a quiet success.

## Acceptance criteria

- Unsafe text/image never reaches a client (substituted by a fallback).
- Generated images pass IMS **before** display; child input screened before prompting.
- Every block/fallback is recorded with cause; child sees only a positive output.
- System-prompt constraints (PRD §5.3.1: role lock, simple/warm tone, no-go topics, identity
  boundary, on-topic, no code/URL/PII) are present in each prompt contract.

## Failure mode

**Primary, non-optional.** Safety must hold even when shadow systems are down. A preflight
asserts the safety pipeline is wired on both input and output paths.

## Incident response

Record input + prompt version + provider + verdict → reproduce offline in
`tools/safety-experiments/` → tighten filter/prompt → add a regression case before closing.
