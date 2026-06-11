/**
 * Role-entry routing pins. The share branch keys on param PRESENCE (`has`), not
 * truthiness: an IM-truncated link ("?share=" with the 43-char token chopped) must land a
 * PARENT on the parent app's warm guidance — never on the student room-code join screen.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

function setUrl(query: string): void {
  window.history.pushState({}, "", `/${query}`);
}
afterEach(() => setUrl(""));

describe("App routing (share precedence)", () => {
  it("?share= with an EMPTY value (IM-truncated link) routes to the parent app's warm guidance", async () => {
    setUrl("?share=");
    render(<App />);
    // ParentShareApp's empty-token branch: warm guidance, no fetch, no student join UI.
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
  });

  it("?parent= with an EMPTY value routes to the parent HOME's warm guidance — never the student screen", async () => {
    setUrl("?parent=");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(screen.queryByText(/教室门牌号/)).toBeNull(); // no student join UI
  });
});
