#!/usr/bin/env node
/**
 * Minimal Shape→Talent transition test
 * Isolates the guard evaluation issue
 */

import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3000";
const ROOM_CODE = "TEST" + Date.now();

async function test() {
  console.log("🧪 Testing Shape→Talent transition...\n");

  // 1. Create session
  const joinRes = await fetch(`${SERVER_URL}/session/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomCode: ROOM_CODE, role: "assistant" }),
  });
  const { sessionId, assistantId } = await joinRes.json();
  console.log(`✓ Session created: ${sessionId}`);

  // 2. Add student
  const studentRes = await fetch(`${SERVER_URL}/session/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Phase 1: persistent studentId from the seeded demo students (DATABASE_URL + migrate:seed required).
    body: JSON.stringify({ roomCode: ROOM_CODE, role: "student", studentId: "33333333-3333-4333-8333-000000000001" }),
  });
  const { studentId } = await studentRes.json();
  console.log(`✓ Student joined: ${studentId}`);

  // 3. Connect sockets
  const assistant = io(SERVER_URL, {
    auth: { sessionId, assistantId },
    transports: ["websocket"],
  });
  const student = io(SERVER_URL, {
    auth: { sessionId, studentId },
    transports: ["websocket"],
  });

  await new Promise((resolve) => {
    let count = 0;
    const check = () => {
      count++;
      if (count === 2) resolve();
    };
    assistant.on("connect", check);
    student.on("connect", check);
  });

  assistant.emit("client_message", { type: "HELLO", assistantId });
  student.emit("client_message", { type: "HELLO", studentId });

  await new Promise((r) => setTimeout(r, 200));
  console.log("✓ Sockets connected\n");

  // 4. Advance to shape
  console.log("Advancing intro → icebreak → shape...");
  assistant.emit("client_message", { type: "ASSISTANT_UNLOCK", stageId: "icebreak", assistantId });
  await new Promise((r) => setTimeout(r, 100));
  assistant.emit("client_message", { type: "ASSISTANT_UNLOCK", stageId: "shape", assistantId });
  await new Promise((r) => setTimeout(r, 200));

  let state = await fetch(`${SERVER_URL}/session/${sessionId}/state`).then((r) => r.json());
  console.log(`Current stage: ${state.currentStageId}`);
  console.log(`Student outputs: ${JSON.stringify(state.students[studentId].outputs)}\n`);

  // 5. Complete shape
  console.log("Student completing shape stage...");
  student.emit("client_message", {
    type: "STAGE_COMPLETE",
    studentId,
    stageId: "shape",
    payload: {
      kind: "selection",
      output: "avatarUrl",
      value: "https://example.com/test-avatar.png",
    },
  });

  await new Promise((r) => setTimeout(r, 300));

  state = await fetch(`${SERVER_URL}/session/${sessionId}/state`).then((r) => r.json());
  const s = state.students[studentId];
  console.log(`✓ STAGE_COMPLETE sent`);
  console.log(`  Current stage: ${state.currentStageId}`);
  console.log(`  Student outputs: ${JSON.stringify(s.outputs)}`);
  console.log(`  Shape status: ${s.stageStatus.shape || "undefined"}`);
  console.log(`  avatarUrl set: ${s.outputs.avatarUrl !== undefined}\n`);

  // 6. Try to advance to talent
  console.log("Assistant attempting to unlock talent...");
  assistant.emit("client_message", {
    type: "ASSISTANT_UNLOCK",
    stageId: "talent",
    assistantId,
  });

  await new Promise((r) => setTimeout(r, 500));

  state = await fetch(`${SERVER_URL}/session/${sessionId}/state`).then((r) => r.json());
  console.log(`Current stage after ASSISTANT_UNLOCK: ${state.currentStageId}`);

  if (state.currentStageId === "talent") {
    console.log("\n✅ SUCCESS: Shape→Talent transition worked!");
  } else {
    console.log("\n❌ FAILED: Still on shape stage");
    console.log("Check server logs for STAGE_TRANSITION_DENIED");
  }

  assistant.disconnect();
  student.disconnect();
  process.exit(state.currentStageId === "talent" ? 0 : 1);
}

test().catch((err) => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
