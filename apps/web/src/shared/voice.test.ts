/**
 * voice port (M3): real getUserMedia UX, but a denied/unavailable mic degrades gracefully —
 * stop() still returns an audioRef so the INTERACT is sent (no child-facing failure).
 */
import { describe, it, expect, vi } from "vitest";
import { createVoiceCapture } from "./voice";

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

describe("createVoiceCapture", () => {
  it("captures with a granted mic and returns a placeholder ref", async () => {
    const { stream, stop } = fakeStream();
    const capture = createVoiceCapture({ getUserMedia: async () => stream, mkRef: () => "ref-1" });
    await capture.start();
    expect(capture.active).toBe(true);
    expect(capture.lastError).toBeNull();
    const ref = await capture.stop();
    expect(ref).toBe("ref-1");
    expect(stop).toHaveBeenCalled(); // mic released
    expect(capture.active).toBe(false);
  });

  it("degrades gracefully when the mic is denied (still returns a ref)", async () => {
    const capture = createVoiceCapture({
      getUserMedia: async () => {
        const err = new Error("denied");
        err.name = "NotAllowedError";
        throw err;
      },
      mkRef: () => "ref-degraded",
    });
    await capture.start();
    expect(capture.active).toBe(false);
    expect(capture.lastError).toBe("NotAllowedError");
    await expect(capture.stop()).resolves.toBe("ref-degraded");
  });
});
