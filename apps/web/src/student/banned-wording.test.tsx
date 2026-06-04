/**
 * Hard product rule (AGENTS.md): NO "AI / Prompt / LLM / token / model" wording in any
 * child-facing UI — the magic泥人 is a friend, not a model. This scans the rendered text of
 * every child-facing stage (in each of its states) and fails if any banned token appears.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import type { AiOutputPlayer } from "../shared/ai-output";
import type { StudentRuntimeState } from "@genius-x/contracts";
import { Thinking } from "../shared/thinking";
import { fakeSession, renderWithSession, freshStudentState } from "../test/session-fixture";
import { Standby } from "./stages/Standby";
import { Intro } from "./stages/Intro";
import { Icebreak } from "./stages/Icebreak";
import { Shape } from "./stages/Shape";
import { Talent } from "./stages/Talent";
import { Birth } from "./stages/Birth";
import { Closure } from "./stages/Closure";

const BANNED = /\b(ai|prompt|llm|token|model)\b/i;
const player: AiOutputPlayer = { play: vi.fn(async () => {}), imageUrls: (o) => o.imageUrls ?? [] };
const withAvatar: StudentRuntimeState = { ...freshStudentState(), outputs: { avatarUrl: "x" } };
const withMemories: StudentRuntimeState = { ...freshStudentState(), outputs: { avatarUrl: "x" }, memories: { favorite_toy: "积木" }, displayName: "小明" };

const cases: Array<[string, ReactNode, ReturnType<typeof fakeSession>]> = [
  ["standby", <Standby key="s" />, fakeSession()],
  ["intro", <Intro key="i" />, fakeSession()],
  ["thinking", <Thinking key="t" />, fakeSession()],
  ["icebreak-idle", <Icebreak key="ii" stageId="icebreak" player={player} />, fakeSession()],
  ["icebreak-thinking", <Icebreak key="it" stageId="icebreak" player={player} />, fakeSession({ pendingInteractionId: "p" })],
  ["shape-doodle", <Shape key="sd" stageId="shape" player={player} />, fakeSession()],
  ["shape-thinking", <Shape key="st" stageId="shape" player={player} />, fakeSession({ pendingInteractionId: "p" })],
  ["shape-candidates", <Shape key="sc" stageId="shape" player={player} />, fakeSession({ lastOutput: { interactionId: "x", output: { imageUrls: ["a", "b", "c"] } } })],
  ["shape-chosen", <Shape key="sx" stageId="shape" player={player} />, fakeSession({ you: withAvatar })],
  ["talent", <Talent key="tl" stageId="talent" player={player} />, fakeSession()],
  ["birth-preparing", <Birth key="bp" stageId="birth" player={player} />, fakeSession()],
  ["birth-played", <Birth key="bx" stageId="birth" player={player} />, fakeSession({ readyPrepared: { stageId: "birth", preparedId: "p1", outputKind: "audio" }, lastOutput: { interactionId: "p1", output: { text: "你好呀，好朋友" } }, you: withMemories })],
  ["closure", <Closure key="cl" stageId="closure" />, fakeSession({ you: withMemories })],
];

describe("no banned wording in child-facing UI", () => {
  it.each(cases)("%s has no AI/Prompt/LLM/token/model wording", (_name, ui, session) => {
    const { container, unmount } = renderWithSession(ui, session);
    expect(container.textContent ?? "").not.toMatch(BANNED);
    unmount();
  });
});
