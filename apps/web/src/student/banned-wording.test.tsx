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

const BANNED = /\b(ai|prompt|llm|token|model)\b/i;
const player: AiOutputPlayer = { play: vi.fn(async () => {}), imageUrls: (o) => o.imageUrls ?? [] };
const withAvatar: StudentRuntimeState = { ...freshStudentState(), outputs: { avatarUrl: "x" } };

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
];

describe("no banned wording in child-facing UI", () => {
  it.each(cases)("%s has no AI/Prompt/LLM/token/model wording", (_name, ui, session) => {
    const { container, unmount } = renderWithSession(ui, session);
    expect(container.textContent ?? "").not.toMatch(BANNED);
    unmount();
  });
});
