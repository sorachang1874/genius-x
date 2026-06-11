/**
 * Parent read-only H5 (Phase 3, Agent K) — opened via the capability URL (?share=<token>).
 * Renders the child's 伙伴出生证 hero card + works gallery from GET /share/:token.
 *
 * Copy rules (parent-share.md): warm, zero technical wording (no AI/error codes — the
 * companion is a friend on every surface); any failure (expired/unknown/network) renders
 * ONE warm guidance state, never a distinction the contract's uniform-404 hides anyway.
 */
import { useEffect, useState } from "react";
import type { ParentShareView, SharedWork } from "@genius-x/contracts";
import { serverBaseUrl } from "../shared/socket";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; view: ParentShareView }
  | { phase: "unavailable" };

/** Injectable fetch seam for tests; defaults to the real endpoint. */
export type ShareFetcher = (token: string) => Promise<ParentShareView>;

const defaultFetcher: ShareFetcher = async (token) => {
  const res = await fetch(`${serverBaseUrl()}/share/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`share fetch failed (${res.status})`);
  return (await res.json()) as ParentShareView;
};

interface CertificateJson {
  studentName?: string;
  avatarUrl?: string;
  personalityTag?: string;
  backgroundSetting?: string;
  memories?: { label: string; value: string }[];
  birthdaySpeech?: string;
}

/**
 * Render-safe media URL (defense-in-depth on the one unauthenticated surface): https?,
 * root-relative, or the dev/demo fake:// — anything else (javascript:, data:, …) is
 * skipped, never rendered as an img src.
 */
const safeSrc = (url: string | undefined): string | undefined =>
  url !== undefined && /^(https?:\/\/|\/(?!\/)|fake:\/\/)/i.test(url) ? url : undefined;

export function ParentShareApp({ fetcher = defaultFetcher }: { fetcher?: ShareFetcher }): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const token = new URLSearchParams(window.location.search).get("share") ?? "";

  useEffect(() => {
    let cancelled = false;
    if (token === "") {
      setState({ phase: "unavailable" });
      return;
    }
    fetcher(token)
      .then((view) => {
        if (!cancelled) setState({ phase: "ready", view });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [token, fetcher]);

  if (state.phase === "loading") {
    return (
      <div className="parent-share">
        <p role="status">正在打开孩子的小世界…… ✨</p>
      </div>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <div className="parent-share">
        <h1>魔法泥人 ✨</h1>
        <p role="status">这个链接休息啦～请联系老师获取新的分享链接。</p>
      </div>
    );
  }

  const { view } = state;
  const cert = (view.certificate ?? undefined) as CertificateJson | undefined;
  // Only works with renderable content reach the gallery (a contentJson-only work from a
  // future lesson must not render an empty bullet).
  const gallery = view.works.filter((w: SharedWork) => safeSrc(w.contentUrl) !== undefined || w.contentText);
  const empty = cert === undefined && gallery.length === 0;
  return (
    <div className="parent-share">
      <header>
        <h1>{view.studentDisplayName} 的好朋友诞生啦 ✨</h1>
        <p>今天在课堂上，{view.studentDisplayName} 亲手孕育了一位专属好朋友。</p>
      </header>

      {empty && (
        // Contract-enumerated legitimate state ("Workspace empty"): warm copy, never a
        // blank page — the parent of the child who struggled most sees warmth, not a void.
        <section className="parent-share__empty">
          <p>作品还在路上～老师整理好之后，这里就能看到孩子的精彩瞬间啦。</p>
        </section>
      )}

      {cert && (
        <section className="parent-share__certificate" aria-label="伙伴出生证">
          <h2>伙伴出生证</h2>
          {safeSrc(cert.avatarUrl) && <img src={safeSrc(cert.avatarUrl)} alt="好朋友的样子" />}
          {cert.birthdaySpeech && <blockquote>“{cert.birthdaySpeech}”</blockquote>}
          {cert.personalityTag && <p>性格：{cert.personalityTag}</p>}
          {cert.backgroundSetting && <p>来自：{cert.backgroundSetting}</p>}
          {cert.memories && cert.memories.length > 0 && (
            <ul>
              {cert.memories.map((m) => (
                <li key={m.label}>
                  {m.label}：{m.value}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {gallery.length > 0 && (
        <section className="parent-share__works" aria-label="课堂作品">
          <h2>今天的作品</h2>
          <ul>
            {gallery.map((w: SharedWork, i: number) => (
              <li key={`${w.type}-${i}`}>
                {safeSrc(w.contentUrl) && <img src={safeSrc(w.contentUrl)} alt="孩子的作品" />}
                {w.contentText && <p>{w.contentText}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.iterations && view.iterations.length > 0 && (
        // 打磨轨迹 (parent-share v1.3, decision ②): tap to expand the sampled drafts —
        // the growth story behind each final, never a wall of near-duplicates.
        <section className="parent-share__iterations" aria-label="打磨轨迹">
          {view.iterations.map((it) => (
            <details key={it.type}>
              <summary>看看这件作品的成长之路（一共尝试了 {it.total} 次）</summary>
              <ol>
                {it.slices
                  .filter((w) => safeSrc(w.contentUrl) !== undefined || w.contentText)
                  .map((w, i) => (
                    <li key={`${it.type}-slice-${i}`}>
                      {safeSrc(w.contentUrl) && <img src={safeSrc(w.contentUrl)} alt={`第 ${i + 1} 次尝试`} />}
                      {w.contentText && <p>{w.contentText}</p>}
                    </li>
                  ))}
              </ol>
            </details>
          ))}
        </section>
      )}

      <footer>
        <p>链接有效期至 {view.expiresAt.slice(0, 10)} · 想了解更多，欢迎联系老师</p>
      </footer>
    </div>
  );
}
