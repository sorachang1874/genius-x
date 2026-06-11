/**
 * ShareService tests — capability lifecycle + the PRIVACY DENY LIST (the strictest
 * boundary in the system: an unauthenticated link must leak nothing beyond the artifact).
 * PGlite + migrations 001-003 via the production runner.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { newIdentityTestContext, type IdentityTestContext } from "../identity/identity.testutil";
import { WorkspaceService } from "../workspace/service";
import { LessonShareMinter, ShareService, ShareServiceError, type NotificationSink } from "./service";

let ctx: IdentityTestContext;
let share: ShareService;
let workspace: WorkspaceService;
let tenant: string;
let studentId: string;

const CONSENT_V1 = { consentVersion: "v1.0", dataRetentionAgreed: true };

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (err) {
    if (err instanceof ShareServiceError) return err.code;
    throw err;
  }
}

beforeAll(async () => {
  ctx = await newIdentityTestContext();
  share = new ShareService(ctx.sql);
  workspace = new WorkspaceService(ctx.sql);
  tenant = await ctx.makeTenant("分享租户");
  const parentId = await ctx.makeParent(tenant);
  studentId = (await ctx.service.enrollStudent({ parentId, displayName: "分享娃", age: 7, consent: CONSENT_V1 })).id;

  // A realistic lesson aftermath: certificate + avatar work (with operator metadata that
  // must NOT survive the filter) + an interaction (must not appear at all).
  await workspace.recordWork({
    studentId,
    type: "birth_certificate",
    contentJson: { studentName: "分享娃", avatarUrl: "fake://a.png", birthdaySpeech: "你好呀", memories: [{ label: "最喜欢的玩具", value: "积木" }] },
    metadata: { lessonId: "lesson-001", stageId: "birth", sessionId: "s-secret", aiParams: { promptVersion: "speech_v1" }, degraded: true },
  });
  await workspace.recordWork({
    studentId,
    type: "avatar_image",
    contentUrl: "fake://a.png",
    metadata: { lessonId: "lesson-001", stageId: "shape", sessionId: "s-secret", aiParams: { promptVersion: "image_v1" }, degraded: false },
  });
  await workspace.recordWork({
    studentId,
    type: "doodle",
    contentText: "其他课的作品",
    metadata: { lessonId: "lesson-999", stageId: "shape", degraded: false }, // OTHER lesson — must not leak
  });
  await workspace.recordInteraction({
    studentId,
    occurredAt: new Date().toISOString(),
    context: { lessonId: "lesson-001", stageId: "talent", sessionId: "s-secret", initiatedBy: "student" },
    input: { kind: "voice", contentRef: "ref://raw", text: "孩子说的悄悄话" },
    output: { kind: "text", text: "回应", degraded: false },
  });
});

describe("capability lifecycle", () => {
  it("mint → view roundtrip; the raw token is 43-char base64url and never stored", async () => {
    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-001" });
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await ctx.sql.query("SELECT token_hash FROM share_tokens");
    expect((stored.rows as { token_hash: string }[]).every((r) => r.token_hash !== minted.token)).toBe(true); // hash only

    const view = await share.getShareView(minted.token);
    expect(view.studentDisplayName).toBe("分享娃");
    expect(view.lessonId).toBe("lesson-001");
    expect(view.certificate).toMatchObject({ studentName: "分享娃", birthdaySpeech: "你好呀" });
    expect(view.works).toHaveLength(1); // avatar only: certificate not repeated, other-lesson work excluded
    expect(view.works[0]).toMatchObject({ type: "avatar_image", contentUrl: "fake://a.png" });
    expect(Date.parse(view.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("UNIFORM 404: unknown and EXPIRED tokens are indistinguishable; malformed → 400", async () => {
    const unknown = "A".repeat(43);
    expect(await code(share.getShareView(unknown))).toBe("SHARE_NOT_FOUND");

    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-001" });
    await ctx.sql.query("UPDATE share_tokens SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day' WHERE student_id = $1", [studentId]); // backdate BOTH (expiry-sane CHECK)
    expect(await code(share.getShareView(minted.token))).toBe("SHARE_NOT_FOUND"); // same code as unknown

    expect(await code(share.getShareView("short")) ).toBe("INVALID_INPUT");
    expect(await code(share.getShareView("!".repeat(43)))).toBe("INVALID_INPUT");
  });

  it("re-mint issues a NEW token while earlier ones keep serving until their expiry", async () => {
    const first = await share.mintShareToken({ studentId, lessonId: "lesson-001" });
    const second = await share.mintShareToken({ studentId, lessonId: "lesson-001" });
    expect(second.token).not.toBe(first.token);
    expect((await share.getShareView(first.token)).studentDisplayName).toBe("分享娃");
    expect((await share.getShareView(second.token)).studentDisplayName).toBe("分享娃");
  });

  it("mint rejects unknown students and malformed input", async () => {
    expect(await code(share.mintShareToken({ studentId: "99999999-9999-4999-8999-999999999970", lessonId: "lesson-001" }))).toBe("INVALID_INPUT");
    expect(await code(share.mintShareToken({ studentId, lessonId: "  " }))).toBe("INVALID_INPUT");
  });
});

describe("PRIVACY DENY LIST (serialization-pinned)", () => {
  it("the served JSON contains NONE of the denied keys", async () => {
    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-001" });
    const view = await share.getShareView(minted.token);
    const json = JSON.stringify(view);
    for (const denied of ["aiParams", "degraded", "sessionId", "stageId", "studentId", "tenantId", "parentId", "\"id\"", "contentRef", "transcript", "s-secret", "悄悄话", "interactions"]) {
      expect(json).not.toContain(denied);
    }
    // and what SHOULD be there, is:
    expect(json).toContain("studentDisplayName");
    expect(json).toContain("最喜欢的玩具");
  });
});

describe("LessonShareMinter (the controller's surface)", () => {
  const MINT = { studentId: "", studentDisplayName: "分享娃", lessonId: "lesson-001", hasArtifacts: true };

  it("mints + notifies with the capability URL + operator ids; sink failures are swallowed", async () => {
    const sent: { studentId: string; url: string; hasArtifacts: boolean }[] = [];
    const sink: NotificationSink = { lessonShareReady: (info) => { sent.push(info); } };
    const minter = new LessonShareMinter(share, sink, "http://web.test");
    await minter.mintAndNotify({ ...MINT, studentId });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toMatch(/^http:\/\/web\.test\/\?share=[A-Za-z0-9_-]{43}$/);
    expect(sent[0]!.studentId).toBe(studentId); // operator surface: id allowed, disambiguates interleaved links
    expect(sent[0]!.hasArtifacts).toBe(true);
    const token = new URL(sent[0]!.url).searchParams.get("share")!;
    expect((await share.getShareView(token)).lessonId).toBe("lesson-001"); // the link WORKS

    const throwing: NotificationSink = { lessonShareReady: () => { throw new Error("sink down"); } };
    const minter2 = new LessonShareMinter(share, throwing, "http://web.test");
    await expect(minter2.mintAndNotify({ ...MINT, studentId })).resolves.toBeUndefined(); // never propagates
  });

  it("an ASYNC-rejecting sink (the WeChat shape) is swallowed too — never an unhandledRejection", async () => {
    // Node's default since v15 kills the process on unhandledRejection: a rejecting async
    // sink escaping mintAndNotify would take the server down mid-class (sink down ⇒
    // classroom unaffected is the contract). Capture the channel to prove nothing escapes.
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { escaped.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const rejecting: NotificationSink = { lessonShareReady: async () => { throw new Error("wechat sink down"); } };
      const minter = new LessonShareMinter(share, rejecting, "http://web.test");
      await expect(minter.mintAndNotify({ ...MINT, studentId })).resolves.toBeUndefined();
      await new Promise((r) => setImmediate(r)); // drain the microtask queue
      expect(escaped).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("review round-1 mandates (Phase 3 security review)", () => {
  it("the certificate survives 20+ NEWER works (independent query — no recency window on the hero)", async () => {
    // Works accumulate per (student, lesson) across re-run sessions; the hero certificate
    // must come from its own query, not from within the gallery's LIMIT-20 window.
    const parentId = await ctx.makeParent(tenant);
    const kid = (await ctx.service.enrollStudent({ parentId, displayName: "窗口娃", age: 7, consent: CONSENT_V1 })).id;
    await workspace.recordWork({
      studentId: kid,
      type: "birth_certificate",
      contentJson: { studentName: "窗口娃", birthdaySpeech: "我在这" },
      metadata: { lessonId: "lesson-001", stageId: "birth", degraded: false },
    });
    await ctx.sql.query("UPDATE works SET created_at = NOW() - INTERVAL '1 hour' WHERE student_id = $1", [kid]);
    for (let i = 0; i < 21; i++) {
      await workspace.recordWork({
        studentId: kid,
        type: "doodle",
        contentText: `涂鸦 ${i}`,
        metadata: { lessonId: "lesson-001", stageId: "shape", degraded: false },
      });
    }
    const minted = await share.mintShareToken({ studentId: kid, lessonId: "lesson-001" });
    const view = await share.getShareView(minted.token);
    expect(view.certificate).toMatchObject({ studentName: "窗口娃" }); // hero present despite 21 newer works
    // v1.3 CURATION (decision ②): the gallery is the LATEST work per type, drafts
    // collapse into the sampled 打磨轨迹 — never a wall of 21 near-duplicates.
    expect(view.works).toHaveLength(1);
    expect(view.works[0]!.contentText).toBe("涂鸦 20"); // the final
    expect(view.iterations).toHaveLength(1);
    expect(view.iterations![0]).toMatchObject({ type: "doodle", total: 21 });
    expect(view.iterations![0]!.slices).toHaveLength(4); // evenly sampled, oldest→newest
    expect(view.iterations![0]!.slices[0]!.contentText).toBe("涂鸦 0"); // first kept
    expect(view.iterations![0]!.slices[3]!.contentText).toBe("涂鸦 20"); // last kept
  });

  it("served contentJson is deep-scrubbed of DENIED keys (defense-in-depth on writer discipline)", async () => {
    await workspace.recordWork({
      studentId,
      type: "doodle",
      contentJson: { note: "干净字段", sessionId: "leak-1", nested: { aiParams: { promptVersion: "x" }, keep: "ok" } },
      metadata: { lessonId: "lesson-scrub", stageId: "shape", degraded: false },
    });
    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-scrub" });
    const view = await share.getShareView(minted.token);
    const json = JSON.stringify(view);
    expect(json).toContain("干净字段");
    expect(json).toContain("keep");
    expect(json).not.toContain("sessionId");
    expect(json).not.toContain("aiParams");
  });

  it("PINNED GAP: internal ids inside URL VALUES pass through verbatim (preflight binds Agent J)", async () => {
    // The scrub covers JSON KEYS; a content pipeline keying object paths by student id
    // would hand it to parents. parent-share.md's URL-value preflight is the enforcement —
    // this pin makes the gap visible instead of letting a green deny-test imply otherwise.
    await workspace.recordWork({
      studentId,
      type: "doodle",
      contentUrl: `cos://bucket/${studentId}/art.png`,
      metadata: { lessonId: "lesson-urlpin", stageId: "shape", degraded: false },
    });
    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-urlpin" });
    const json = JSON.stringify(await share.getShareView(minted.token));
    expect(json).toContain(studentId); // current behavior — remove this pin when a URL-value scrub lands
  });

  it("purgeExpired deletes only tokens past expiry+30d (retention contract), counted", async () => {
    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-purge" });
    await ctx.sql.query(
      "UPDATE share_tokens SET created_at = NOW() - INTERVAL '200 days', expires_at = NOW() - INTERVAL '31 days' WHERE lesson_id = 'lesson-purge'",
    );
    const purged = await share.purgeExpired();
    expect(purged).toBe(1); // ONLY the 31-days-past-expiry token; expired-but-within-30d rows stay
    expect(await code(share.getShareView(minted.token))).toBe("SHARE_NOT_FOUND");
    const remaining = await ctx.sql.query("SELECT COUNT(*)::int AS n FROM share_tokens WHERE lesson_id = 'lesson-purge'");
    expect((remaining.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("v1.3 curation hardening (P4.5-A review)", () => {
  it("DENY scrub covers iteration SLICES (a denied key in a non-final draft never leaks)", async () => {
    await workspace.recordWork({
      studentId,
      type: "doodle",
      contentJson: { note: "草稿", sessionId: "slice-leak-secret" }, // denied key in a DRAFT
      metadata: { lessonId: "lesson-scrub", stageId: "shape", degraded: false },
    });
    // lesson-scrub now has 2 doodles → the first becomes a SLICE, not the final
    const minted = await share.mintShareToken({ studentId, lessonId: "lesson-scrub" });
    const view = await share.getShareView(minted.token);
    expect(view.iterations).toBeDefined();
    const json = JSON.stringify(view);
    expect(json).not.toContain("sessionId");
    expect(json).not.toContain("slice-leak-secret");
  });
});
