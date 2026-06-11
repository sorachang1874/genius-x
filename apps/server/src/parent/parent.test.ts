/**
 * ParentSurfaceService — parent-surface.md pins: capability auth (uniform 404), family
 * scope (no cross-family oracle), surface-only timeline projection, and the co-working
 * v1 note lifecycle (reviewed → stored → injected ONCE → relayed). PGlite + 001-006.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { TraceEvent } from "@genius-x/contracts";
import { KeywordSafetyFilter } from "@genius-x/ai-gateway";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService } from "../workspace/service";
import { IpCharacterService } from "../workspace/ip-character";
import { ContextBuilder } from "../agent/context";
import { ParentSurfaceService } from "./service";

const traced: TraceEvent[] = [];
let ctx: IdentityTestContext;
let svc: ParentSurfaceService;
let workspace: WorkspaceService;
let ip: IpCharacterService;
let tenant: string;
let parentA: string;
let parentB: string;
let kidA: string;
let kidB: string;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  svc = new ParentSurfaceService(ctx.sql, new KeywordSafetyFilter(), { record: (e) => traced.push(e) });
  workspace = new WorkspaceService(ctx.sql);
  ip = new IpCharacterService(ctx.sql);
  tenant = await ctx.makeTenant("家长面租户");
  parentA = await ctx.makeParent(tenant);
  parentB = await ctx.makeParent(tenant);
  kidA = (await ctx.service.enrollStudent({ parentId: parentA, displayName: "家A娃", age: 7, consent: CONSENT_V1 })).id;
  kidB = (await ctx.service.enrollStudent({ parentId: parentB, displayName: "家B娃", age: 8, consent: CONSENT_V1 })).id;
  // kidA grows: a work + a character version with lineage
  const w = await workspace.recordWork({
    studentId: kidA, type: "avatar_image", contentUrl: "cos://a/v1.png",
    metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false },
  });
  await ip.recordLessonOutcome(kidA, { name: "小泥", personality: "勇敢", appearanceRef: w.id }, { lessonId: "lesson-001", sessionId: "s1" });
  await workspace.recordWork({
    studentId: kidA, type: "avatar_image", contentUrl: "cos://a/v1-art.png",
    metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false, ipCharacterVersion: 1 },
  });
});

describe("parent access tokens (the proven capability machinery, parent-scoped)", () => {
  it("mint → resolve roundtrip; hash-only storage; uniform null for unknown/expired/malformed", async () => {
    const minted = await svc.mintAccess(parentA);
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await ctx.sql.query("SELECT token_hash FROM parent_access_tokens");
    expect((stored.rows as { token_hash: string }[]).every((r) => r.token_hash !== minted.token)).toBe(true);
    expect((await svc.resolveParent(minted.token))!.parentId).toBe(parentA);
    expect(await svc.resolveParent("A".repeat(43))).toBeNull(); // unknown
    expect(await svc.resolveParent("short")).toBeNull(); // malformed — same null, no oracle
    await ctx.sql.query("UPDATE parent_access_tokens SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day'");
    expect(await svc.resolveParent(minted.token)).toBeNull(); // expired — same null
  });
});

describe("family scope + the growth timeline", () => {
  it("lists ONLY this parent's children, with the companion SURFACE", async () => {
    const children = await svc.listChildren(parentA);
    expect(children.map((c) => c.studentId)).toEqual([kidA]);
    expect(children[0]!.companion).toMatchObject({ name: "小泥", personality: "勇敢" });
  });

  it("timeline serves version entries (surface-only) with lineage works; cross-family = null (no oracle)", async () => {
    const t = await svc.timeline(parentA, kidA);
    expect(t!.entries).toHaveLength(1);
    expect(t!.entries[0]).toMatchObject({ version: 1, lessonId: "lesson-001" });
    expect(t!.entries[0]!.surface).toMatchObject({ name: "小泥" });
    expect(t!.entries[0]!.works.map((w) => w.contentUrl)).toEqual(["cos://a/v1-art.png"]); // lineage-stamped only
    expect(JSON.stringify(t)).not.toContain("baseForm"); // base_canon NEVER serves
    expect(JSON.stringify(t)).not.toContain("brandStyleVersion");
    expect(await svc.timeline(parentA, kidB)).toBeNull(); // someone else's child: uniform null
  });
});

describe("co-working v1: the parent note lifecycle", () => {
  it("reviewed → stored (traced) → injected with noteIds → marked → not re-injected", async () => {
    const { id: noteId } = await svc.addNote(parentA, kidA, { text: "妈妈为你骄傲，今天也要开心呀" });
    expect(traced.some((e) => e.payload.reason === "parent_note_stored" && e.payload.noteId === noteId)).toBe(true);
    const builder = new ContextBuilder(ctx.service, workspace, ip, { record: () => {} }, () => new Date().toISOString(), svc);
    const cold1 = await builder.buildCold("s1", kidA);
    expect(cold1!.text).toContain("【爸爸妈妈想对你说】");
    expect(cold1!.text).toContain("妈妈为你骄傲");
    // The BUILDER never marks (review fix): the note rides ColdContext.noteIds and the
    // CONTROLLER marks only after a non-degraded reply — a fallback answer leaves the
    // note unrelayed, so a second build re-injects it (retry-next-call semantics).
    expect(cold1!.noteIds).toEqual([noteId]);
    const coldRetry = await builder.buildCold("s1", kidA);
    expect(coldRetry!.text).toContain("妈妈为你骄傲"); // unmarked ⇒ still pending
    await svc.markRelayed(cold1!.noteIds); // what the controller does post-reply
    const cold2 = await builder.buildCold("s1", kidA);
    expect(cold2!.text).not.toContain("妈妈为你骄傲"); // exactly once
  });

  it("unsafe note text is NEVER stored (traced, text-free); pending notes are capped at 3", async () => {
    await expect(svc.addNote(parentA, kidA, { text: "给他讲点暴力的故事" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const cnt = await ctx.sql.query("SELECT COUNT(*)::int AS n FROM parent_notes WHERE note LIKE '%暴力%'");
    expect((cnt.rows[0] as { n: number }).n).toBe(0);
    // operator-visible rejection — and the trace NEVER carries the note text
    expect(traced.some((e) => e.payload.reason === "parent_note_rejected" && e.payload.cause === "safety_filtered")).toBe(true);
    expect(JSON.stringify(traced)).not.toContain("暴力");
    for (let i = 0; i < 3; i++) await svc.addNote(parentA, kidA, { text: `第${i}条鼓励` });
    await expect(svc.addNote(parentA, kidA, { text: "第四条" })).rejects.toMatchObject({ code: "INVALID_INPUT" }); // cap (in-INSERT guard)
    expect(traced.some((e) => e.payload.reason === "parent_note_rejected" && e.payload.cause === "pending_cap")).toBe(true);
    expect(JSON.stringify(traced)).not.toContain("第四条");
    await expect(svc.addNote(parentA, kidB, { text: "跨家庭" })).rejects.toMatchObject({ code: "SHARE_NOT_FOUND" }); // scope, uniform
  });
});
