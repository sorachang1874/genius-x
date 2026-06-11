/**
 * PlaygroundApp (乐园 v0) — agent-session.md / world.md pins: scrub-on-mount for the
 * session token class, ONE world fetch, the asleep scene for dead/absent tokens (NEVER
 * error copy — client-cached, zero server calls), the sleepy wind-down → 盖被子 ritual,
 * earned-world narrative, banned wording (attributes included), and the world.md
 * registry-mirror closure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlaygroundWorldView } from "@genius-x/contracts";
import { PlaygroundApp, PlaygroundGoneError, type PlaygroundApi } from "./PlaygroundApp";
import { WORLD_REGISTRY, WORLD_CONTRACT_ROWS_V0 } from "./world/registry";

const BANNED = /\b(ai|prompt|llm|token|model)\b/i;
const TOKEN = "G".repeat(43);

function setUrl(query: string): void {
  window.history.pushState({}, "", `/${query}`);
}
afterEach(() => setUrl(""));

function world(overrides: Partial<PlaygroundWorldView> = {}): PlaygroundWorldView {
  return {
    displayName: "乐园娃",
    companion: { name: "小泥", personality: "勇敢" },
    wall: [{
      type: "avatar_image",
      final: { type: "avatar_image", contentUrl: "fake://v2.png", createdAt: "2026-06-10T10:00:00Z" },
      slices: [
        { type: "avatar_image", contentUrl: "fake://v1.png", createdAt: "2026-06-10T09:00:00Z" },
        { type: "avatar_image", contentUrl: "fake://v2.png", createdAt: "2026-06-10T10:00:00Z" },
      ],
    }],
    album: [{ version: 1, surface: { name: "小泥", personality: "勇敢" }, createdAt: "2026-06-09T10:00:00Z" }],
    sessionExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    serverNow: new Date().toISOString(),
    ...overrides,
  };
}

describe("world.md v1.1 registry-mirror closure (the pinned CI mechanism, honest forms)", () => {
  it("(a) registry keys == the Registry-key column PARSED FROM world.md — doc↔code drift fails here", () => {
    const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../../docs/contracts/world.md"), "utf8");
    const docKeys = [...doc.matchAll(/\| `([a-z_]+)` \|/g)].map((m) => m[1]!);
    expect(docKeys.sort()).toEqual([...WORLD_CONTRACT_ROWS_V0].sort());
    expect(Object.keys(WORLD_REGISTRY).sort()).toEqual([...WORLD_CONTRACT_ROWS_V0].sort());
  });

  it("(b) REAL export scan: every component exported under world/ is a registry VALUE; values distinct", async () => {
    const modules = import.meta.glob("./world/*.tsx", { eager: true }) as Record<string, Record<string, unknown>>;
    const registryValues = Object.values(WORLD_REGISTRY) as unknown[];
    expect(new Set(registryValues).size).toBe(registryValues.length); // distinct
    const exported = Object.values(modules).flatMap((m) =>
      Object.values(m).filter((v) => typeof v === "function" && /^[A-Z]/.test((v as { name: string }).name)),
    );
    expect(exported.length).toBeGreaterThan(0);
    for (const comp of exported) {
      expect(registryValues.includes(comp), `unregistered world component: ${(comp as { name: string }).name}`).toBe(true);
    }
  });

  it("(c) import ban: no file outside the playground mode imports world components directly", () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full.includes("modes/playground")) continue; // inside the mode is fine
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && /from ["'].*playground\/world\//.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});

describe("PlaygroundApp — arrival, the home, and the friend's body clock", () => {
  it("SCRUB-ON-MOUNT: the session token leaves the address bar; the fetch still carries it", async () => {
    setUrl(`?playground=${TOKEN}`);
    const seen: string[] = [];
    const api: PlaygroundApi = async (t) => {
      seen.push(t);
      return world();
    };
    render(<PlaygroundApp api={api} />);
    await waitFor(() => expect(screen.getByText(/你来啦/)).toBeDefined());
    expect(window.location.search).not.toContain(TOKEN);
    expect(new URLSearchParams(window.location.search).has("playground")).toBe(true); // routing presence
    expect(seen).toEqual([TOKEN]);
  });

  it("renders the visit ritual + wall (replay steps through 打磨轨迹) + album; no banned wording, no internal ids", async () => {
    setUrl(`?playground=${TOKEN}`);
    const { container } = render(<PlaygroundApp api={async () => world()} />);
    await waitFor(() => expect(screen.getByText(/小泥抬起头看见了你/)).toBeDefined());
    const wallImg = (): string | null | undefined => container.querySelector(".world-wall img")?.getAttribute("src");
    expect(wallImg()).toBe("fake://v2.png"); // the final hangs
    fireEvent.click(screen.getByLabelText("看看这件作品的成长之路"));
    expect(wallImg()).toBe("fake://v1.png"); // replay step 1
    expect(screen.getByText(/第 1 步/)).toBeDefined();
    expect(screen.getByText("诞生时刻")).toBeDefined(); // album v1
    expect(container.innerHTML).not.toMatch(BANNED);
  });

  it("a DEAD session (uniform 404) renders the ASLEEP scene — never error/retry copy; absent token too", async () => {
    setUrl(`?playground=${TOKEN}`);
    const { container, unmount } = render(<PlaygroundApp api={async () => { throw new PlaygroundGoneError(); }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("它睡着了"));
    expect(container.textContent ?? "").not.toMatch(/404|错误|失败|重试/);
    expect(container.innerHTML).not.toMatch(BANNED); // (d) asleep state scanned
    unmount();
    setUrl(""); // no token at all — same asleep scene, NO fetch
    let fetched = false;
    render(<PlaygroundApp api={async () => { fetched = true; return world(); }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("它睡着了"));
    expect(fetched).toBe(false);
  });

  it("near expiry the friend gets SLEEPY; the child tucks it in (盖被子) — the close ritual is client-side", async () => {
    setUrl(`?playground=${TOKEN}`);
    // already inside the sleepy window (90s left)
    const w = world({ sessionExpiresAt: new Date(Date.now() + 90 * 1000).toISOString() });
    render(<PlaygroundApp api={async () => w} />);
    await waitFor(() => expect(screen.getByText(/有点困了/)).toBeDefined());
    fireEvent.click(screen.getByText(/帮它盖被子/));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("晚安"));
    expect(document.body.innerHTML).not.toMatch(BANNED); // (d) sleepy + tucked-in scanned
  });

  it("an EARNED-empty world tells the small-world story — never an empty state", async () => {
    setUrl(`?playground=${TOKEN}`);
    const { companion: _omit, ...bare } = world({ wall: [], album: [] });
    void _omit;
    render(<PlaygroundApp api={async () => bare} />);
    await waitFor(() => expect(screen.getByText(/这个家刚刚开始/)).toBeDefined());
    expect(screen.queryByText(/没有|为空|出错/)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(BANNED); // (d) earned-empty scanned
  });
});
