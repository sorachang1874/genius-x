/**
 * Shell EntryResolver — the ONE place that turns a URL into an entry decision.
 * Extracted from App.tsx (Phase 6.5 Shell refactor): ALL existing query-param aliases
 * are preserved verbatim — links already in the wild must not break.
 *
 * PRESENCE rules (`has`, not truthiness): an IM-truncated "?share=" / "?parent=" must
 * land on the matching parent surface's warm guidance, never the student room-code
 * screen (the Phase-3 routing pin, extended in Phase 6).
 *
 * Precedence is INTENTIONAL and pinned by tests:
 *   share > parent > playground > role (assistant/teacher) > student (default).
 * A link carrying both share and parent lands on the scoped share view (the safer
 * surface); playground (?playground=<session token>, agent-session.md) sits after the
 * parent surfaces — the parent door mints it, so a combined link is parent-context.
 */
export type Entry =
  | { kind: "share" }
  | { kind: "parent" }
  | { kind: "playground" }
  | { kind: "assistant" }
  | { kind: "teacher" }
  | { kind: "student" };

export function resolveEntry(search: string): Entry {
  const params = new URLSearchParams(search);
  if (params.has("share")) return { kind: "share" };
  if (params.has("parent")) return { kind: "parent" };
  if (params.has("playground")) return { kind: "playground" };
  const role = params.get("role");
  if (role === "assistant") return { kind: "assistant" };
  if (role === "teacher") return { kind: "teacher" };
  return { kind: "student" };
}
