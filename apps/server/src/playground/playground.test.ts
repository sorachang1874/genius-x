/**
 * PlaygroundService — agent-session.md v1 pins: the SEPARATE token class (uniform 404,
 * TTL = quota + grace), one-active-session-per-student (mint revokes prior — the named
 * divergence from share re-mint semantics), the curfew, and the v0 world view's DENY
 * discipline. PGlite + migrations 001-008.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { TraceEvent } from "@genius-x/contracts";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService } from "../workspace/service";
import { IpCharacterService } from "../workspace/ip-character";
import { PlaygroundService, inCurfew, sessionQuotaMinutes } from "./service";

const traced: TraceEvent[] = [];
let ctx: IdentityTestContext;
let svc: PlaygroundService;
let tenant: string;
let parentA: string;
let parentB: string;
let kidA: string;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };
/** 12:00 UTC = 20:00 Asia/Shanghai — safely outside the 21:00–06:00 curfew. */
const DAYTIME = () => new Date("2026-06-10T12:00:00Z");

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  svc = new PlaygroundService(ctx.sql, { record: (e) => traced.push(e) }, DAYTIME);
  tenant = await ctx.makeTenant("乐园租户");
  parentA = await ctx.makeParent(tenant);
  parentB = await ctx.makeParent(tenant);
  kidA = (await ctx.service.enrollStudent({ parentId: parentA, displayName: "乐园娃", age: 7, consent: CONSENT_V1 })).id;
  const workspace = new WorkspaceService(ctx.sql);
  const ip = new IpCharacterService(ctx.sql);
  // wall data: an iterating type (2 drafts) + a character version
  await workspace.recordWork({ studentId: kidA, type: "avatar_image", contentUrl: "fake://v1.png", metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false } });
  await workspace.recordWork({ studentId: kidA, type: "avatar_image", contentUrl: "fake://v2.png", metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false } });
  await ip.recordLessonOutcome(kidA, { name: "小泥", personality: "勇敢" }, { lessonId: "lesson-001", sessionId: "s1" });
});

describe("the unlock door (parent-surface.md v1.2 / agent-session.md token class)", () => {
  it("mints quota+grace TTL; resolve roundtrips; uniform null for unknown/malformed/expired", async () => {
    const minted = await svc.mintSession(parentA, kidA);
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // TTL anchors on DB NOW() (PGlite shares the process clock); the injected clock
    // only governs the curfew check.
    const ttlMin = (Date.parse(minted.expiresAt) - Date.now()) / 60000;
    expect(ttlMin).toBeGreaterThan(sessionQuotaMinutes(7) + 4); // 20 + 5 grace, minus runtime
    expect(ttlMin).toBeLessThanOrEqual(sessionQuotaMinutes(7) + 5);
    const session = await svc.resolveSession(minted.token);
    expect(session!.studentId).toBe(kidA);
    expect(await svc.resolveSession("A".repeat(43))).toBeNull();
    expect(await svc.resolveSession("short")).toBeNull();
  });

  it("MINT REVOKES the prior unexpired token — one active session per student (traced)", async () => {
    const first = await svc.mintSession(parentA, kidA);
    const second = await svc.mintSession(parentA, kidA);
    expect(await svc.resolveSession(first.token)).toBeNull(); // superseded — uniform null
    expect((await svc.resolveSession(second.token))!.studentId).toBe(kidA);
    expect(traced.some((e) => e.payload.reason === "playground_token_revoked_by_remint")).toBe(true);
  });

  it("cross-family mint is the uniform 404 (no oracle); curfew rejects with a countable trace", async () => {
    await expect(svc.mintSession(parentB, kidA)).rejects.toMatchObject({ code: "SHARE_NOT_FOUND" });
    const night = new PlaygroundService(ctx.sql, { record: (e) => traced.push(e) }, () => new Date("2026-06-10T14:00:00Z")); // 22:00 Shanghai
    await expect(night.mintSession(parentA, kidA)).rejects.toMatchObject({ kind: "curfew" }); // structural discriminant
    expect(traced.some((e) => e.payload.reason === "playground_mint_curfew_rejected")).toBe(true);
  });

  it("DAILY quota is mint-enforced (v1.1 interim): spent minutes reject with COMPANION_RESTING semantics", async () => {
    const kidB = (await ctx.service.enrollStudent({ parentId: parentA, displayName: "配额娃", age: 8, consent: CONSENT_V1 })).id;
    await svc.mintSession(parentA, kidB);
    // burn the day's quota: backdate the active token to quota-minutes ago
    await ctx.sql.query(
      `UPDATE playground_session_tokens SET created_at = NOW() - INTERVAL '30 minutes', expires_at = NOW() - INTERVAL '5 minutes' WHERE student_id = $1`,
      [kidB],
    );
    await expect(svc.mintSession(parentA, kidB)).rejects.toMatchObject({ kind: "daily_quota" });
    expect(traced.some((e) => e.payload.reason === "playground_mint_quota_exhausted")).toBe(true);
  });

  it("CLOSED trace taxonomy (agent-session.md v1.1): every emitted reason is in the contract set", () => {
    const CLOSED = new Set([
      "playground_floor_entered", "playground_quota_config_miss",
      "playground_session_opened", "playground_session_closed",
      "playground_token_revoked_by_remint", "playground_mint_curfew_rejected",
      "playground_mint_quota_exhausted",
    ]);
    const emitted = traced.map((e) => String(e.payload.reason)).filter((r) => r.startsWith("playground_"));
    expect(emitted.length).toBeGreaterThan(0);
    for (const r of emitted) expect(CLOSED.has(r), `out-of-contract trace reason: ${r}`).toBe(true);
  });

  it("curfew math: 21:00–06:00 Asia/Shanghai", () => {
    expect(inCurfew(new Date("2026-06-10T13:00:00Z"))).toBe(true); // 21:00
    expect(inCurfew(new Date("2026-06-10T21:00:00Z"))).toBe(true); // 05:00 next day
    expect(inCurfew(new Date("2026-06-10T22:30:00Z"))).toBe(false); // 06:30
    expect(inCurfew(new Date("2026-06-10T12:59:00Z"))).toBe(false); // 20:59
  });
});

describe("the v0 world view (world.md — read-only, gate ⑤)", () => {
  it("serves wall (latest-per-type final + replay slices), album (surface only), companion — no internal ids", async () => {
    const minted = await svc.mintSession(parentA, kidA);
    const session = await svc.resolveSession(minted.token);
    const world = await svc.worldView(session!.studentId, session!.expiresAt);
    expect(world.displayName).toBe("乐园娃");
    expect(world.companion).toMatchObject({ name: "小泥" });
    expect(world.wall).toHaveLength(1);
    expect(world.wall[0]!.final.contentUrl).toBe("fake://v2.png"); // latest by seq, not a draft
    expect(world.wall[0]!.slices.length).toBeGreaterThan(0); // 打磨轨迹 replayable
    expect(world.album).toHaveLength(1);
    expect(world.album[0]).toMatchObject({ version: 1, surface: { name: "小泥" } });
    expect(world.serverNow).toBe(DAYTIME().toISOString()); // the clock-anchor seam serves the injected now
    const json = JSON.stringify(world);
    expect(json).not.toContain(kidA); // studentId never on the wire
    expect(json).not.toContain("baseForm"); // base canon never serves
    expect(json).not.toMatch(/sessionId|stageId|aiParams|degraded/); // DENY extends
  });
});
