#!/usr/bin/env node
/**
 * Operator tool (Phase 3): mint a parent share link for a student's lesson and print it.
 *
 *   node tools/parent-link.mjs --student <uuid> [--lesson lesson-001]
 *
 * Operator-only posture (no auth until Phase 3+); requires the server running with
 * DATABASE_URL. Re-running mints a NEW link; older links keep working until expiry.
 *
 * The SERVER composes the capability URL (its WEB_BASE_URL is the single source of truth —
 * parent-share.md); WEB_URL here is an EXPLICIT override only, so the recovery path can
 * never print a wrong-origin link around a valid token.
 */
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const next = i > -1 ? process.argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : fallback;
}

const student = arg("student");
const lesson = arg("lesson", "lesson-001");
if (!student) {
  console.error("用法: node tools/parent-link.mjs --student <uuid> [--lesson lesson-001]");
  process.exit(1);
}

const res = await fetch(`${SERVER_URL}/students/${student}/share`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ lessonId: lesson }),
});
const text = await res.text();
if (!res.ok) throw new Error(`mint → ${res.status}: ${text}`);
const { token, expiresAt, url } = JSON.parse(text);
const link = process.env.WEB_URL ? `${process.env.WEB_URL}/?share=${token}` : url;
console.log(`📎 家长链接 (${lesson}，有效期至 ${expiresAt.slice(0, 10)}):`);
console.log(`   ${link}`);
