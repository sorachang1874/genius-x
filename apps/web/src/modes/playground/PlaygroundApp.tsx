/**
 * PlaygroundApp (乐园 v0, Phase 6.5 Step 3) — the friend's home, zero-AI floor.
 * agent-session.md v1: token via ?playground=<session token> (scrub-on-mount — this
 * token class never persists in history); ONE world fetch; the sleepy wind-down as
 * expiry approaches; the CLOSE ritual (盖被子) and the ASLEEP scene render from
 * client-side state — a mid-visit 404 shows the asleep world, NEVER error/retry copy.
 *
 * v0 is READ-ONLY (gate ⑤): nothing here writes. No menus, no failure states, no
 * AI wording (world.md iron rules) — the friend's presence carries the room.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaygroundWorldView } from "@genius-x/contracts";
import { serverBaseUrl } from "../../shared/socket";
import { WORLD_REGISTRY } from "./world/registry";

/** Wind-down window = the GRACE window (agent-session.md: the sleepy ritual fills the
 *  5-min grace; quota boundary == expiresAt - grace — the child never gets bonus time). */
const SLEEPY_MS = 5 * 60 * 1000;

export class PlaygroundGoneError extends Error {
  constructor() {
    super("playground session gone");
    this.name = "PlaygroundGoneError";
  }
}

export type PlaygroundApi = (token: string) => Promise<PlaygroundWorldView>;

/** STABLE default (an inline `() => Date.now()` default param would mint a new identity
 *  per render and re-run the fetch effect forever — the dep-loop trap). */
const defaultNow = (): number => Date.now();

const defaultApi: PlaygroundApi = async (token) => {
  const res = await fetch(`${serverBaseUrl()}/playground/world`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw new PlaygroundGoneError(); // dead session ⇒ asleep scene
  if (!res.ok) throw new Error(`playground world fetch failed (${res.status})`);
  return (await res.json()) as PlaygroundWorldView;
};

type WorldState =
  | { phase: "arriving" }
  | { phase: "home"; world: PlaygroundWorldView; sleepy: boolean }
  | { phase: "tuckedIn" } // the child closed the day (盖被子) — world at night
  | { phase: "asleep" }; // dead/absent token — the friend is sleeping (client-cached scene)

export function PlaygroundApp({ api = defaultApi, now = defaultNow }: {
  api?: PlaygroundApi;
  now?: () => number;
}): React.JSX.Element {
  const [state, setState] = useState<WorldState>({ phase: "arriving" });
  // Capture ONCE, then scrub the value (history persistence NOT accepted for this
  // class — agent-session.md transport ruling; presence kept for routing).
  const [token] = useState(() => new URLSearchParams(window.location.search).get("playground") ?? "");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (token === "") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("playground") !== "") {
      url.searchParams.set("playground", "");
      window.history.replaceState({}, "", url);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (token === "") {
      setState({ phase: "asleep" }); // no key to the house — the friend is sleeping
      return;
    }
    api(token)
      .then((world) => {
        if (cancelled) return;
        setState({ phase: "home", world, sleepy: false });
        // The friend's body clock: sleepy near the end, asleep at expiry (client-side —
        // the dead token would 404 anyway; this keeps the ritual narrative, no popup).
        // Server-relative anchor (review fix): a skewed device clock costs only network
        // latency, not quota truthfulness.
        const msLeft = Date.parse(world.sessionExpiresAt) - Date.parse(world.serverNow);
        void now; // retained as a seam for tests
        if (msLeft > SLEEPY_MS) {
          timers.current.push(window.setTimeout(() => {
            setState((s) => (s.phase === "home" ? { ...s, sleepy: true } : s));
          }, msLeft - SLEEPY_MS));
        } else {
          setState({ phase: "home", world, sleepy: true });
        }
        timers.current.push(window.setTimeout(() => {
          setState((s) => (s.phase === "home" ? { phase: "asleep" } : s));
        }, Math.max(msLeft, 0)));
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "asleep" }); // uniform: dead = asleep, never an error
      });
    return () => {
      cancelled = true;
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, [token, api, now]);

  const tuckIn = useCallback(() => setState({ phase: "tuckedIn" }), []);

  if (state.phase === "arriving") {
    return (
      <div className="playground">
        <p role="status">推开门…… ✨</p>
      </div>
    );
  }
  if (state.phase === "asleep") {
    // Client-cached scene — renders with NO server call (the contract preflight).
    return (
      <div className="playground playground--night">
        <p className="playground__friend" aria-hidden="true">😴</p>
        <p role="status">嘘——它睡着了，在说梦话呢。明天再来玩吧。</p>
      </div>
    );
  }
  if (state.phase === "tuckedIn") {
    return (
      <div className="playground playground--night">
        <p className="playground__friend" aria-hidden="true">🌙</p>
        <p role="status">你帮它盖好了被子。晚安，明天见。</p>
      </div>
    );
  }

  const { world, sleepy } = state;
  const friendName = world.companion?.name ?? "你的朋友";
  return (
    <div className="playground">
      <header className="playground__hello">
        <p className="playground__friend" aria-hidden="true">{sleepy ? "🥱" : "✨"}</p>
        <h1>
          {sleepy
            ? `${friendName}有点困了，揉了揉眼睛……`
            : `${world.displayName}，你来啦！${friendName}抬起头看见了你。`}
        </h1>
        {!sleepy && world.greeting && <p className="playground__greeting">「{world.greeting}」</p>}
        {world.album.length === 0 && world.wall.length === 0 && world.diary.length === 0 && (
          // EARNED world (world.md rule 3): small is the story, not an empty state.
          <p>这个家刚刚开始。上完课，这里会一点点长出你们的故事。</p>
        )}
      </header>

      <WORLD_REGISTRY.works_wall world={world} />
      <WORLD_REGISTRY.companion_diary world={world} />
      <WORLD_REGISTRY.growth_album world={world} />

      {sleepy && (
        <button type="button" className="playground__tuck" onClick={tuckIn}>
          帮它盖被子，说晚安 🌙
        </button>
      )}
    </div>
  );
}
