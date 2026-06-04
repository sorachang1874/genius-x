/**
 * Test helpers (M3): build a fake `SessionApi` and render a component inside it without a real
 * socket, so stage components can be tested in isolation with spy-able interact/complete.
 */
import { vi } from "vitest";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import type { StudentRuntimeState } from "@genius-x/contracts";
import { SessionContext, type SessionApi } from "../shared/session";

export function freshStudentState(): StudentRuntimeState {
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {} };
}

export function fakeSession(partial: Partial<SessionApi> = {}): SessionApi {
  return {
    role: "student",
    phase: "live",
    connection: "connected",
    global: "active",
    you: freshStudentState(),
    join: vi.fn(async () => {}),
    interact: vi.fn(() => "iid-1"),
    complete: vi.fn(),
    send: vi.fn(),
    ...partial,
  };
}

export function renderWithSession(ui: ReactNode, session: SessionApi): RenderResult {
  return render(<SessionContext.Provider value={session}>{ui}</SessionContext.Provider>);
}
