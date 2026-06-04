import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "./session/store";
import { buildHttp } from "./http";

describe("buildHttp", () => {
  it("POST /session/join creates the session and registers a student", async () => {
    const store = new InMemorySessionStore();
    const app = buildHttp(store, "lesson-001", "1.0.0", "intro");
    const res = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "r1" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { studentId: string; sessionId: string; role: string };
    expect(body.sessionId).toBe("r1");
    expect(body.role).toBe("student");
    const session = await store.load("r1");
    expect(session!.currentStageId).toBe("intro");
    expect(session!.students[body.studentId]).toBeDefined();
    await app.close();
  });

  it("stores the join name as displayName (for the 伙伴出生证)", async () => {
    const store = new InMemorySessionStore();
    const app = buildHttp(store, "lesson-001", "1.1.0", "intro");
    const res = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "r2", name: "  轩轩 " } });
    const body = res.json() as { studentId: string };
    const session = await store.load("r2");
    expect(session!.students[body.studentId]!.displayName).toBe("轩轩"); // trimmed
    await app.close();
  });

  it("POST /session/join registers an assistant when role=assistant", async () => {
    const store = new InMemorySessionStore();
    const app = buildHttp(store, "lesson-001", "1.0.0", "intro");
    const res = await app.inject({
      method: "POST",
      url: "/session/join",
      payload: { roomCode: "r3", role: "assistant" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { studentId: string; sessionId: string; role: string; assistantId?: string };
    expect(body.sessionId).toBe("r3");
    expect(body.role).toBe("assistant");
    expect(body.assistantId).toBeDefined();
    const session = await store.load("r3");
    expect(session!.assistants).toContain(body.assistantId);
    expect(session!.students[body.studentId]).toBeUndefined(); // assistant does not create student record
    await app.close();
  });

  it("POST /session/join does not duplicate assistant registration", async () => {
    const store = new InMemorySessionStore();
    const app = buildHttp(store, "lesson-001", "1.0.0", "intro");
    // first assistant joins
    const res1 = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "r4", role: "assistant" } });
    const body1 = res1.json() as { assistantId?: string };
    // second assistant joins
    const res2 = await app.inject({ method: "POST", url: "/session/join", payload: { roomCode: "r4", role: "assistant" } });
    const body2 = res2.json() as { assistantId?: string };
    const session = await store.load("r4");
    expect(session!.assistants).toHaveLength(2);
    expect(session!.assistants).toContain(body1.assistantId);
    expect(session!.assistants).toContain(body2.assistantId);
    await app.close();
  });

  it("GET /session/:id/state 404s for an unknown session", async () => {
    const app = buildHttp(new InMemorySessionStore(), "lesson-001", "1.0.0", "intro");
    const res = await app.inject({ method: "GET", url: "/session/nope/state" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
