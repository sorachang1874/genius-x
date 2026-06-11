/**
 * Parent AUTHENTICATED home (Phase 6 Step 3, Agent K) — opened via ?parent=<token>
 * (the parent access token, parent-surface.md). Three surfaces:
 *   1. children — each child with their companion's parent-visible surface
 *   2. growth timeline — the IP character's version history + the works depicting each
 *   3. co-working v1 — the note composer (伙伴 relays it to the child, once, naturally)
 *
 * Copy rules (parent-surface.md): warm, zero technical wording. The 400-vs-404-vs-network
 * distinction is SERVER-GIVEN (no client oracle is invented): 400 → gentle rewording
 * guidance, 404 (the uniform dead-token answer, mid-session too) → the warm re-request
 * state, anything else → gentle retry copy.
 *
 * TOKEN POSTURE (parent-surface.md v1.1 Transport): this token is 180-day, ALL-children,
 * write-capable — history persistence is NOT accepted for it (unlike the scoped share
 * token). The token is captured into memory at first render and immediately SCRUBBED
 * from the address bar (history.replaceState keeps `?parent=` presence for routing, drops
 * the value); sub-requests ride the Authorization header; index.html sets no-referrer
 * globally. A reload after scrub lands on the warm re-request guidance — the original
 * minted link itself still works.
 */
import { useCallback, useEffect, useState } from "react";
import type { ParentChildSummary, ParentTimelineResponse, SharedWork } from "@genius-x/contracts";
import { serverBaseUrl } from "../shared/socket";
import { safeSrc } from "./safe-src";

/** The server's uniform dead-token 404 (expired/revoked/not-yours) — distinct from a
 *  transient failure so the H5 can show re-request guidance instead of retry copy. */
export class ParentGoneError extends Error {
  constructor() {
    super("parent entry gone");
    this.name = "ParentGoneError";
  }
}

/** Injectable API seam for tests; defaults to the real endpoints. */
export interface ParentApi {
  /** Throws ParentGoneError on the uniform 404. */
  children(token: string): Promise<{ children: ParentChildSummary[] }>;
  /** Throws ParentGoneError on the uniform 404. */
  timeline(token: string, studentId: string): Promise<ParentTimelineResponse>;
  /** "ok" on stored; "rejected" on the boundary 400 (length/review/pending-cap);
   *  "gone" on the uniform 404 (dead token mid-session). */
  addNote(token: string, studentId: string, text: string): Promise<"ok" | "rejected" | "gone">;
}

const defaultApi: ParentApi = {
  async children(token) {
    const res = await fetch(`${serverBaseUrl()}/parent/children`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404) throw new ParentGoneError();
    if (!res.ok) throw new Error(`parent children fetch failed (${res.status})`);
    return (await res.json()) as { children: ParentChildSummary[] };
  },
  async timeline(token, studentId) {
    const res = await fetch(`${serverBaseUrl()}/parent/children/${encodeURIComponent(studentId)}/timeline`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404) throw new ParentGoneError();
    if (!res.ok) throw new Error(`parent timeline fetch failed (${res.status})`);
    return (await res.json()) as ParentTimelineResponse;
  },
  async addNote(token, studentId, text) {
    const res = await fetch(`${serverBaseUrl()}/parent/children/${encodeURIComponent(studentId)}/note`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 201) return "ok";
    if (res.status === 400) return "rejected"; // boundary rejection — gentle copy, no detail
    if (res.status === 404) return "gone"; // dead token — re-request guidance, never "换个说法"
    throw new Error(`parent note failed (${res.status})`);
  },
};

type HomeState =
  | { phase: "loading" }
  | { phase: "ready"; children: ParentChildSummary[] }
  | { phase: "unavailable" };

type TimelineState =
  | { phase: "loading" }
  | { phase: "ready"; timeline: ParentTimelineResponse }
  | { phase: "unavailable" };

type NoteState = "idle" | "sending" | "sent" | "rejected";

const NOTE_MAX = 200;

/** One lineage work inside a timeline entry — image and/or text, nothing else renders. */
function WorkItem({ work, alt }: { work: SharedWork; alt: string }): React.JSX.Element {
  return (
    <li>
      {safeSrc(work.contentUrl) && <img src={safeSrc(work.contentUrl)} alt={alt} />}
      {work.contentText && <p>{work.contentText}</p>}
    </li>
  );
}

function NoteComposer({ studentId, displayName, api, token, onGone }: {
  studentId: string;
  displayName: string;
  api: ParentApi;
  token: string;
  onGone: () => void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [state, setState] = useState<NoteState>("idle");

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === "" || state === "sending") return;
    setState("sending");
    try {
      const r = await api.addNote(token, studentId, trimmed);
      if (r === "ok") {
        setText("");
        setState("sent");
      } else if (r === "gone") {
        onGone(); // dead token: re-request guidance — "换个说法" would mislead forever
      } else {
        setState("rejected");
      }
    } catch {
      setState("rejected"); // network/5xx — gentle retry guidance, never a code
    }
  };

  return (
    <section className="parent-home__note" aria-label="给孩子带句话">
      <h3>想对{displayName}说句悄悄话吗？</h3>
      <p>写在这里，孩子的伙伴会在下次见面时，自然地带给孩子。</p>
      <textarea
        value={text}
        maxLength={NOTE_MAX}
        rows={3}
        placeholder="比如：妈妈觉得你今天特别棒～"
        aria-label="悄悄话内容"
        disabled={state === "sending"} // typing during the await would be wiped on success
        onChange={(e) => {
          setText(e.target.value);
          if (state === "sent" || state === "rejected") setState("idle");
        }}
      />
      <div className="parent-home__note-row">
        {/* counts what maxLength enforces (raw chars) — and stays readable to AT */}
        <span>{text.length}/{NOTE_MAX}</span>
        <button type="button" onClick={() => void send()} disabled={text.trim() === "" || state === "sending"}>
          {state === "sending" ? "正在交给伙伴…" : "托伙伴带话"}
        </button>
      </div>
      {state === "sent" && <p role="status">收到啦！伙伴会在下次见面时悄悄告诉孩子 💛</p>}
      {state === "rejected" && (
        <p role="status">这句话暂时没能存好～可以换一种说法，或者等伙伴先把之前的话带给孩子。</p>
      )}
    </section>
  );
}

function ChildTimeline({ child, api, token, onBack, onGone }: {
  child: ParentChildSummary;
  api: ParentApi;
  token: string;
  onBack: () => void;
  onGone: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<TimelineState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .timeline(token, child.studentId)
      .then((timeline) => {
        if (!cancelled) setState({ phase: "ready", timeline });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ParentGoneError) onGone(); // dead token ⇒ re-request guidance
        else setState({ phase: "unavailable" }); // transient ⇒ gentle retry copy
      });
    return () => {
      cancelled = true;
    };
  }, [api, token, child.studentId, onGone]);

  return (
    <div className="parent-home__child">
      <button type="button" onClick={onBack}>
        ← 回到全部孩子
      </button>
      <h2>{child.displayName} 和好朋友的成长故事</h2>

      {state.phase === "loading" && <p role="status">正在翻开成长相册…… ✨</p>}
      {state.phase === "unavailable" && (
        <p role="status">成长相册暂时翻不开～休息一下再来看看吧。</p>
      )}
      {state.phase === "ready" && state.timeline.entries.length === 0 && (
        // Contract-enumerated legitimate state: pre-first-lesson — warmth, never a void.
        <p>第一节课之后，这里就会出现孩子和伙伴的第一个故事啦。</p>
      )}
      {state.phase === "ready" && state.timeline.entries.length > 0 && (
        <ol className="parent-home__timeline" aria-label="成长时间线">
          {state.timeline.entries.map((entry) => (
            <li key={entry.version}>
              <h3>
                {entry.version === 1 ? "诞生时刻" : `第 ${entry.version} 次成长`}
                <time dateTime={entry.createdAt}> · {entry.createdAt.slice(0, 10)}</time>
              </h3>
              {entry.surface.name && <p>名字：{entry.surface.name}</p>}
              {entry.surface.personality && <p>性格：{entry.surface.personality}</p>}
              {entry.surface.backstory && <p>来自：{entry.surface.backstory}</p>}
              {entry.works.length > 0 && (
                <ul className="parent-home__timeline-works">
                  {entry.works
                    .filter((w) => safeSrc(w.contentUrl) !== undefined || w.contentText)
                    .map((w, i) => (
                      <WorkItem key={`${entry.version}-${w.type}-${i}`} work={w} alt="这个阶段的作品" />
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      <NoteComposer studentId={child.studentId} displayName={child.displayName} api={api} token={token} onGone={onGone} />
    </div>
  );
}

export function ParentHomeApp({ api = defaultApi }: { api?: ParentApi }): React.JSX.Element {
  const [state, setState] = useState<HomeState>({ phase: "loading" });
  const [selected, setSelected] = useState<ParentChildSummary | undefined>(undefined);
  // Capture ONCE into memory (survives re-renders), then scrub the value from the
  // address bar — history/screenshot persistence is NOT accepted for this token class
  // (parent-surface.md v1.1 Transport). `?parent=` PRESENCE stays so App routing holds.
  const [token] = useState(() => new URLSearchParams(window.location.search).get("parent") ?? "");
  // Stable identity: rides ChildTimeline's effect deps — must not re-run it per render.
  const onGone = useCallback(() => {
    setSelected(undefined);
    setState({ phase: "unavailable" }); // the warm re-request guidance
  }, []);

  useEffect(() => {
    if (token === "") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("parent") !== "") {
      url.searchParams.set("parent", "");
      window.history.replaceState({}, "", url);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (token === "") {
      setState({ phase: "unavailable" });
      return;
    }
    api
      .children(token)
      .then((r) => {
        if (!cancelled) setState({ phase: "ready", children: r.children });
      })
      .catch(() => {
        // ParentGoneError and transient failures land on the SAME state here — this IS
        // the re-request guidance screen, so no distinction is lost on the initial load.
        if (!cancelled) setState({ phase: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [token, api]);

  if (state.phase === "loading") {
    return (
      <div className="parent-home">
        <p role="status">正在打开孩子们的小世界…… ✨</p>
      </div>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <div className="parent-home">
        <h1>魔法泥人 ✨</h1>
        <p role="status">这个入口休息啦～请联系老师获取新的家长入口。</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="parent-home">
        {/* key = fresh mount per child: timeline state and the note draft never leak
            across children, even if a direct-switch UI appears later */}
        <ChildTimeline
          key={selected.studentId}
          child={selected}
          api={api}
          token={token}
          onBack={() => setSelected(undefined)}
          onGone={onGone}
        />
      </div>
    );
  }

  return (
    <div className="parent-home">
      <header>
        <h1>孩子们的小世界 ✨</h1>
        <p>看看每个孩子和他们的专属好朋友，一起走过的成长路。</p>
      </header>
      {state.children.length === 0 && (
        <p>等孩子上完第一节课，这里就会亮起来啦。</p>
      )}
      <ul className="parent-home__children" aria-label="孩子列表">
        {state.children.map((c) => (
          <li key={c.studentId}>
            <button type="button" onClick={() => setSelected(c)}>
              <strong>{c.displayName}</strong>
              <span>{c.age} 岁 · 已完成 {c.completedLessonIds.length} 节课</span>
              {c.companion?.name && (
                <span>
                  好朋友：{c.companion.name}
                  {c.companion.personality ? `（${c.companion.personality}）` : ""}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
