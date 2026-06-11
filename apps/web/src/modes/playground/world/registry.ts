/**
 * The WORLD REGISTRY — world.md v1's pinned enforcement mechanism (the tools.ts
 * pattern): every child-rendered world object registers HERE, mirroring the contract's
 * closed mapping table 1:1. CI asserts (world.test.tsx): registry keys == the
 * checked-in contract rows below; every component under this directory is registered;
 * banned wording never appears in registry strings.
 *
 * v0 ships the zero-AI-floor rows only (read-only — agent-session.md gate ⑤). Adding a
 * row here REQUIRES the matching world.md mapping-table row to exist first.
 */
import type { ComponentType } from "react";
import type { PlaygroundWorldView } from "@genius-x/contracts";
import { WorksWall } from "./WorksWall";
import { GrowthAlbum } from "./GrowthAlbum";
import { CompanionDiary } from "./CompanionDiary";

export interface WorldObjectProps {
  world: PlaygroundWorldView;
}

/** Asset kind (world.md mapping-table left column) → the in-world component. */
export const WORLD_REGISTRY = {
  /** Work + lineage (`works`) → 作品上墙/上架 (tap = 打磨轨迹 replay). */
  works_wall: WorksWall,
  /** IP character version (`ip_character_versions`) → 相册(成长快照). */
  growth_album: GrowthAlbum,
  /** Companion diary (`self_narrative`, L1) → 摊开的日记. */
  companion_diary: CompanionDiary,
} as const satisfies Record<string, ComponentType<WorldObjectProps>>;

/**
 * The checked-in copy of world.md's CLOSED mapping table (v0-shipped rows). The CI
 * test diffs WORLD_REGISTRY keys against this — drift between contract and registry
 * fails the build, not the child.
 */
export const WORLD_CONTRACT_ROWS_V0 = ["works_wall", "growth_album", "companion_diary"] as const;
