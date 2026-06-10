#!/usr/bin/env node
/**
 * Multi-Student E2E Test Script
 *
 * Tests concurrent classroom behavior:
 * 1. Assistant creates classroom
 * 2. Multiple students (2-3) join simultaneously
 * 3. Verify state synchronization across all students
 * 4. Test stage advance conditions with multiple students
 */

import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const ROOM_CODE = "MULTI" + Date.now();
const NUM_STUDENTS = 3;

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(prefix, message, color = colors.reset) {
  console.log(`${color}[${prefix}]${colors.reset} ${message}`);
}

function waitFor(check, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const result = check();
      if (result !== undefined) {
        clearInterval(interval);
        resolve(result);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }
    }, 50);
  });
}

// Phase 1: students join with PERSISTENT studentIds from enrollment (the seeded demo
// students; server must run with DATABASE_URL + migrate:seed). 4 are seeded; we use 3.
const SEEDED_STUDENTS = [
  { id: "33333333-3333-4333-8333-000000000001", name: "小明" },
  { id: "33333333-3333-4333-8333-000000000002", name: "朵朵" },
  { id: "33333333-3333-4333-8333-000000000003", name: "轩轩" },
];

async function joinSession(roomCode, role = "student", studentId) {
  const res = await fetch(`${SERVER_URL}/session/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomCode, role, ...(studentId && { studentId }) }),
  });
  if (!res.ok) {
    throw new Error(`join failed (${res.status}): ${await res.text()} — is the server running with DATABASE_URL + migrate:seed applied?`);
  }
  return res.json();
}

function connectSocket(sessionId, studentId, assistantId) {
  const auth = assistantId
    ? { sessionId, assistantId }
    : { sessionId, studentId };

  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      auth,
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });

    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

async function main() {
  log("START", `🚀 Starting Multi-Student E2E Test (${NUM_STUDENTS} students)`, colors.cyan);
  log("CONFIG", `Server: ${SERVER_URL}`, colors.blue);
  log("CONFIG", `Room Code: ${ROOM_CODE}`, colors.blue);

  const issues = [];
  const timings = {};

  try {
    // Step 1: Assistant joins
    log("STEP", "1️⃣  Assistant creates classroom", colors.yellow);
    const startAssistant = Date.now();
    const assistantJoin = await joinSession(ROOM_CODE, "assistant");
    timings.assistantJoin = Date.now() - startAssistant;
    log("SUCCESS", `Assistant joined (${timings.assistantJoin}ms)`, colors.green);

    // Step 2: Connect assistant socket
    log("STEP", "2️⃣  Connect assistant WebSocket", colors.yellow);
    const assistantSocket = await connectSocket(
      assistantJoin.sessionId,
      undefined,
      assistantJoin.assistantId
    );
    const assistantMessages = [];
    assistantSocket.on("server_message", (msg) => {
      assistantMessages.push(msg);
      if (msg.type !== "RESUME_STATE") {
        log("WS:ASSISTANT", `← ${msg.type}`, colors.magenta);
      }
    });

    assistantSocket.emit("client_message", {
      type: "HELLO",
      assistantId: assistantJoin.assistantId,
    });

    await waitFor(() => assistantMessages.find((m) => m.type === "RESUME_STATE"));
    log("SUCCESS", "Assistant connected", colors.green);

    // Step 3: Multiple students join concurrently
    log("STEP", `3️⃣  ${NUM_STUDENTS} students join concurrently`, colors.yellow);
    // Names come from the enrolled profiles now (server ignores client names).

    const studentJoinPromises = SEEDED_STUDENTS.slice(0, NUM_STUDENTS).map((_seed, i) =>
      joinSession(ROOM_CODE, "student", SEEDED_STUDENTS[i].id).then(result => ({ ...result, name: SEEDED_STUDENTS[i].name, index: i }))
    );

    const startJoin = Date.now();
    const students = await Promise.all(studentJoinPromises);
    timings.concurrentJoin = Date.now() - startJoin;

    log("SUCCESS", `All ${NUM_STUDENTS} students joined (${timings.concurrentJoin}ms)`, colors.green);
    students.forEach((s, i) => {
      log("INFO", `  Student ${i + 1}: ${s.name} (${s.studentId})`, colors.blue);
    });

    // Step 4: Connect all student sockets
    log("STEP", "4️⃣  Connect all student WebSockets", colors.yellow);

    const studentConnections = await Promise.all(
      students.map(async (s) => {
        const socket = await connectSocket(s.sessionId, s.studentId);
        const messages = [];

        socket.on("server_message", (msg) => {
          messages.push(msg);
          if (msg.type === "STAGE_UNLOCK") {
            log(`WS:${s.name}`, `← ${msg.type}: ${msg.stageId}`, colors.cyan);
          }
        });

        socket.emit("client_message", {
          type: "HELLO",
          studentId: s.studentId,
        });

        const resume = await waitFor(() => messages.find((m) => m.type === "RESUME_STATE"));

        return {
          student: s,
          socket,
          messages,
          currentStage: resume.currentStageId,
        };
      })
    );

    log("SUCCESS", `All ${NUM_STUDENTS} students connected`, colors.green);

    // Verify all students see the same initial stage
    const stages = studentConnections.map((c) => c.currentStage);
    const allSame = stages.every((s) => s === stages[0]);
    if (allSame) {
      log("VERIFY", `✓ All students see stage: ${stages[0]}`, colors.green);
    } else {
      issues.push({
        severity: "P0",
        title: "Stage synchronization failed on connect",
        details: `Different stages: ${stages.join(", ")}`,
      });
      log("ERROR", `✗ Stage mismatch: ${stages.join(", ")}`, colors.red);
    }

    // Step 5: Test stage transitions
    log("STEP", "5️⃣  Test stage transitions with multiple students", colors.yellow);

    // Unlock icebreak
    log("ACTION", "Assistant unlocks icebreak", colors.blue);
    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "icebreak",
      assistantId: assistantJoin.assistantId,
    });

    // All students should receive STAGE_UNLOCK
    await Promise.all(
      studentConnections.map((c) =>
        waitFor(() => c.messages.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "icebreak"))
      )
    );
    log("VERIFY", "✓ All students received icebreak unlock", colors.green);

    // Unlock shape
    log("ACTION", "Assistant unlocks shape", colors.blue);
    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "shape",
      assistantId: assistantJoin.assistantId,
    });

    await Promise.all(
      studentConnections.map((c) =>
        waitFor(() => c.messages.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "shape"))
      )
    );
    log("VERIFY", "✓ All students received shape unlock", colors.green);

    // Step 6: Test advance condition (allStudents.outputSet)
    log("STEP", "6️⃣  Test advance condition: allStudents.outputSet", colors.yellow);
    log("INFO", "Shape → Talent requires all students to complete avatarUrl", colors.blue);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Only SOME students complete first
    const firstStudent = studentConnections[0];
    log("ACTION", `${firstStudent.student.name} completes shape`, colors.blue);
    firstStudent.socket.emit("client_message", {
      type: "STAGE_COMPLETE",
      studentId: firstStudent.student.studentId,
      stageId: "shape",
      payload: {
        kind: "selection",
        output: "avatarUrl",
        value: "https://example.com/avatar1.png",
      },
    });

    await new Promise(resolve => setTimeout(resolve, 300));

    // Try to unlock talent (should fail because not all students completed)
    log("ACTION", "Assistant tries to unlock talent (should be blocked)", colors.blue);
    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "talent",
      assistantId: assistantJoin.assistantId,
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if talent was unlocked (it shouldn't be)
    const talentUnlocked = assistantMessages.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "talent");
    if (talentUnlocked) {
      issues.push({
        severity: "P0",
        title: "Advance condition violated",
        details: "Talent unlocked before all students completed shape",
      });
      log("ERROR", "✗ Advance condition violated: talent unlocked too early", colors.red);
    } else {
      log("VERIFY", "✓ Advance condition working: talent blocked", colors.green);
    }

    // Now ALL students complete
    log("ACTION", "All remaining students complete shape", colors.blue);
    await Promise.all(
      studentConnections.slice(1).map((c, i) => {
        c.socket.emit("client_message", {
          type: "STAGE_COMPLETE",
          studentId: c.student.studentId,
          stageId: "shape",
          payload: {
            kind: "selection",
            output: "avatarUrl",
            value: `https://example.com/avatar${i + 2}.png`,
          },
        });
        return new Promise(resolve => setTimeout(resolve, 100));
      })
    );

    await new Promise(resolve => setTimeout(resolve, 300));

    // Try to unlock talent again (should succeed now)
    log("ACTION", "Assistant tries to unlock talent again (should succeed)", colors.blue);
    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "talent",
      assistantId: assistantJoin.assistantId,
    });

    await waitFor(() =>
      assistantMessages.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "talent")
    );
    log("VERIFY", "✓ Advance condition satisfied: talent unlocked", colors.green);

    // Verify all students received the unlock
    await Promise.all(
      studentConnections.map((c) =>
        waitFor(() => c.messages.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === "talent"))
      )
    );
    log("VERIFY", "✓ All students received talent unlock", colors.green);

    // Cleanup
    assistantSocket.disconnect();
    studentConnections.forEach((c) => c.socket.disconnect());

    // Summary
    console.log("\n" + "=".repeat(60));
    log("SUMMARY", "📊 Multi-Student Test Results", colors.cyan);
    console.log("=".repeat(60));

    log("TIMING", `Assistant join: ${timings.assistantJoin}ms`, colors.blue);
    log("TIMING", `${NUM_STUDENTS} concurrent joins: ${timings.concurrentJoin}ms`, colors.blue);
    log("TIMING", `Avg per student: ${Math.round(timings.concurrentJoin / NUM_STUDENTS)}ms`, colors.blue);

    if (issues.length === 0) {
      log("RESULT", "✅ All multi-student tests passed!", colors.green);
    } else {
      log("RESULT", `⚠️  Found ${issues.length} issue(s)`, colors.yellow);
      issues.forEach((issue, i) => {
        console.log(`\n${i + 1}. [${issue.severity}] ${issue.title}`);
        console.log(`   ${issue.details}`);
      });
    }

    console.log("=".repeat(60) + "\n");

    process.exit(issues.filter((i) => i.severity === "P0").length > 0 ? 1 : 0);

  } catch (error) {
    log("ERROR", `❌ Test failed: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

main();
