/**
 * Theme contract — typed realization of docs/contracts/theme.md (Frozen v1) and the
 * THEME_FLOORS_V0 block of brand-style.md v0.1.
 *
 * A theme = a temporary skin rendered in the UI dimension (P2 layered model). Themes are
 * DATA, not code: a ThemePack is a versioned manifest; switching themes swaps the pack;
 * no component knows where a pack came from.
 *
 * Pure TypeScript + closed-schema manual validation (the parseEpisodeValue pattern —
 * NO zod in @genius-x/contracts). Fail closed: unknown keys reject (P1 AI-first:
 * schema-validated, never silently-accepting).
 */

/** The three CLOSED pack sources (theme.md rule 5). */
export const THEME_SOURCES = ["brand_default", "derived", "skin"] as const;
export type ThemeSource = (typeof THEME_SOURCES)[number];

/**
 * Semantic design tokens — the CONTRACT is locked (these keys, these meanings);
 * VALUES are swappable per pack. Kept deliberately small for v1; additions are
 * lead-serialized theme.md revisions.
 */
export interface ThemeTokens {
  /** Color roles (hex #rrggbb). */
  colorBg: string;
  colorSurface: string;
  colorInk: string;
  colorAccent: string;
  colorGlow: string;
  /** Corner radius scale in px (base unit; components derive multiples). */
  radiusBase: number;
  /** Motion character: 0=static .. 3=busy. Floors cap this (THEME_FLOORS_V0). */
  motionIntensity: number;
  /** Type scale base in rem. */
  fontScaleBase: number;
  /** Named asset-set references (resolved by the renderer; NOT URLs). */
  soundscapeRef: string;
  idleMotionSetRef: string;
  illustrationSetRef: string;
}

export interface ThemePackV1 {
  themeId: string;
  /** Immutable per-pack snapshot version. */
  version: number;
  source: ThemeSource;
  /** Lineage when source="derived" (the P4.5 pattern); null otherwise. */
  characterVersionId: string | null;
  /** Skins only — mandatory there, null otherwise (auto-revert; snapshot stays). */
  expiresAt: string | null;
  tokens: ThemeTokens;
  /** Named slots → URLs (renderer applies the safeSrc discipline before use). */
  assets: Record<string, string>;
}

/**
 * THEME_FLOORS_V0 — brand-style.md v0.1. PLACEHOLDER values by design (the brand
 * design doc, DF-v2-18, replaces VALUES — never the rule). No pack may cross these.
 */
export const THEME_FLOORS_V0 = {
  /** WCAG AA — child readability floor (ink over bg). */
  contrastMin: 4.5,
  /** Minimum touch target in px (consumed by component CSS, asserted in UI tests). */
  tapTargetMinPx: 48,
  /** Themes may not exceed this motionIntensity. */
  motionIntensityMax: 2,
  /** Brand doc fills (e.g. alarm-red hue bands, degrees [start, end]); empty = none yet. */
  forbiddenHueRanges: [] as ReadonlyArray<readonly [number, number]>,
} as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;
const TOKEN_KEYS: ReadonlyArray<keyof ThemeTokens> = [
  "colorBg", "colorSurface", "colorInk", "colorAccent", "colorGlow",
  "radiusBase", "motionIntensity", "fontScaleBase",
  "soundscapeRef", "idleMotionSetRef", "illustrationSetRef",
];
const COLOR_KEYS = ["colorBg", "colorSurface", "colorInk", "colorAccent", "colorGlow"] as const;
const REF_KEYS = ["soundscapeRef", "idleMotionSetRef", "illustrationSetRef"] as const;
const PACK_KEYS = ["themeId", "version", "source", "characterVersionId", "expiresAt", "tokens", "assets"];

/** sRGB relative luminance → WCAG contrast ratio (the contrast floor's math). */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Hue in degrees, or null for achromatic colors (chroma 0 — hue is undefined there). */
function chromaAndHue(hex: string): number | null {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return null; // white/gray/black — exempt from hue bands
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

/**
 * Floor check (theme.md rule 1 / brand-style.md v0.1): returns the list of violated
 * floors (empty = compliant). A violating pack must NEVER render — the caller falls
 * back to brand_default and traces `theme_pack_invalid`.
 */
export function violatesFloors(tokens: ThemeTokens, floors = THEME_FLOORS_V0): string[] {
  const v: string[] = [];
  // FAIL CLOSED (review fix): exported standalone, so malformed hex must violate, not
  // slip through as NaN comparisons (NaN < x is false — the silent fail-open trap).
  if (COLOR_KEYS.some((k) => !HEX_RE.test(tokens[k]))) {
    v.push("contrastMin");
    return v;
  }
  const ratio = contrastRatio(tokens.colorInk, tokens.colorBg);
  if (!Number.isFinite(ratio) || ratio < floors.contrastMin) v.push("contrastMin");
  if (tokens.motionIntensity > floors.motionIntensityMax) v.push("motionIntensityMax");
  for (const key of COLOR_KEYS) {
    const c = chromaAndHue(tokens[key]);
    if (c === null) continue; // achromatic (white/gray/black) — hue is meaningless, exempt
    const hue = c;
    // Wrap-around bands supported (review fix): [350, 10] means hue ≥ 350 OR ≤ 10 —
    // exactly the shape an alarm-red band takes (DF-v2-18 fill must not brick defaults).
    if (floors.forbiddenHueRanges.some(([a, b]) => (a <= b ? hue >= a && hue <= b : hue >= a || hue <= b))) {
      v.push(`forbiddenHue:${key}`);
      break;
    }
  }
  return v;
}

/**
 * CLOSED-schema parse (fail closed): exactly the ThemePackV1 shape, nothing smuggled
 * alongside; null on ANY mismatch — the caller falls back to brand_default.
 * Floors are checked separately (violatesFloors) so the trace can distinguish
 * malformed-vs-floor-crossing.
 */
export function parseThemePack(input: unknown): ThemePackV1 | null {
  const o = typeof input === "string" ? safeJson(input) : input;
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const rec = o as Record<string, unknown>;
  const keys = Object.keys(rec);
  // OWN keys only (review fix — `in` walks the prototype chain; the parseEpisodeValue pattern).
  if (keys.length !== PACK_KEYS.length || !PACK_KEYS.every((k) => Object.hasOwn(rec, k))) return null;
  if (typeof rec.themeId !== "string" || rec.themeId === "") return null;
  if (typeof rec.version !== "number" || !Number.isInteger(rec.version) || rec.version < 1) return null;
  if (!THEME_SOURCES.includes(rec.source as ThemeSource)) return null;
  if (rec.characterVersionId !== null && (typeof rec.characterVersionId !== "string" || rec.characterVersionId === "")) return null;
  // expiresAt must be a PARSEABLE timestamp (skin auto-revert depends on it).
  if (rec.expiresAt !== null && (typeof rec.expiresAt !== "string" || Number.isNaN(Date.parse(rec.expiresAt)))) return null;
  // Source-coupled invariants (theme.md): derived ⇒ lineage; skin ⇒ expiry mandatory.
  if (rec.source === "derived" && rec.characterVersionId === null) return null;
  if (rec.source !== "derived" && rec.characterVersionId !== null) return null;
  if (rec.source === "skin" && rec.expiresAt === null) return null;
  if (rec.source !== "skin" && rec.expiresAt !== null) return null;

  const t = rec.tokens;
  if (t === null || typeof t !== "object" || Array.isArray(t)) return null;
  const tr = t as Record<string, unknown>;
  if (Object.keys(tr).length !== TOKEN_KEYS.length || !TOKEN_KEYS.every((k) => Object.hasOwn(tr, k))) return null;
  for (const k of COLOR_KEYS) if (typeof tr[k] !== "string" || !HEX_RE.test(tr[k] as string)) return null;
  for (const k of REF_KEYS) if (typeof tr[k] !== "string" || tr[k] === "") return null;
  for (const k of ["radiusBase", "motionIntensity", "fontScaleBase"] as const) {
    if (typeof tr[k] !== "number" || !Number.isFinite(tr[k] as number) || (tr[k] as number) < 0) return null;
  }
  if ((tr.fontScaleBase as number) === 0) return null; // invisible text defeats readability

  const a = rec.assets;
  if (a === null || typeof a !== "object" || Array.isArray(a)) return null;
  for (const val of Object.values(a as Record<string, unknown>)) {
    if (typeof val !== "string") return null;
  }
  return rec as unknown as ThemePackV1;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * The BRAND DEFAULT pack (theme.md source #1): always available, ships in the bundle,
 * offline-capable — the fallback for everything. Values mirror the interim styles.css
 * palette (DF-M3-7's full visual pass replaces values with the brand doc).
 */
export const BRAND_DEFAULT_THEME: ThemePackV1 = {
  themeId: "brand-default-v0",
  version: 1,
  source: "brand_default",
  characterVersionId: null,
  expiresAt: null,
  tokens: {
    colorBg: "#fdf7ff",
    colorSurface: "#ffffff",
    colorInk: "#2b2350",
    colorAccent: "#5b3fff",
    colorGlow: "#ffd166",
    radiusBase: 16,
    motionIntensity: 1,
    fontScaleBase: 1,
    soundscapeRef: "brand-default",
    idleMotionSetRef: "brand-default",
    illustrationSetRef: "brand-default",
  },
  assets: {},
};
