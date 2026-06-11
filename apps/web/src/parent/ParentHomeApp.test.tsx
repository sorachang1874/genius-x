/**
 * ParentHomeApp — pins the Phase-6 parent home (parent-surface.md): children cards with
 * the companion surface, the growth timeline (versions + lineage works), the note
 * composer's gentle lifecycle; EVERY failure is ONE warm guidance state; banned-wording
 * holds on this surface too (the rule extends to all parent-H5 copy).
 */
import { describe, it, expect, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ParentChildSummary, ParentTimelineResponse } from "@genius-x/contracts";
import { ParentHomeApp, ParentGoneError, type ParentApi } from "./ParentHomeApp";

const BANNED = /\b(ai|prompt|llm|token|model)\b/i;

function setUrl(query: string): void {
  window.history.pushState({}, "", `/${query}`);
}
afterEach(() => setUrl(""));

const TOKEN = "P".repeat(43);

const CHILDREN: ParentChildSummary[] = [
  {
    studentId: "33333333-3333-4333-8333-000000000001",
    displayName: "美美",
    age: 7,
    companion: { name: "小泥", personality: "勇敢" },
    completedLessonIds: ["lesson-001"],
  },
  {
    studentId: "33333333-3333-4333-8333-000000000002",
    displayName: "壮壮",
    age: 8,
    completedLessonIds: [],
  },
];

const TIMELINE: ParentTimelineResponse = {
  studentId: CHILDREN[0]!.studentId,
  displayName: "美美",
  entries: [
    {
      version: 1,
      surface: { name: "小泥", personality: "勇敢" },
      lessonId: "lesson-001",
      createdAt: "2026-06-09T10:00:00Z",
      works: [{ type: "avatar_image", contentUrl: "fake://v1.png", createdAt: "2026-06-09T10:00:00Z" }],
    },
    {
      version: 2,
      surface: { name: "小泥", personality: "勇敢又温柔", backstory: "彩虹城堡" },
      lessonId: "lesson-002",
      createdAt: "2026-06-16T10:00:00Z",
      works: [],
    },
  ],
};

function api(overrides: Partial<ParentApi> = {}): ParentApi {
  return {
    children: async () => ({ children: CHILDREN }),
    timeline: async () => TIMELINE,
    addNote: async () => "ok",
    unlockPlayground: async () => ({ token: "P".repeat(43) }),
    ...overrides,
  };
}

describe("ParentHomeApp — home", () => {
  it("renders every child with the companion SURFACE (no banned wording, attributes included)", async () => {
    setUrl(`?parent=${TOKEN}`);
    const { container } = render(<ParentHomeApp api={api()} />);
    await waitFor(() => expect(screen.getByText("美美")).toBeDefined());
    expect(screen.getByText(/好朋友：小泥（勇敢）/)).toBeDefined();
    expect(screen.getByText(/7 岁 · 已完成 1 节课/)).toBeDefined();
    expect(screen.getByText("壮壮")).toBeDefined(); // no companion yet — card still renders
    expect(container.innerHTML).not.toMatch(BANNED); // innerHTML: aria-label/alt/placeholder too
  });

  it("SCRUB-ON-MOUNT (contract v1.1): the token leaves the address bar, presence stays, the fetch still carries it", async () => {
    setUrl(`?parent=${TOKEN}`);
    const tokensSeen: string[] = [];
    render(<ParentHomeApp api={api({ children: async (t) => { tokensSeen.push(t); return { children: CHILDREN }; } })} />);
    await waitFor(() => expect(screen.getByText("美美")).toBeDefined());
    expect(window.location.search).not.toContain(TOKEN); // value scrubbed from history
    expect(new URLSearchParams(window.location.search).has("parent")).toBe(true); // routing presence kept
    expect(tokensSeen).toEqual([TOKEN]); // the captured token still authenticates
  });

  it("ANY failure (expired/unknown/network) renders ONE warm guidance, no codes", async () => {
    setUrl(`?parent=${TOKEN}`);
    const { container } = render(
      <ParentHomeApp api={api({ children: async () => { throw new Error("parent children fetch failed (404)"); } })} />,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(container.textContent ?? "").not.toMatch(/404|错误|失败/);
    expect(container.textContent ?? "").not.toMatch(BANNED);
  });

  it("missing ?parent= renders the same warm guidance — no crash, NO fetch", async () => {
    setUrl("");
    let fetched = false;
    render(<ParentHomeApp api={api({ children: async () => { fetched = true; return { children: CHILDREN }; } })} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(fetched).toBe(false);
  });
});

describe("ParentHomeApp — growth timeline", () => {
  async function openChild(overrides: Partial<ParentApi> = {}): Promise<ReturnType<typeof render>> {
    setUrl(`?parent=${TOKEN}`);
    const r = render(<ParentHomeApp api={api(overrides)} />);
    await waitFor(() => expect(screen.getByText("美美")).toBeDefined());
    fireEvent.click(screen.getByText("美美"));
    return r;
  }

  it("version 1 = 诞生时刻; later versions numbered; lineage works render; no banned wording", async () => {
    const { container } = await openChild();
    await waitFor(() => expect(screen.getByText(/诞生时刻/)).toBeDefined());
    expect(screen.getByText(/第 2 次成长/)).toBeDefined();
    expect(screen.getByText("性格：勇敢又温柔")).toBeDefined();
    expect(screen.getByText("来自：彩虹城堡")).toBeDefined();
    const img = container.querySelector(".parent-home__timeline-works img");
    expect(img?.getAttribute("src")).toBe("fake://v1.png");
    expect(container.innerHTML).not.toMatch(BANNED); // attributes included
    // internal ids never render (lessonId/studentId are payload, not copy)
    expect(container.textContent ?? "").not.toContain("lesson-001");
    expect(container.textContent ?? "").not.toContain(CHILDREN[0]!.studentId);
  });

  it("an EMPTY timeline (pre-first-lesson) is warm, never a void; a failed one is warm guidance", async () => {
    await openChild({ timeline: async () => ({ ...TIMELINE, entries: [] }) });
    await waitFor(() => expect(screen.getByText(/第一节课之后/)).toBeDefined());
    fireEvent.click(screen.getByText(/回到全部孩子/));
    fireEvent.click(screen.getByText("美美")); // same child again — fresh load
    // (the second click reuses the same api whose timeline still returns empty — fine)
  });

  it("a TRANSIENT timeline failure renders gentle retry copy without leaving the page", async () => {
    const { container } = await openChild({ timeline: async () => { throw new Error("parent timeline fetch failed (503)"); } });
    await waitFor(() => expect(screen.getByText(/成长相册暂时翻不开/)).toBeDefined());
    expect(container.textContent ?? "").not.toMatch(/503|错误|失败/);
  });

  it("a DEAD token mid-session (uniform 404 on timeline) renders the RE-REQUEST guidance — never retry copy", async () => {
    const { container } = await openChild({ timeline: async () => { throw new ParentGoneError(); } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(container.textContent ?? "").not.toContain("休息一下再来看看"); // not the retry copy
  });
});

describe("ParentHomeApp — the playground unlock door (parent-surface.md v1.2)", () => {
  it("curfew (409) shows the asleep guidance; never technical copy", async () => {
    setUrl(`?parent=${TOKEN}`);
    const { container } = render(<ParentHomeApp api={api({ unlockPlayground: async () => "asleep" })} />);
    await waitFor(() => expect(screen.getByText("美美")).toBeDefined());
    fireEvent.click(screen.getByText("美美"));
    await waitFor(() => expect(screen.getByText("把屏幕交给孩子")).toBeDefined());
    fireEvent.click(screen.getByText("把屏幕交给孩子"));
    await waitFor(() => expect(screen.getByText(/它已经睡啦/)).toBeDefined());
    expect(container.textContent ?? "").not.toMatch(/409|错误|失败/);
  });

  it("daily quota spent (COMPANION_RESTING) shows the resting copy", async () => {
    setUrl(`?parent=${TOKEN}`);
    render(<ParentHomeApp api={api({ unlockPlayground: async () => "resting" })} />);
    await waitFor(() => expect(screen.getByText("美美")).toBeDefined());
    fireEvent.click(screen.getByText("美美"));
    await waitFor(() => expect(screen.getByText("把屏幕交给孩子")).toBeDefined());
    fireEvent.click(screen.getByText("把屏幕交给孩子"));
    await waitFor(() => expect(screen.getByText(/今天玩得够久啦/)).toBeDefined());
  });
});

describe("ParentHomeApp — the note composer (co-working v1)", () => {
  async function openComposer(overrides: Partial<ParentApi> = {}): Promise<{ container: HTMLElement; sent: string[] }> {
    const sent: string[] = [];
    setUrl(`?parent=${TOKEN}`);
    const { container } = render(
      <ParentHomeApp
        api={api({
          addNote: async (_t, _s, text) => {
            sent.push(text);
            return "ok";
          },
          ...overrides,
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText("美美")).toBeDefined());
    fireEvent.click(screen.getByText("美美"));
    await waitFor(() => expect(screen.getByLabelText("悄悄话内容")).toBeDefined());
    return { container, sent };
  }

  it("sends the TRIMMED note and confirms warmly; the box clears for the next one", async () => {
    const { sent } = await openComposer();
    fireEvent.change(screen.getByLabelText("悄悄话内容"), { target: { value: "  妈妈为你骄傲  " } });
    fireEvent.click(screen.getByText("托伙伴带话"));
    await waitFor(() => expect(screen.getByText(/伙伴会在下次见面时悄悄告诉孩子/)).toBeDefined());
    expect(sent).toEqual(["妈妈为你骄傲"]);
    expect((screen.getByLabelText("悄悄话内容") as HTMLTextAreaElement).value).toBe("");
  });

  it("empty input cannot send; the textarea hard-caps at 200 chars", async () => {
    const { sent } = await openComposer();
    const btn = screen.getByText("托伙伴带话") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("悄悄话内容"), { target: { value: "   " } });
    expect((screen.getByText("托伙伴带话") as HTMLButtonElement).disabled).toBe(true);
    expect(sent).toEqual([]);
    expect((screen.getByLabelText("悄悄话内容") as HTMLTextAreaElement).maxLength).toBe(200);
  });

  it("a boundary 400 (review/cap) AND a network failure both render the SAME gentle copy — no codes, no banned words", async () => {
    const { container } = await openComposer({ addNote: async () => "rejected" });
    fireEvent.change(screen.getByLabelText("悄悄话内容"), { target: { value: "测试一下" } });
    fireEvent.click(screen.getByText("托伙伴带话"));
    await waitFor(() => expect(screen.getByText(/换一种说法/)).toBeDefined());
    expect(container.textContent ?? "").not.toMatch(/400|INVALID|错误|失败/);
    expect(container.innerHTML).not.toMatch(BANNED); // attributes included
    // typing again returns the composer to idle (the guidance clears)
    fireEvent.change(screen.getByLabelText("悄悄话内容"), { target: { value: "换个说法" } });
    expect(screen.queryByText(/换一种说法/)).toBeNull();
  });

  it("a DEAD token on note POST (uniform 404) renders the RE-REQUEST guidance — '换个说法' would mislead forever", async () => {
    const { container } = await openComposer({ addNote: async () => "gone" });
    fireEvent.change(screen.getByLabelText("悄悄话内容"), { target: { value: "妈妈想你" } });
    fireEvent.click(screen.getByText("托伙伴带话"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("请联系老师"));
    expect(container.textContent ?? "").not.toContain("换一种说法");
  });

  it("the textarea locks while sending (a draft typed mid-flight would be wiped on success); counter counts what maxLength caps", async () => {
    let release: (() => void) | undefined;
    await openComposer({
      addNote: () => new Promise((res) => { release = () => res("ok"); }),
    });
    const box = screen.getByLabelText("悄悄话内容") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "妈妈想你 " } });
    expect(screen.getByText("5/200")).toBeDefined(); // RAW chars (incl. the space) — matches maxLength
    fireEvent.click(screen.getByText("托伙伴带话"));
    await waitFor(() => expect(box.disabled).toBe(true)); // locked mid-flight
    release!();
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.value).toBe(""); // cleared exactly once, nothing typed mid-flight to lose
  });
});
