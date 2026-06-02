/**
 * HTTP API types — contracts v1. The non-WS client↔server surface (client-server contract).
 * Students join with a room code/QR — no password (Better Auth is shadow). See PRD §2.
 */
import type { Role } from "./enums.js";

export interface SessionJoinRequest {
  roomCode: string;
  /** Optional display name supplied at join (students), else assigned. */
  name?: string;
}

export interface SessionJoinResponse {
  studentId: string;
  sessionId: string;
  role: Role;
}
