/**
 * Session context over a FAKE socket (M3). Asserts the exact `ClientMessage` shapes emitted,
 * that `ServerMessage`s drive state, and reconnect+resume: HELLO on (re)connect → render from
 * `RESUME_STATE.you` (incl. `you.outputs.avatarUrl`), with `lessonConfigVersion` stored.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { ClientMessage, ServerMessage, SessionJoinResponse } from "@genius-x/contracts";
import { SessionProvider, useSession } from "./session";
import type { ClassroomSocket, ConnectionStatus } from "./socket";

function makeFakeSocket() {
  const sent: ClientMessage[] = [];
  const handlers = {
    message: (_m: ServerMessage): void => {},
    connect: (): void => {},
    status: (_s: ConnectionStatus): void => {},
  };
  const socket: ClassroomSocket = {
    send: (m) => sent.push(m),
    onMessage: (h) => {
      handlers.message = h;
      return () => {};
    },
    onConnect: (h) => {
      handlers.connect = h;
      return () => {};
    },
    onStatus: (h) => {
      handlers.status = h;
      return () => {};
    },
    disconnect: vi.fn(),
  };
  return {
    socket,
    sent,
    emit: (m: ServerMessage) => act(() => handlers.message(m)),
    fireConnect: () => act(() => handlers.connect()),
    fireStatus: (s: ConnectionStatus) => act(() => handlers.status(s)),
  };
}

function Probe(): React.JSX.Element {
  const s = useSession();
  return (
    <div>
      <span data-testid="phase">{s.phase}</span>
      <span data-testid="stage">{s.currentStageId ?? ""}</span>
      <span data-testid="global">{s.global}</span>
      <span data-testid="version">{s.lessonConfigVersion ?? ""}</span>
      <span data-testid="avatar">{String(s.you.outputs.avatarUrl ?? "")}</span>
      <span data-testid="chosen">{String(s.localSelection?.output === "avatarUrl" ? s.localSelection.value : (s.you.outputs.avatarUrl ?? ""))}</span>
      <span data-testid="pending">{s.pendingInteractionId ?? ""}</span>
      <button onClick={() => s.join("room-1")}>join</button>
      <button onClick={() => s.interact("icebreak", { kind: "voice", audioRef: "a1" })}>interact</button>
      <button onClick={() => s.complete("shape", { kind: "selection", output: "avatarUrl", value: "u1" })}>complete</button>
    </div>
  );
}

async function setupLiveStudent() {
  const fake = makeFakeSocket();
  const joinResp: SessionJoinResponse = { studentId: "k1", sessionId: "s1", role: "student" };
  const deps = {
    connect: () => fake.socket,
    join: vi.fn(async () => joinResp),
    fetchState: vi.fn(async () => null),
    wsUrl: "ws://test",
  };
  render(
    <SessionProvider role="student" deps={deps}>
      <Probe />
    </SessionProvider>,
  );
  fireEvent.click(screen.getByText("join"));
  await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("live"));
  // socket connects → HELLO is sent on the connect event
  await fake.fireConnect();
  return { fake, deps };
}

describe("session context (fake socket)", () => {
  it("sends HELLO {studentId} on (re)connect", async () => {
    const { fake } = await setupLiveStudent();
    expect(fake.sent).toContainEqual({ type: "HELLO", studentId: "k1" });
  });

  it("renders from RESUME_STATE.you and stores lessonConfigVersion", async () => {
    const { fake } = await setupLiveStudent();
    await fake.emit({
      type: "RESUME_STATE",
      currentStageId: "shape",
      global: "active",
      lessonConfigVersion: "1.0.0",
      you: { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: { avatarUrl: "resumed-url" }, memories: {}, pendingMemory: [], prepared: {} },
    });
    expect(screen.getByTestId("stage").textContent).toBe("shape");
    expect(screen.getByTestId("version").textContent).toBe("1.0.0");
    expect(screen.getByTestId("avatar").textContent).toBe("resumed-url");
  });

  it("STAGE_UNLOCK advances the rendered stage", async () => {
    const { fake } = await setupLiveStudent();
    await fake.emit({ type: "STAGE_UNLOCK", stageId: "icebreak" });
    expect(screen.getByTestId("stage").textContent).toBe("icebreak");
  });

  it("emits an exact INTERACT and shows the pending interaction", async () => {
    const { fake } = await setupLiveStudent();
    fireEvent.click(screen.getByText("interact"));
    const interact = fake.sent.find((m) => m.type === "INTERACT");
    expect(interact).toBeDefined();
    expect(interact).toMatchObject({ type: "INTERACT", studentId: "k1", stageId: "icebreak", input: { kind: "voice", audioRef: "a1" } });
    if (interact && interact.type === "INTERACT") {
      expect(typeof interact.interactionId).toBe("string");
      expect("variantId" in interact).toBe(false);
      expect(screen.getByTestId("pending").textContent).toBe(interact.interactionId);
    }
  });

  it("clears pending when the matching AI_OUTPUT arrives", async () => {
    const { fake } = await setupLiveStudent();
    fireEvent.click(screen.getByText("interact"));
    const interact = fake.sent.find((m) => m.type === "INTERACT");
    const iid = interact && interact.type === "INTERACT" ? interact.interactionId : "";
    await fake.emit({ type: "AI_OUTPUT", studentId: "k1", stageId: "icebreak", interactionId: iid, output: { text: "你好呀" } });
    expect(screen.getByTestId("pending").textContent).toBe("");
  });

  it("emits an exact STAGE_COMPLETE selection; shows it as a local transient WITHOUT mutating authoritative you", async () => {
    const { fake } = await setupLiveStudent();
    fireEvent.click(screen.getByText("complete"));
    expect(fake.sent).toContainEqual({
      type: "STAGE_COMPLETE",
      studentId: "k1",
      stageId: "shape",
      payload: { kind: "selection", output: "avatarUrl", value: "u1" },
    });
    // local transient reflects the choice immediately (positive output)...
    expect(screen.getByTestId("chosen").textContent).toBe("u1");
    // ...but authoritative you.outputs is NOT invented locally (only RESUME_STATE sets it).
    expect(screen.getByTestId("avatar").textContent).toBe("");
  });

  it("keeps showing thinking on resume when the server still has a pending interaction", async () => {
    const { fake } = await setupLiveStudent();
    await fake.emit({
      type: "RESUME_STATE",
      currentStageId: "icebreak",
      global: "active",
      lessonConfigVersion: "1.0.0",
      you: { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: { "iid-live": { stageId: "icebreak" } }, outputs: {}, memories: {}, pendingMemory: [], prepared: {} },
    });
    expect(screen.getByTestId("pending").textContent).toBe("iid-live");
  });

  it("re-sends HELLO on a second connect (reconnect → resume)", async () => {
    const { fake } = await setupLiveStudent();
    fake.sent.length = 0;
    await fake.fireConnect();
    expect(fake.sent).toContainEqual({ type: "HELLO", studentId: "k1" });
  });
});
