/**
 * ai-output port (M3): prefers audioUrl, falls back to speak(text) on audio error, and never
 * surfaces a failure to the child.
 */
import { describe, it, expect, vi } from "vitest";
import { createAiOutputPlayer } from "./ai-output";

describe("createAiOutputPlayer", () => {
  it("plays audioUrl when present and does not speak", async () => {
    const play = vi.fn(async () => {});
    const speak = vi.fn();
    const player = createAiOutputPlayer({ makeAudio: () => ({ play }), speak });
    await player.play({ text: "fallback", audioUrl: "u://clip.mp3" });
    expect(play).toHaveBeenCalledOnce();
    expect(speak).not.toHaveBeenCalled();
  });

  it("falls back to speak(text) when audio play rejects (no error surfaced)", async () => {
    const play = vi.fn(async () => {
      throw new Error("decode failed");
    });
    const speak = vi.fn();
    const player = createAiOutputPlayer({ makeAudio: () => ({ play }), speak });
    await expect(player.play({ text: "你好呀", audioUrl: "u://bad.mp3" })).resolves.toBeUndefined();
    expect(speak).toHaveBeenCalledWith("你好呀");
  });

  it("speaks text when there is no audioUrl", async () => {
    const speak = vi.fn();
    const player = createAiOutputPlayer({ makeAudio: () => ({ play: vi.fn() }), speak });
    await player.play({ text: "讲故事" });
    expect(speak).toHaveBeenCalledWith("讲故事");
  });

  it("exposes imageUrls (empty when absent)", () => {
    const player = createAiOutputPlayer();
    expect(player.imageUrls({ imageUrls: ["a", "b"] })).toEqual(["a", "b"]);
    expect(player.imageUrls({ text: "x" })).toEqual([]);
  });
});
