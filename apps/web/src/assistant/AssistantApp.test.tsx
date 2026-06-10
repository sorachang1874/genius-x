/**
 * AssistantApp tests — M4d. Covers the force-advance control.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ClientMessage, ServerMessage, SessionJoinResponse, ClassSession } from "@genius-x/contracts";
import type { ClassroomSocket, ConnectionStatus } from "../shared/socket";
import { AssistantApp } from "./AssistantApp";

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
    emit: (m: ServerMessage): void => {
      handlers.message(m);
    },
    fireConnect: (): void => {
      handlers.connect();
    },
  };
}

function makeFakeSession(): ClassSession {
  return {
    sessionId: "s1",
    tenantId: "demo-tenant",
    lessonId: "lesson-001",
    classId: "c1",
    currentStageId: "intro",
    stageStartTime: "2026-06-05T00:00:00Z",
    global: "active",
    lessonConfigVersion: "1.4.0",
    assistants: ["a1"],
    students: {},
  };
}

describe("AssistantApp — FORCE_ADVANCE", () => {
  it("shows force-advance button when a next stage exists", async () => {
    const fake = makeFakeSocket();
    const joinResp: SessionJoinResponse = { studentId: "a1", sessionId: "s1", role: "assistant", assistantId: "a1" };
    const deps = {
      connect: () => fake.socket,
      join: vi.fn(async () => joinResp),
      fetchState: vi.fn(async () => makeFakeSession()),
      wsUrl: "ws://test",
    };

    render(<AssistantApp deps={deps} />);

    // Join the session
    const roomInput = screen.getByPlaceholderText(/课堂房间号/i);
    const connectBtn = screen.getByText(/连接课堂/i);
    fireEvent.change(roomInput, { target: { value: "room-1" } });
    fireEvent.click(connectBtn);

    await waitFor(() => expect(deps.join).toHaveBeenCalled());

    // Simulate connection established
    fake.fireConnect();

    // Should show the normal unlock button for "icebreak" (next stage after intro)
    await waitFor(() => expect(screen.getByText(/解锁下一环节/i)).toBeTruthy());

    // Should also show the force-advance button
    const forceBtn = screen.getByText(/强制推进/i);
    expect(forceBtn).toBeTruthy();
  });

  it("sends FORCE_ADVANCE message with reason and expectedCurrentStageId", async () => {
    const fake = makeFakeSocket();
    const joinResp: SessionJoinResponse = { studentId: "a1", sessionId: "s1", role: "assistant", assistantId: "assist-1" };
    const deps = {
      connect: () => fake.socket,
      join: vi.fn(async () => joinResp),
      fetchState: vi.fn(async () => makeFakeSession()),
      wsUrl: "ws://test",
    };

    render(<AssistantApp deps={deps} />);

    // Join
    fireEvent.change(screen.getByPlaceholderText(/课堂房间号/i), { target: { value: "room-1" } });
    fireEvent.click(screen.getByText(/连接课堂/i));
    await waitFor(() => expect(deps.join).toHaveBeenCalled());
    fake.fireConnect();

    await waitFor(() => expect(screen.getByText(/强制推进/i)).toBeTruthy());

    // Click force-advance button
    fireEvent.click(screen.getByText(/强制推进/i));

    // Should show confirmation form
    await waitFor(() => expect(screen.getByPlaceholderText(/部分学生卡住/i)).toBeTruthy());

    // Enter a reason
    const reasonInput = screen.getByPlaceholderText(/部分学生卡住/i);
    fireEvent.change(reasonInput, { target: { value: "测试原因" } });

    // Confirm
    fireEvent.click(screen.getByText(/确认强制推进/i));

    // Should have sent FORCE_ADVANCE message
    await waitFor(() => {
      const forceMsg = fake.sent.find((m) => m.type === "FORCE_ADVANCE");
      expect(forceMsg).toBeDefined();
      if (forceMsg && forceMsg.type === "FORCE_ADVANCE") {
        expect(forceMsg.stageId).toBe("icebreak"); // next stage after intro
        expect(forceMsg.assistantId).toBe("assist-1");
        expect(forceMsg.reason).toBe("测试原因");
        expect(forceMsg.expectedCurrentStageId).toBe("intro");
      }
    });

    // Confirmation form should be hidden after sending
    expect(screen.queryByPlaceholderText(/部分学生卡住/i)).toBeNull();
  });

  it("can cancel force-advance without sending message", async () => {
    const fake = makeFakeSocket();
    const joinResp: SessionJoinResponse = { studentId: "a1", sessionId: "s1", role: "assistant", assistantId: "a1" };
    const deps = {
      connect: () => fake.socket,
      join: vi.fn(async () => joinResp),
      fetchState: vi.fn(async () => makeFakeSession()),
      wsUrl: "ws://test",
    };

    render(<AssistantApp deps={deps} />);

    // Join
    fireEvent.change(screen.getByPlaceholderText(/课堂房间号/i), { target: { value: "room-1" } });
    fireEvent.click(screen.getByText(/连接课堂/i));
    await waitFor(() => expect(deps.join).toHaveBeenCalled());
    fake.fireConnect();

    await waitFor(() => expect(screen.getByText(/强制推进/i)).toBeTruthy());

    // Click force-advance
    fireEvent.click(screen.getByText(/强制推进/i));
    await waitFor(() => expect(screen.getByPlaceholderText(/部分学生卡住/i)).toBeTruthy());

    // Click cancel
    fireEvent.click(screen.getByText(/取消/i));

    // Form should be hidden
    await waitFor(() => expect(screen.queryByPlaceholderText(/部分学生卡住/i)).toBeNull());

    // No FORCE_ADVANCE message should be sent
    const forceMsg = fake.sent.find((m) => m.type === "FORCE_ADVANCE");
    expect(forceMsg).toBeUndefined();
  });
});
