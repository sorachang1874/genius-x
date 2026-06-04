# Contract: Data Asset & Privacy

> Status: **frozen v0** (2026-06-02). First-class, safety/legal-critical contract.
> Reconciles two duties: **treat compliant interaction data as an asset** (so the product is
> observable, verifiable, and improvable) **and** protect children rigorously.

## Principle

We deliberately retain *structured, compliant* interaction signals so we can measure
experience quality, run evals, and find optimization direction — instead of storing nothing
and being stuck unable to improve. We never retain raw biometric data. Data minimization +
purpose limitation, under 《未成年人网络保护条例》.

## What we STORE (assets) — with purpose

| Data | Purpose | Notes |
| --- | --- | --- |
| ASR **transcripts** (text) | eval, memory extraction, quality review | derived text only — see "never store" |
| Interaction **events** (clicks, choices, stage timings, completions) | observability, funnel/SLO analysis | no PII beyond student id |
| AI **request/response** (redacted) + prompt version | review, regression eval, rollback | via TraceSink; redacted before write |
| **Fallback / degradation** occurrences | operator-visible degradation, incident signal | counts + cause |
| **Memory** data points + **artifacts** (avatar, story, birth cert) | the product output itself | per StudentProfile |
| Live **runtime state** `memories` / `prepared` (contracts-v1.4) | drive the 伙伴出生证 + instant birth playback | derived signals + renderable refs (text/audioUrl), **never raw audio**; in Redis during class, archived with the session |
| **Feedback / eval labels** | continuous product improvement | human + LLM-judge scores |

## What we NEVER store

- **Raw child audio** — discard immediately after ASR (PRD §10.3). No voiceprint/biometrics.
- PII beyond what a lesson needs; no contact info, location, device identifiers as identity.
- Anything that would let AI output leak PII (gateway forbids PII in output).

## Controls (owner matrix)

| Aspect | Rule | Owner |
| --- | --- | --- |
| Redaction | strip PII before any log/trace write | AI gateway (D) |
| Retention | each data class has a defined retention window; expire on schedule | server (C) |
| Access | student data not exposed via public API; role-gated | server (C) |
| Transit | HTTPS / WSS everywhere (PRD §10.3) | infra |
| Residency | store in-China (Tencent Cloud); no cross-border child data | infra |
| Consent | guardian consent governs collection + use | product / F |

## Failure mode

This is a primary-path contract, not a shadow system: privacy enforcement (no raw audio,
redaction, residency) is **non-optional** and must hold even when shadow systems are down.
A preflight should assert no raw audio is persisted and that traces are redacted.
