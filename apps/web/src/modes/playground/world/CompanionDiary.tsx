/**
 * 摊开的日记 (world.md: `self_narrative` → companion_diary) — the friend's own
 * recollections, newest first. Curated deterministic entries (L1 v1); the child READS
 * the friend's life between visits — the cheapest proof that "it was also living".
 * Form-agnostic copy; renders nothing pre-first-diary (earned world).
 */
import type { WorldObjectProps } from "./registry";

export function CompanionDiary({ world }: WorldObjectProps): React.JSX.Element | null {
  if (world.diary.length === 0) return null;
  return (
    <section className="world-diary" aria-label="摊开的日记">
      <h2>它的小日记</h2>
      <ol>
        {world.diary.map((entry, i) => (
          <li key={`${entry.createdAt}-${i}`}>
            <time dateTime={entry.createdAt}>{entry.createdAt.slice(5, 10).replace("-", "月")}日</time>
            <p>{entry.summary}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
