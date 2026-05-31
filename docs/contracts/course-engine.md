# Contract: Course Engine (stage state machine + classroom sync)

> Status: **skeleton** — fill before implementing M1. Typed in `@genius-x/contracts`.

## Purpose

Govern how a class progresses through lesson stages and how that state syncs across
student iPads, the assistant, and the teacher screen over WebSocket.

## Stages (PRD §4.1)

`standby → intro → icebreak → shape → talent → birth → closure`

| Stage | Unlock by | Advance condition |
| --- | --- | --- |
| intro | teacher | assistant unlock |
| icebreak | assistant | assistant unlock |
| shape | assistant | child selects avatar + assistant confirm |
| talent | assistant | min interactions reached + assistant unlock |
| birth | assistant | all children done |
| closure | teacher | — |

## Owner matrix (fill in)

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion condition | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `currentStage` | course runtime | session state (Redis) | the 7 StageIds | reducer on unlock events | student UI, assistant UI | none | — | stage parity test |
| `stageStatus` (per student) | course runtime | session state | waiting / in_progress / completed | set on stage events | assistant UI | none | — | — |

## WebSocket messages (PRD §8.1) — define in @genius-x/contracts

- Server → client: `STAGE_UNLOCK`, `GLOBAL_STATE`, `AI_READY`
- Client → server: `STAGE_COMPLETE`, `ASSISTANT_UNLOCK`, `REQUEST_PROJECTION`

## Failure behavior

- Reconnect with exponential backoff; on reconnect, request current class state and resume.
- The state machine must advance independently of AI success.
- Profiles/artifacts persist after each interaction (no data loss on refresh).
