# Theme Contract (design tokens — the world's skin)

**Status**: Frozen v1 (scope = token schema + sources + derivation seams;具体视觉值随品牌文档)
**Owner**: AI gateway / brand (Agent D) — derivation & brand locks; child surfaces (Agent B) — consumption
**Typed realization**: `packages/contracts/src/theme.ts` (ThemePackV1, to be added with the Shell work)
**Companion contracts**: [`world.md`](world.md)、[`ip-character.md`](ip-character.md)(派生输入)、
[`brand-style.md`](brand-style.md)(品牌基因;style-v0 → 正式品牌包)、APP PRD §4
**Last updated**: 2026-06-10

---

## Purpose

A theme = **a temporary skin rendered in the UI dimension** (P2 layered model — snapshot-
logged, never overwriting the base). Themes are **data, not code**: a ThemePack is a
versioned JSON manifest; switching themes swaps the pack; no component knows where a
pack came from. This is the decoupling seam the founder asked for — and the insurance
that makes tier timing (Q2) a scheduling choice instead of a refactor.

## ThemePackV1 (schema-validated — P1 AI-first; closed-schema MANUAL validation in `@genius-x/contracts` — the package's no-zod convention; zod belongs at service boundaries)

```jsonc
{
  "themeId": "id",              // derived packs: uuid; brand_default/skin packs: slug (global rows)
  "version": 1,                       // per-pack, immutable snapshots
  "source": "brand_default | derived | skin",
  "characterVersionId": "uuid|null",  // lineage when source=derived (P4.5 pattern)
  "expiresAt": "ISO|null",            // skins only — auto-revert, snapshot stays
  "tokens": { /* v1 ships 11 tokens (the floor of the 15-25 envelope): color roles
                 (bg/surface/ink/accent/glow), radius scale, motionIntensity, type
                 scale, soundscape/idle-motion/illustration refs — additions are
                 lead-serialized revisions of this contract */ },
  "assets": { /* named slots → URLs (safeSrc-constrained) */ }
}
```

## Hard rules

1. **The token CONTRACT is brand-locked; values are swappable**: contrast floor
   (child readability), minimum tap-target, forbidden color zones, motion-intensity
   ceiling. **No theme may cross these** — schema validation enforces the floors;
   the numeric source of truth is **`THEME_FLOORS_V0` in
   [`brand-style.md`](brand-style.md) v0.1** (serialized there with this freeze —
   placeholder values, the brand doc DF-v2-18 replaces values, never the rule; the
   constants live in `packages/contracts/src/theme.ts`).
2. **Theme is magic, not a setting** (child-facing): no theme picker, ever. Derived
   themes APPLY when the character evolves; the child DISCOVERS the change. The 衣柜
   (skins) is an in-world object, not a menu.
3. **Classroom stays brand-default in v1** (founder-reviewed PRD): per-child themes
   render in playground/co-create only — projection and parent-visible classroom
   surfaces are brand surfaces.
4. **Form-agnostic** (world.md rule 1): tokens describe mood/color/motion — never
   anatomy. Idle-motion sets are referenced by id and supplied per form family
   (brand doc).
5. **Sources** (exactly three; closed):
   - `brand_default` — always available, ships in the bundle, offline-capable.
     **The fallback for everything.** Distinct default packs per fallback-avatar
     family (the 防撞车 rule extends; awaits DF-v2-18 sets).
   - `derived` — server-side ThemeDeriver: deterministic extraction from
     `ip_character_versions.surface` (palette quantization snapped to brand-safe
     gamut; silhouette → pattern; personality → motion/idle set + microcopy tone).
     One pack per character version (lineage column). **v1.5 honesty gate**: until
     real image generation OR the DF-v2-18 per-child avatar set exists, derived
     packs are pipeline + internal demo only (FakeProvider presets collide across
     children — never marketed as 专属).
   - `skin` — temporary (festival/crossover): `expiresAt` mandatory, auto-revert,
     snapshot logged; third-party crossover skins stay in-experience only (export/
     merch = separate licensing, risk ledger).
6. **AI-generated theme ASSETS** (unique furniture/wallpaper) are Phase 7+: brand-
   conformance check (DF-v2-23 judge) + review queue BEFORE appearing. **Real-time
   AI world rendering: never.**

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Derivation fails | `brand_default` applies; `theme_derive_failed` trace (countable); the child sees a beautiful world either way |
| Pack fails schema validation at load | Same as above — `theme_pack_invalid` trace; invalid packs never render |
| Skin expired | Auto-revert to the last NON-skin active pack (derived if one exists, else brand_default — skin-on-skin never chains); snapshot remains in history |
| Offline | Last-applied pack from local cache; `brand_default` if none |

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ThemePack | D owns derivation RULES; service/table home = `apps/server/src/theme` (C/H directory — named at fan-out in the ownership map) | 🆕 `theme_packs` table (tenant_id + student-scoped only for derived packs — composite FK via character version's student; brand_default/skin packs are global rows, tenant NULL) | schema-valid, brand-floor-compliant | brand_default static / derived deterministic / skin curated | Shell ThemeProvider | brand_default | derived packs follow the character-version erasure path (DF-v2-17); brand_default/skins exempt (no child data) | schema + floor validation test; composite-FK drift (derived rows) |
| token floors | D (with brand-style.md v0.1) | `THEME_FLOORS_V0` (`packages/contracts/src/theme.ts`) | brand-style.md v0.1 values (placeholders) | — | validator | n/a | git-versioned | floor-violation test (a crossing pack rejects) |
| lineage | D | `character_version_id` column | FK to ip_character_versions | per derive | timeline/operator | NULL for non-derived | with pack | lineage FK preflight |
| `theme_derive_failed` / `theme_pack_invalid` | D | trace (CLOSED: exactly these two) | exact reason names | operator metrics | n/a | n/a | exact-match trace test |

## Changelog

- **v1** (2026-06-10): initial freeze, converged pre-merge with the adversarial contract
  review — floors' source of truth serialized into brand-style.md v0.1 (THEME_FLOORS_V0,
  never asserted unilaterally), Deletion column added (derived packs ride the character-
  version erasure path), deriver's directory home named, skin-on-skin revert pinned.
  Core: ThemePackV1 schema, three closed sources, brand-locked floors, derivation seam
  (deterministic v1.5 with the honesty gate), classroom-stays-default, theme-is-magic;
  Q2 tier timing stays open WITHOUT refactor risk because this schema is the seam.

_Theme Contract · APP integration · Frozen v1 · 2026-06-10_
