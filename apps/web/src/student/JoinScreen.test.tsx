/**
 * JoinScreen — pins the FROZEN child-facing reconciliation (enrollment.md): every join
 * rejection renders as a warm non-failure; the technical error never reaches the child.
 * Identity arrives via the enrollment link (?studentId=...), never typed in.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { fakeSession, renderWithSession } from "../test/session-fixture";
import { JoinScreen } from "./StudentApp";

function setUrl(query: string): void {
  window.history.pushState({}, "", `/${query}`);
}

afterEach(() => setUrl(""));

describe("JoinScreen (Phase 1 persistent identity)", () => {
  it("without ?studentId: warm guidance, no form, no error state", () => {
    setUrl("");
    renderWithSession(<JoinScreen />, fakeSession());
    expect(screen.getByRole("status").textContent).toContain("专属链接或二维码");
    expect(screen.queryByRole("button")).toBeNull(); // no join form at all
  });

  it("with ?studentId: joins with the persistent id from the URL (room prefilled from ?room=)", () => {
    setUrl("?studentId=33333333-3333-4333-8333-000000000001&room=demo-1");
    const join = vi.fn(async () => {});
    renderWithSession(<JoinScreen />, fakeSession({ join }));
    const button = screen.getByRole("button");
    expect((screen.getByPlaceholderText("老师给的房间号") as HTMLInputElement).value).toBe("demo-1");
    fireEvent.click(button);
    expect(join).toHaveBeenCalledWith("demo-1", undefined, "33333333-3333-4333-8333-000000000001");
  });

  it("REJECTED join renders WARM: hint visible, technical error text not visible to the child", () => {
    setUrl("?studentId=33333333-3333-4333-8333-000000000001");
    renderWithSession(
      <JoinScreen />,
      fakeSession({ phase: "error", error: "join failed (403)" }), // operator truth
    );
    expect(screen.getByRole("status").textContent).toContain("请老师来帮帮忙"); // warmth
    const technical = screen.getByText("join failed (403)");
    expect(technical.hasAttribute("hidden")).toBe(true); // hidden element only (debugging), never shown
  });

  it("keeps the typed room code interactive state while joining (no wipe on rejection round-trip)", () => {
    setUrl("?studentId=33333333-3333-4333-8333-000000000001");
    renderWithSession(<JoinScreen />, fakeSession({ phase: "joining" }));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button").textContent).toContain("正在进入教室");
  });
});
