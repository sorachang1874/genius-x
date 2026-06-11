/**
 * Shell ThemeProvider (theme.md v1) — applies a ThemePack's tokens as CSS custom
 * properties on the document root. Themes are DATA: components consume `var(--gx-*)`
 * and never know where values came from.
 *
 * Posture (theme.md failure modes): an invalid or floor-crossing pack NEVER renders —
 * BRAND_DEFAULT_THEME applies and the rejection is operator-visible (console.warn on
 * the client; the authoritative `theme_pack_invalid` trace lives server-side at serve
 * time). styles.css carries identical :root defaults so a no-JS/early-paint frame is
 * already on-brand (offline rule for the brand_default source).
 */
import { useEffect } from "react";
import type { ThemePackV1, ThemeTokens } from "@genius-x/contracts";
import { BRAND_DEFAULT_THEME, parseThemePack, violatesFloors } from "@genius-x/contracts";

/** token key → CSS custom property (the LOCKED contract surface of styles.css). */
const CSS_VARS: ReadonlyArray<[keyof ThemeTokens, string, (v: string | number) => string]> = [
  ["colorBg", "--gx-bg", String],
  ["colorSurface", "--gx-surface", String],
  ["colorInk", "--gx-ink", String],
  ["colorAccent", "--gx-accent", String],
  ["colorGlow", "--gx-glow", String],
  ["radiusBase", "--gx-radius", (v) => `${v}px`],
  ["fontScaleBase", "--gx-font-scale", String],
  ["motionIntensity", "--gx-motion", String],
];

/** Validate-then-apply: returns the pack that ACTUALLY rendered (for tests/telemetry). */
export function applyTheme(input: unknown, root: HTMLElement = document.documentElement): ThemePackV1 {
  let pack = input === undefined ? BRAND_DEFAULT_THEME : parseThemePack(input);
  if (pack === null) {
    console.warn("[theme] invalid pack — brand default applied"); // operator-visible
    pack = BRAND_DEFAULT_THEME;
  } else {
    const floors = violatesFloors(pack.tokens);
    if (floors.length > 0) {
      console.warn("[theme] pack crosses brand floors — brand default applied:", floors);
      pack = BRAND_DEFAULT_THEME;
    } else if (pack.expiresAt !== null && Date.parse(pack.expiresAt) < Date.now()) {
      // theme.md failure mode: an expired skin NEVER renders — revert (the full
      // last-non-skin revert lives at the loader seam; here brand default suffices).
      console.warn("[theme] expired skin — brand default applied");
      pack = BRAND_DEFAULT_THEME;
    }
  }
  for (const [key, cssVar, fmt] of CSS_VARS) {
    root.style.setProperty(cssVar, fmt(pack.tokens[key] as string | number));
  }
  return pack;
}

/**
 * v1 Shell wrapper: applies the brand default (or a supplied pack) once on mount.
 * Derived/skin packs arrive with the playground work — same seam, zero component churn.
 */
export function ThemeProvider({ pack, children }: { pack?: unknown; children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    applyTheme(pack);
  }, [pack]);
  return <>{children}</>;
}
