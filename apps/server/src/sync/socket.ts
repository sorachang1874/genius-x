/**
 * Thin Socket.IO transport over ClassroomController. Each socket joins its session room and
 * a per-student room (for RESUME_STATE). All logic lives in the controller; this is glue
 * (covered by the E-M1 integration smoke, not unit tests).
 */
import type { Server, Socket } from "socket.io";
import type { ClientMessage } from "@genius-x/contracts";
import type { ClassroomController, Emitter } from "./controller";

const room = (sessionId: string): string => `session:${sessionId}`;
const studentRoom = (sessionId: string, studentId: string): string => `session:${sessionId}:student:${studentId}`;

/** An Emitter backed by a Socket.IO server (rooms). */
export function ioEmitter(io: Server): Emitter {
  return {
    toSession: (sessionId, msg) => {
      io.to(room(sessionId)).emit("server_message", msg);
    },
    toStudent: (sessionId, studentId, msg) => {
      io.to(studentRoom(sessionId, studentId)).emit("server_message", msg);
    },
  };
}

export function attachSocket(io: Server, controller: ClassroomController): void {
  io.on("connection", (socket: Socket) => {
    const sessionId = String(socket.handshake.auth.sessionId ?? "");
    const studentId = String(socket.handshake.auth.studentId ?? "");
    if (sessionId) socket.join(room(sessionId));
    if (sessionId && studentId) socket.join(studentRoom(sessionId, studentId));

    socket.on("client_message", (msg: ClientMessage) => {
      // join the per-student room on HELLO so RESUME_STATE reaches this socket even if
      // studentId was not in the handshake (only for students, not assistants)
      if (sessionId && msg.type === "HELLO" && msg.studentId) socket.join(studentRoom(sessionId, msg.studentId));
      controller.onMessage(sessionId, msg).catch((err: unknown) => console.error("[socket] onMessage failed", err));
    });
  });
}
