/**
 * 作品上墙 (world.md: works + lineage → the wall) — the curated latest work per type;
 * tapping a wall item with slices replays the 打磨轨迹 (a gentle step-through, child-
 * driven, zero AI). Copy: warm, form-agnostic, banned-wording-clean.
 */
import { useState } from "react";
import type { WorldWallItem } from "@genius-x/contracts";
import { safeSrc } from "../../../parent/safe-src";
import type { WorldObjectProps } from "./registry";

function WallItem({ item }: { item: WorldWallItem }): React.JSX.Element {
  const [step, setStep] = useState<number | null>(null); // null = the final hangs
  const showing = step === null ? item.final : item.slices[step] ?? item.final;
  const replayable = item.slices.length > 0;

  const advance = (): void => {
    if (!replayable) return;
    if (step === null) setStep(0);
    else if (step + 1 < item.slices.length) setStep(step + 1);
    else setStep(null); // back to the final — the story完整走完
  };

  return (
    <li className="world-wall__item">
      <button type="button" onClick={advance} aria-label="看看这件作品的成长之路">
        {safeSrc(showing.contentUrl) && <img src={safeSrc(showing.contentUrl)} alt="墙上的作品" />}
        {showing.contentText && <p>{showing.contentText}</p>}
      </button>
      {replayable && (
        <p className="world-wall__caption">
          {step === null ? "点一点，看看它是怎么一步步变成这样的" : `第 ${step + 1} 步，慢慢变好看啦`}
        </p>
      )}
    </li>
  );
}

export function WorksWall({ world }: WorldObjectProps): React.JSX.Element | null {
  // EARNED, not pre-stocked (world.md rule 3): an empty wall renders NOTHING here —
  // the room itself carries the "world is still small" narrative, never an empty state.
  const items = world.wall.filter((w) => safeSrc(w.final.contentUrl) !== undefined || w.final.contentText);
  if (items.length === 0) return null;
  return (
    <section className="world-wall" aria-label="墙上的作品">
      <ul>
        {items.map((item, i) => (
          <WallItem key={`${item.type}-${i}`} item={item} />
        ))}
      </ul>
    </section>
  );
}
