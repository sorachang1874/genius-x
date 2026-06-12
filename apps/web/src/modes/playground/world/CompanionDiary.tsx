/**
 * 摊开的日记 (world.md: `self_narrative` → companion_diary) — the friend's own
 * recollections, newest first. Curated deterministic entries (L1 v1); the child READS
 * the friend's life between visits — the cheapest proof that "it was also living".
 * Form-agnostic copy; renders nothing pre-first-diary (earned world).
 */
import type { WorldObjectProps } from "./registry";

/** The classroom's timezone — diary dates must match the child's day, not UTC
 *  (an 07:30 lesson must not read as yesterday — review fix). */
const diaryDate = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" });

export function CompanionDiary({ world }: WorldObjectProps): React.JSX.Element | null {
  if (world.diary.length === 0) return null;
  return (
    <section className="world-diary" aria-label="摊开的日记">
      <h2>它的小日记</h2>
      <ol>
        {world.diary.map((entry, i) => (
          <li key={`${entry.createdAt}-${i}`}>
            <time dateTime={entry.createdAt}>{diaryDate.format(new Date(entry.createdAt))}</time>
            <p>{entry.summary}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
