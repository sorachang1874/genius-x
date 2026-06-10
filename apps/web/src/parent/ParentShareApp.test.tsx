/**
 * ParentShareApp — pins the parent surface: certificate hero + works render from the
 * filtered view; EVERY failure (expired/unknown/network) is ONE warm guidance state; and
 * the banned-wording rule holds on the parent surface too.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ParentShareView } from "@genius-x/contracts";
import { ParentShareApp } from "./ParentShareApp";

const BANNED = /\b(ai|prompt|llm|token|model)\b/i;

function setUrl(query: string): void {
  window.history.pushState({}, "", `/${query}`);
}
afterEach(() => setUrl(""));

const VIEW: ParentShareView = {
  studentDisplayName: "美美",
  lessonId: "lesson-001",
  certificate: {
    studentName: "美美",
    avatarUrl: "fake://avatar.png",
    personalityTag: "勇敢",
    backgroundSetting: "彩虹城堡",
    memories: [{ label: "最喜欢的玩具", value: "积木" }],
    birthdaySpeech: "美美你好，我出生啦！",
  },
  works: [{ type: "avatar_image", contentUrl: "fake://avatar.png", createdAt: "2026-06-09T10:00:00Z" }],
  sharedAt: "2026-06-09T10:00:00Z",
  expiresAt: "2026-09-07T10:00:00Z",
};

describe("ParentShareApp", () => {
  it("renders the certificate hero + works from the share view (no banned wording)", async () => {
    setUrl("?share=" + "A".repeat(43));
    const { container } = render(<ParentShareApp fetcher={async () => VIEW} />);
    await waitFor(() => expect(screen.getByText(/美美 的好朋友诞生啦/)).toBeDefined());
    expect(screen.getByText("“美美你好，我出生啦！”")).toBeDefined();
    expect(screen.getByText("性格：勇敢")).toBeDefined();
    expect(screen.getByText("最喜欢的玩具：积木")).toBeDefined();
    expect(screen.getByText(/链接有效期至 2026-09-07/)).toBeDefined();
    expect(container.textContent ?? "").not.toMatch(BANNED);
  });

  it("ANY failure (expired/unknown/network) renders ONE warm guidance state, no error codes", async () => {
    setUrl("?share=" + "B".repeat(43));
    const { container } = render(<ParentShareApp fetcher={async () => { throw new Error("share fetch failed (404)"); }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(container.textContent ?? "").not.toMatch(/404|错误|失败/);
    expect(container.textContent ?? "").not.toMatch(BANNED);
  });

  it("missing ?share= param renders the same warm guidance (no crash, no fetch)", async () => {
    setUrl("");
    let fetched = false;
    render(<ParentShareApp fetcher={async () => { fetched = true; return VIEW; }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(fetched).toBe(false);
  });

  it("EMPTY view (no certificate, no works — contract-enumerated state) renders warm copy, never a blank page", async () => {
    setUrl("?share=" + "C".repeat(43));
    const { certificate, ...rest } = VIEW;
    void certificate;
    const { container } = render(<ParentShareApp fetcher={async () => ({ ...rest, works: [] })} />);
    await waitFor(() => expect(screen.getByText(/作品还在路上/)).toBeDefined());
    expect(container.textContent ?? "").not.toMatch(BANNED);
    expect(container.textContent ?? "").not.toMatch(/错误|失败/); // warm, not a failure state
  });

  it("unsafe media URLs (javascript:) are never rendered as an img src", async () => {
    setUrl("?share=" + "D".repeat(43));
    const view: ParentShareView = {
      ...VIEW,
      certificate: { ...VIEW.certificate!, avatarUrl: "javascript:alert(1)" },
      works: [{ type: "avatar_image", contentUrl: "javascript:alert(1)", createdAt: "2026-06-09T10:00:00Z" }],
    };
    const { container } = render(<ParentShareApp fetcher={async () => view} />);
    await waitFor(() => expect(screen.getByText(/美美 的好朋友诞生啦/)).toBeDefined());
    expect(container.querySelectorAll("img")).toHaveLength(0); // both srcs skipped
    expect(screen.getByText("性格：勇敢")).toBeDefined(); // the rest of the certificate still renders
  });
});
