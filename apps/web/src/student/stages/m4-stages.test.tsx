/**
 * M4b stage components: Talent dispatches the right INTERACT + shows progress; Birth gates on
 * AI_READY, plays via playPrepared, then assembles the 伙伴出生证 from authoritative `you`; Closure
 * renders the certificate.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AiOutputPlayer } from "../../shared/ai-output";
import type { StudentRuntimeState } from "@genius-x/contracts";
import { fakeSession, renderWithSession, freshStudentState } from "../../test/session-fixture";
import { Talent } from "./Talent";
import { Birth } from "./Birth";
import { Closure } from "./Closure";

const noopPlayer: AiOutputPlayer = { play: vi.fn(async () => {}), imageUrls: (o) => o.imageUrls ?? [] };
const youWith = (over: Partial<StudentRuntimeState>): StudentRuntimeState => ({ ...freshStudentState(), ...over });

describe("Talent", () => {
  it("renders the config option cards and dispatches a talentOption INTERACT", () => {
    const session = fakeSession();
    renderWithSession(<Talent stageId="talent" player={noopPlayer} />, session);
    const sing = screen.getByRole("button", { name: /唱首歌/ });
    fireEvent.click(sing);
    expect(session.interact).toHaveBeenCalledWith("talent", { kind: "talentOption", option: "sing" });
  });

  it("dispatches a talentAnswer INTERACT on hold-to-talk and shows remaining-count progress", async () => {
    const session = fakeSession({ you: youWith({ interactionCounts: { talent: 1 } }) });
    renderWithSession(
      <Talent stageId="talent" player={noopPlayer} voiceDeps={{ getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream, mkRef: () => "ref-t" }} />,
      session,
    );
    expect(screen.getByText(/再玩 1 个/)).toBeTruthy(); // need 2, done 1
    const mic = screen.getByRole("button", { name: /回答好朋友/ });
    fireEvent.pointerDown(mic);
    await waitFor(() => expect(mic.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.pointerUp(mic);
    await waitFor(() => expect(session.interact).toHaveBeenCalledWith("talent", { kind: "talentAnswer", audioRef: "ref-t" }));
  });
});

describe("Birth", () => {
  it("shows a preparing state until a prepared output is ready", () => {
    renderWithSession(<Birth stageId="birth" player={noopPlayer} />, fakeSession());
    expect(screen.getByRole("status").textContent).toContain("准备");
    expect(screen.queryByTestId("play-prepared")).toBeNull();
  });

  it("shows the play button on AI_READY and dispatches playPrepared", () => {
    const session = fakeSession({ readyPrepared: { stageId: "birth", preparedId: "p1", outputKind: "audio" } });
    renderWithSession(<Birth stageId="birth" player={noopPlayer} />, session);
    fireEvent.click(screen.getByTestId("play-prepared"));
    expect(session.playPrepared).toHaveBeenCalledWith("birth", "p1");
  });

  it("on reconnect after completion (authoritative stageStatus=completed) shows the cert, not the play button, and does NOT re-complete", () => {
    const you = youWith({
      stageStatus: { birth: "completed" },
      outputs: { avatarUrl: "av" },
      memories: { favorite_toy: "积木" },
      displayName: "小明",
      prepared: { p1: { stageId: "birth", outputKind: "audio", ready: true, output: { text: "小明你好" }, degraded: false, preparedAt: "" } },
    });
    const session = fakeSession({ you });
    renderWithSession(<Birth stageId="birth" player={noopPlayer} />, session);
    expect(screen.getByText(/伙伴出生证/)).toBeTruthy();
    expect(screen.queryByTestId("play-prepared")).toBeNull();
    expect(session.complete).not.toHaveBeenCalled(); // already completed authoritatively
  });

  it("after the speech plays, assembles the 伙伴出生证 from `you` and completes the stage", async () => {
    const session = fakeSession({
      readyPrepared: { stageId: "birth", preparedId: "p1", outputKind: "audio" },
      lastOutput: { interactionId: "p1", output: { text: "轩轩你好，我们一起去冒险！" } },
      you: youWith({ outputs: { avatarUrl: "av" }, memories: { favorite_toy: "奥特曼" }, displayName: "轩轩" }),
    });
    renderWithSession(<Birth stageId="birth" player={noopPlayer} />, session);
    expect(screen.getByText(/伙伴出生证/)).toBeTruthy();
    expect(screen.getByText(/奥特曼/)).toBeTruthy();
    expect(screen.getByText(/轩轩你好/)).toBeTruthy();
    await waitFor(() => expect(session.complete).toHaveBeenCalledWith("birth", { kind: "done" }));
  });
});

describe("Closure", () => {
  it("renders the certificate from authoritative state", () => {
    const session = fakeSession({ you: youWith({ outputs: { avatarUrl: "av" }, memories: { favorite_food: "西瓜" }, displayName: "朵朵" }) });
    renderWithSession(<Closure stageId="closure" />, session);
    expect(screen.getByText(/伙伴出生证/)).toBeTruthy();
    expect(screen.getByText(/西瓜/)).toBeTruthy();
  });
});
