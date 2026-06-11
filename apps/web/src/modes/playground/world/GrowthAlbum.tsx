/**
 * 相册(成长快照) (world.md: ip_character_versions → the album) — version ASC, v1 =
 * 诞生时刻. Surface only (name/personality/backstory) — base canon never renders.
 * Form-agnostic copy (the friend may be any shape — §0.5).
 */
import type { WorldObjectProps } from "./registry";

export function GrowthAlbum({ world }: WorldObjectProps): React.JSX.Element | null {
  if (world.album.length === 0) return null; // pre-first-lesson: the room stays small
  return (
    <section className="world-album" aria-label="成长相册">
      <h2>我们的相册</h2>
      <ol>
        {world.album.map((page) => (
          <li key={page.version}>
            <h3>
              {page.version === 1 ? "诞生时刻" : `第 ${page.version} 次成长`}
              <time dateTime={page.createdAt}> · {page.createdAt.slice(0, 10)}</time>
            </h3>
            {page.surface.name && <p>名字：{page.surface.name}</p>}
            {page.surface.personality && <p>性格：{page.surface.personality}</p>}
            {page.surface.backstory && <p>来自：{page.surface.backstory}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
