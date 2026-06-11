/**
 * Shell pins (Phase 6.5 Step 2): EntryResolver precedence + alias preservation
 * (links in the wild must not break), ThemePack closed-schema parse + brand floors
 * (theme.md v1 / brand-style.md v0.1), ThemeProvider apply-or-default posture.
 */
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ThemePackV1 } from "@genius-x/contracts";
import { BRAND_DEFAULT_THEME, THEME_FLOORS_V0, contrastRatio, parseThemePack, violatesFloors } from "@genius-x/contracts";
import { resolveEntry } from "./entry";
import { ThemeProvider, applyTheme } from "./theme/ThemeProvider";

describe("EntryResolver — every legacy alias resolves exactly as before", () => {
  it.each([
    ["?share=ABC", "share"],
    ["?share=", "share"], // PRESENCE rule — IM-truncated link
    ["?parent=ABC", "parent"],
    ["?parent=", "parent"],
    ["?share=A&parent=B", "share"], // pinned precedence: the safer scoped surface wins
    ["?role=assistant", "assistant"],
    ["?role=teacher", "teacher"],
    ["?role=unknown", "student"],
    ["?studentId=x", "student"],
    ["", "student"],
  ])("%s → %s", (search, kind) => {
    expect(resolveEntry(search).kind).toBe(kind);
  });
});

const VALID: ThemePackV1 = {
  themeId: "t1",
  version: 1,
  source: "derived",
  characterVersionId: "33333333-3333-4333-8333-000000000001",
  expiresAt: null,
  tokens: { ...BRAND_DEFAULT_THEME.tokens, colorAccent: "#2255cc" },
  assets: {},
};

describe("ThemePackV1 — closed schema, fail closed (theme.md)", () => {
  it("accepts a valid pack; rejects smuggled keys, bad colors, source-invariant breaks", () => {
    expect(parseThemePack(VALID)).not.toBeNull();
    expect(parseThemePack({ ...VALID, extra: 1 })).toBeNull(); // unknown key
    expect(parseThemePack({ ...VALID, tokens: { ...VALID.tokens, colorBg: "red" } })).toBeNull(); // non-hex
    expect(parseThemePack({ ...VALID, characterVersionId: null })).toBeNull(); // derived needs lineage
    expect(parseThemePack({ ...VALID, source: "brand_default" })).toBeNull(); // non-derived w/ lineage
    expect(parseThemePack({ ...VALID, source: "skin" })).toBeNull(); // skin needs expiresAt (and no lineage)
    expect(parseThemePack("not json {{")).toBeNull();
    expect(parseThemePack(JSON.stringify(VALID))).not.toBeNull(); // string form parses
    // degenerate values (review fixes): empty lineage, unparseable expiry, zero font scale
    expect(parseThemePack({ ...VALID, characterVersionId: "" })).toBeNull();
    expect(parseThemePack({ ...VALID, source: "skin", characterVersionId: null, expiresAt: "not-a-date" })).toBeNull();
    expect(parseThemePack({ ...VALID, tokens: { ...VALID.tokens, fontScaleBase: 0 } })).toBeNull();
    // prototype-smuggle (review fix): `in` would walk the chain; Object.hasOwn must not
    const proto = Object.create({ assets: {} });
    Object.assign(proto, { ...VALID, smuggled: "payload" });
    delete (proto as Record<string, unknown>).assets; // 7 own keys incl. smuggled; assets on prototype
    expect(parseThemePack(proto)).toBeNull();
  });

  it("floors fail CLOSED on malformed hex; wrap-around hue bands work; achromatic colors exempt", () => {
    const badHex = { ...VALID.tokens, colorInk: "#fff" as string };
    expect(violatesFloors(badHex)).toContain("contrastMin"); // NaN never slips through
    const redBand = { ...THEME_FLOORS_V0, forbiddenHueRanges: [[350, 10]] as ReadonlyArray<readonly [number, number]> };
    expect(violatesFloors({ ...VALID.tokens, colorAccent: "#ff0000" }, redBand).some((x) => x.startsWith("forbiddenHue"))).toBe(true); // hue 0 in wrap band
    expect(violatesFloors(BRAND_DEFAULT_THEME.tokens, redBand)).toEqual([]); // white surface (achromatic) NOT bricked
  });

  it("brand floors: low-contrast and over-busy motion are violations; the default pack is clean", () => {
    expect(violatesFloors(BRAND_DEFAULT_THEME.tokens)).toEqual([]);
    expect(contrastRatio(BRAND_DEFAULT_THEME.tokens.colorInk, BRAND_DEFAULT_THEME.tokens.colorBg)).toBeGreaterThanOrEqual(THEME_FLOORS_V0.contrastMin);
    const lowContrast = { ...VALID.tokens, colorInk: "#fdf7ff" }; // ink ≈ bg
    expect(violatesFloors(lowContrast)).toContain("contrastMin");
    const tooBusy = { ...VALID.tokens, motionIntensity: 3 };
    expect(violatesFloors(tooBusy)).toContain("motionIntensityMax");
  });
});

describe("ThemeProvider — apply-or-brand-default (a violating pack NEVER renders)", () => {
  it("applies a valid pack's tokens as --gx-* custom properties", () => {
    const applied = applyTheme(VALID);
    expect(applied.themeId).toBe("t1");
    expect(document.documentElement.style.getPropertyValue("--gx-accent")).toBe("#2255cc");
    expect(document.documentElement.style.getPropertyValue("--gx-radius")).toBe("16px");
  });

  it("invalid, floor-crossing, and EXPIRED-skin packs all fall back to BRAND_DEFAULT_THEME", () => {
    expect(applyTheme({ junk: true }).themeId).toBe(BRAND_DEFAULT_THEME.themeId);
    const crossing = { ...VALID, tokens: { ...VALID.tokens, motionIntensity: 3 } };
    expect(applyTheme(crossing).themeId).toBe(BRAND_DEFAULT_THEME.themeId);
    const expiredSkin = { ...VALID, source: "skin" as const, characterVersionId: null, expiresAt: "2020-01-01T00:00:00Z" };
    expect(applyTheme(expiredSkin).themeId).toBe(BRAND_DEFAULT_THEME.themeId); // never renders
    expect(document.documentElement.style.getPropertyValue("--gx-accent")).toBe(BRAND_DEFAULT_THEME.tokens.colorAccent);
  });

  it("the provider component applies the brand default on mount (no pack supplied)", async () => {
    document.documentElement.style.setProperty("--gx-bg", "#000000"); // dirty state
    render(<ThemeProvider><div>ok</div></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--gx-bg")).toBe(BRAND_DEFAULT_THEME.tokens.colorBg));
  });
});
