#!/usr/bin/env node
/**
 * Admin enrollment tool (Phase 1) — enrolls a student via the Identity HTTP API and prints
 * the child's enrollment link for the classroom.
 *
 *   node tools/enroll-student.mjs --name 小美 --age 6 --phone +8613800001234 [--room demo-1]
 *
 * Requires the server running with DATABASE_URL (see demo-start.sh). The parent is
 * create-or-return (idempotent on phone): enrolling siblings reuses the same parent.
 * Operator-only tool — auth is Phase 3; do not expose the API to the internet (AGENTS.md).
 */
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
const DEMO_TENANT = "11111111-1111-4111-8111-111111111111"; // seeded demo tenant

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const next = i > -1 ? process.argv[i + 1] : undefined;
  // A following token that is itself a flag means the value is MISSING (fail usage, never
  // enroll "--age" as a child's name).
  return next && !next.startsWith("--") ? next : fallback;
}

const name = arg("name");
const age = Number(arg("age"));
const phone = arg("phone");
const tenantId = arg("tenant", DEMO_TENANT);
const room = arg("room");

if (!name || !Number.isInteger(age) || !phone) {
  console.error("用法: node tools/enroll-student.mjs --name 小美 --age 6 --phone +8613800001234 [--room demo-1] [--tenant <uuid>]");
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text(); // read first: a proxy 502 may not be JSON
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return { status: res.status, json: JSON.parse(text) };
}

const parent = await post("/parents", { tenantId, phoneNumber: phone });
console.log(`👤 家长: ${parent.json.parentId} ${parent.status === 200 ? "(已存在，复用)" : "(新建)"}`);

const student = await post("/students", {
  parentId: parent.json.parentId,
  displayName: name,
  age,
  consent: { consentVersion: "v1.0", dataRetentionAgreed: true },
});
console.log(`🧒 学生: ${student.json.displayName} (${student.json.age}岁) → ${student.json.id}`);
console.log("");
console.log("📎 报名链接（孩子的专属入口，可生成二维码）:");
console.log(`   ${WEB_URL}/?studentId=${student.json.id}${room ? `&room=${encodeURIComponent(room)}` : ""}`);
