#!/usr/bin/env node
/**
 * Demo E2E Test Script
 *
 * Simulates a complete Lesson 1 flow:
 * 1. Assistant creates classroom
 * 2. Student joins via room code
 * 3. Walks through all stages (intro → closure)
 * 4. Records timing and response quality
 */

import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const ROOM_CODE = "DEMO" + Date.now();

// ANSI colors for console output
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

async function joinSession(roomCode, role = "student", name) {
  const res = await fetch(`${SERVER_URL}/session/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomCode, role, name }),
  });
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
  log("START", "🚀 Starting Demo E2E Test", colors.cyan);
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
    log("INFO", `  Session ID: ${assistantJoin.sessionId}`, colors.blue);
    log("INFO", `  Assistant ID: ${assistantJoin.assistantId}`, colors.blue);

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
      log("WS:ASSISTANT", `← ${msg.type}`, colors.magenta);
    });

    // Send HELLO
    assistantSocket.emit("client_message", {
      type: "HELLO",
      assistantId: assistantJoin.assistantId,
    });

    const assistantResume = await waitFor(() =>
      assistantMessages.find((m) => m.type === "RESUME_STATE")
    );
    log("SUCCESS", `Assistant connected, current stage: ${assistantResume.currentStageId}`, colors.green);

    // Step 3: Student joins
    log("STEP", "3️⃣  Student joins classroom", colors.yellow);
    const startStudent = Date.now();
    const studentJoin = await joinSession(ROOM_CODE, "student", "小明");
    timings.studentJoin = Date.now() - startStudent;
    log("SUCCESS", `Student joined (${timings.studentJoin}ms)`, colors.green);
    log("INFO", `  Student ID: ${studentJoin.studentId}`, colors.blue);

    // Step 4: Connect student socket
    log("STEP", "4️⃣  Connect student WebSocket", colors.yellow);
    const studentSocket = await connectSocket(
      studentJoin.sessionId,
      studentJoin.studentId
    );
    const studentMessages = [];
    studentSocket.on("server_message", (msg) => {
      studentMessages.push(msg);
      log("WS:STUDENT", `← ${msg.type}`, colors.cyan);
    });

    studentSocket.emit("client_message", {
      type: "HELLO",
      studentId: studentJoin.studentId,
    });

    const studentResume = await waitFor(() =>
      studentMessages.find((m) => m.type === "RESUME_STATE")
    );
    log("SUCCESS", `Student connected, current stage: ${studentResume.currentStageId}`, colors.green);

    // Step 5: Walk through stages
    log("STEP", "5️⃣  Walking through lesson stages", colors.yellow);

    // Helper: wait for STAGE_UNLOCK
    const waitUnlock = (stageId) => {
      log("ACTION", `Waiting for ${stageId} unlock...`, colors.blue);
      return waitFor(() =>
        assistantMessages.find((m) => m.type === "STAGE_UNLOCK" && m.stageId === stageId)
      );
    };

    // Intro → Icebreak
    log("STAGE", "📢 Intro stage", colors.yellow);
    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "icebreak",
      assistantId: assistantJoin.assistantId,
    });
    await waitUnlock("icebreak");
    log("SUCCESS", "✓ Icebreak unlocked", colors.green);

    // Icebreak → Shape
    log("STAGE", "🎤 Icebreak stage", colors.yellow);
    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "shape",
      assistantId: assistantJoin.assistantId,
    });
    await waitUnlock("shape");
    log("SUCCESS", "✓ Shape unlocked", colors.green);

    // Shape → Talent (requires STAGE_COMPLETE)
    log("STAGE", "🎨 Shape stage", colors.yellow);

    // Wait a bit to ensure stage is fully initialized
    await new Promise(resolve => setTimeout(resolve, 200));

    studentSocket.emit("client_message", {
      type: "STAGE_COMPLETE",
      studentId: studentJoin.studentId,
      stageId: "shape",
      payload: {
        kind: "selection",
        output: "avatarUrl",
        value: "https://example.com/avatar.png",
      },
    });
    log("ACTION", "Student completed shape stage (sent STAGE_COMPLETE)", colors.blue);

    // Wait for completion to be processed
    await new Promise(resolve => setTimeout(resolve, 300));

    // Check session state via API
    const sessionStateRes = await fetch(`${SERVER_URL}/session/${studentJoin.sessionId}/state`);
    const sessionState = await sessionStateRes.json();
    log("DEBUG", `Session state after STAGE_COMPLETE:`, colors.magenta);
    log("DEBUG", `  Current stage: ${sessionState.currentStageId}`, colors.magenta);
    const student = sessionState.students[studentJoin.studentId];
    if (student) {
      log("DEBUG", `  Student outputs: ${JSON.stringify(student.outputs)}`, colors.magenta);
      log("DEBUG", `  Shape status: ${student.stageStatus.shape || 'undefined'}`, colors.magenta);
    }

    assistantSocket.emit("client_message", {
      type: "ASSISTANT_UNLOCK",
      stageId: "talent",
      assistantId: assistantJoin.assistantId,
    });
    log("ACTION", "Sent ASSISTANT_UNLOCK for talent", colors.blue);
    await waitUnlock("talent");
    log("SUCCESS", "✓ Talent unlocked", colors.green);

    // Talent → Birth (FORCE_ADVANCE for MVP)
    log("STAGE", "🎭 Talent stage", colors.yellow);
    log("ACTION", "Using FORCE_ADVANCE to skip AI interaction (MVP)", colors.blue);
    assistantSocket.emit("client_message", {
      type: "FORCE_ADVANCE",
      stageId: "birth",
      assistantId: assistantJoin.assistantId,
    });
    await waitUnlock("birth");
    log("SUCCESS", "✓ Birth unlocked", colors.green);

    // Birth → Closure
    log("STAGE", "🎂 Birth stage", colors.yellow);
    studentSocket.emit("client_message", {
      type: "STAGE_COMPLETE",
      studentId: studentJoin.studentId,
      stageId: "birth",
      payload: { kind: "done" },
    });
    log("ACTION", "Student completed birth stage", colors.blue);

    assistantSocket.emit("client_message", {
      type: "TEACHER_UNLOCK",
      stageId: "closure",
    });
    await waitUnlock("closure");
    log("SUCCESS", "✓ Closure unlocked", colors.green);

    log("STAGE", "🎉 Closure stage", colors.yellow);

    // Test reconnect
    log("STEP", "6️⃣  Testing reconnect", colors.yellow);
    studentSocket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const studentSocket2 = await connectSocket(
      studentJoin.sessionId,
      studentJoin.studentId
    );
    const reconnectMessages = [];
    studentSocket2.on("server_message", (msg) => reconnectMessages.push(msg));

    studentSocket2.emit("client_message", {
      type: "HELLO",
      studentId: studentJoin.studentId,
    });

    const reconnectResume = await waitFor(() =>
      reconnectMessages.find((m) => m.type === "RESUME_STATE")
    );

    if (reconnectResume.currentStageId === "closure") {
      log("SUCCESS", "✓ Reconnect successful, state preserved", colors.green);
    } else {
      issues.push({
        severity: "P0",
        title: "Reconnect state mismatch",
        expected: "closure",
        actual: reconnectResume.currentStageId,
      });
      log("ERROR", `✗ Reconnect failed: expected closure, got ${reconnectResume.currentStageId}`, colors.red);
    }

    // Cleanup
    assistantSocket.disconnect();
    studentSocket2.disconnect();

    // Summary
    console.log("\n" + "=".repeat(60));
    log("SUMMARY", "📊 Test Results", colors.cyan);
    console.log("=".repeat(60));

    log("TIMING", `Assistant join: ${timings.assistantJoin}ms`, colors.blue);
    log("TIMING", `Student join: ${timings.studentJoin}ms`, colors.blue);

    if (issues.length === 0) {
      log("RESULT", "✅ All tests passed!", colors.green);
    } else {
      log("RESULT", `⚠️  Found ${issues.length} issue(s)`, colors.yellow);
      issues.forEach((issue, i) => {
        console.log(`\n${i + 1}. [${issue.severity}] ${issue.title}`);
        console.log(`   Expected: ${issue.expected}`);
        console.log(`   Actual: ${issue.actual}`);
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
