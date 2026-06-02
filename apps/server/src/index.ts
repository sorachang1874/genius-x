/**
 * @genius-x/server bootstrap (composition root). Wires config → validated lesson → store →
 * controller → Fastify(HTTP) + Socket.IO. No business logic here. Covered by E-M1 smoke.
 */
import { Server } from "socket.io";
import type { TraceEvent } from "@genius-x/contracts";
import { loadConfig } from "@genius-x/config";
import { lesson001 } from "@genius-x/course-config";
import { makeReducer } from "./engine";
import { validateLessonConfig } from "./engine/validate";
import { InMemorySessionStore } from "./session/store";
import { ClassroomController, type Clock, type TraceSink } from "./sync/controller";
import { attachSocket, ioEmitter } from "./sync/socket";
import { buildHttp } from "./http";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const validated = validateLessonConfig(lesson001);
  if (!validated.ok) {
    console.error("Invalid lesson config — failing closed:", validated.errors);
    process.exit(1);
  }
  const lesson = validated.lesson;
  const firstStageId = lesson.stages[0]!.stageId;

  // In-memory in local/scripted; RedisSessionStore is wired for live/production later.
  const store = new InMemorySessionStore();
  const trace: TraceSink = { record: (e: TraceEvent) => console.log("[trace]", e.kind, e.payload) };
  const clock: Clock = { now: () => new Date().toISOString() };

  const app = buildHttp(store, lesson.lessonId, lesson.lessonConfigVersion, firstStageId);
  await app.ready();

  const io = new Server(app.server, { cors: { origin: "*" } });
  const controller = new ClassroomController(lesson, makeReducer(lesson), store, ioEmitter(io), trace, clock);
  attachSocket(io, controller);

  const port = Number(process.env.PORT ?? 3000);
  app.server.listen(port, () => console.log(`genius-x server (mode=${config.mode}) listening on :${port}`));
}

void main();
