/**
 * Stage components (M3): render per stage; mic/doodle dispatch the right INTERACT; the
 * "thinking" pending state shows during an in-flight interaction; selection completes the stage.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AiOutputPlayer } from "../../shared/ai-output";
import { fakeSession, renderWithSession } from "../../test/session-fixture";
import { Icebreak } from "./Icebreak";
import { Shape } from "./Shape";

const noopPlayer: AiOutputPlayer = { play: vi.fn(async () => {}), imageUrls: (o) => o.imageUrls ?? [] };

describe("Icebreak", () => {
  it("dispatches a voice INTERACT on hold-to-talk release", async () => {
    const session = fakeSession();
    renderWithSession(
      <Icebreak stageId="icebreak" player={noopPlayer} voiceDeps={{ getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream, mkRef: () => "ref-x" }} />,
      session,
    );
    const mic = screen.getByRole("button");
    fireEvent.pointerDown(mic);
    await waitFor(() => expect(mic.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.pointerUp(mic);
    await waitFor(() => expect(session.interact).toHaveBeenCalledWith("icebreak", { kind: "voice", audioRef: "ref-x" }));
  });

  it("shows the thinking state while an interaction is pending", () => {
    renderWithSession(<Icebreak stageId="icebreak" player={noopPlayer} />, fakeSession({ pendingInteractionId: "iid-9" }));
    expect(screen.getByRole("status").textContent).toContain("正在认真听");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the friend's reply text", () => {
    renderWithSession(
      <Icebreak stageId="icebreak" player={noopPlayer} />,
      fakeSession({ lastOutput: { interactionId: "iid-1", output: { text: "你好呀，小朋友！" } } }),
    );
    expect(screen.getByTestId("friend-reply").textContent).toBe("你好呀，小朋友！");
  });
});

describe("Shape", () => {
  it("enables 变身 after drawing and dispatches a doodle INTERACT with the variant", async () => {
    const session = fakeSession();
    renderWithSession(<Shape stageId="shape" player={noopPlayer} />, session);
    const transform = screen.getByRole("button", { name: /变身/ }) as HTMLButtonElement;
    expect(transform.disabled).toBe(true);

    const canvas = screen.getByLabelText("涂鸦画板");
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(transform.disabled).toBe(false));

    fireEvent.click(transform);
    expect(session.interact).toHaveBeenCalledOnce();
    const call = (session.interact as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const [stageId, input, variantId] = call as [string, { kind: string; doodleRef: string }, string];
    expect(stageId).toBe("shape");
    expect(input).toMatchObject({ kind: "doodle" });
    expect(typeof input.doodleRef).toBe("string");
    expect(variantId).toBe("drawing");
  });

  it("shows the transforming thinking state while pending", () => {
    renderWithSession(<Shape stageId="shape" player={noopPlayer} />, fakeSession({ pendingInteractionId: "iid-2" }));
    expect(screen.getByRole("status").textContent).toContain("变成好朋友");
  });

  it("renders candidates and completes the stage on selection", () => {
    const session = fakeSession({ lastOutput: { interactionId: "iid-3", output: { imageUrls: ["i1", "i2", "i3"] } } });
    renderWithSession(<Shape stageId="shape" player={noopPlayer} />, session);
    const tiles = screen.getAllByRole("button", { name: /候选/ });
    expect(tiles).toHaveLength(3);
    fireEvent.click(tiles[0]!);
    expect(session.complete).toHaveBeenCalledWith("shape", { kind: "selection", output: "avatarUrl", value: "i1" });
  });

  it("shows the chosen avatar after selection", () => {
    const you = { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: { avatarUrl: "chosen-url" }, memories: {}, pendingMemory: [], prepared: {} };
    renderWithSession(<Shape stageId="shape" player={noopPlayer} />, fakeSession({ you }));
    expect(screen.getByAltText("我的好朋友").getAttribute("src")).toBe("chosen-url");
  });
});
