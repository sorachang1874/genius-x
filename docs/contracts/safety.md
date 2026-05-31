# Contract: Safety & Degradation

> Status: **skeleton**. Highest-priority contract — AI must never emit unsafe content to a
> child. General principles here mirror the playbook's safety-and-degradation doc.

## Two-direction review

Every AI exchange is reviewed on both sides:

- **Input review** — child input is checked before it shapes a prompt.
- **Output review** — every AI text/image output is checked before it reaches a client.

On a failed check, substitute a fallback response (never surface the rejection to the child).

## Output filters (PRD §5.3.2)

| Filter | Mechanism | On trigger |
| --- | --- | --- |
| Sensitive words | configurable child-safety word list | replace with fallback |
| Length | per-output token cap (~150) | truncate + graceful close |
| Format anomaly | detect broken JSON / code blocks / URLs | replace with fallback |
| Provider content-safety | external text-safety API (optional) | block + fallback |

Image outputs pass content-safety before display (PRD §10.3).

## Degradation visibility (the key principle)

A degraded/fallback response is **invisible to the child but visible to operators**:
logged, counted, surfaced in preflight/metrics. Never a silent normal path. A rising
fallback rate is an incident signal, not a quiet success.

## Incident response

When unsafe output is caught (or escapes): record the input, prompt version, provider,
and filter verdict; reproduce offline in `tools/safety-experiments/`; tighten the filter
or prompt contract; add a regression case before closing.

## System-prompt constraints (PRD §5.3.1)

Role lock, simple/warm language, content no-go zones, always-positive tone, identity
boundary, on-topic, no code/URL/PII output. These live in each prompt contract.
