/**
 * HTTP API types — contracts v1. The non-WS client↔server surface (client-server contract).
 * Students join with a room code/QR — no password (Better Auth is shadow). See PRD §2.
 */
import type { Role } from "./enums";

export interface SessionJoinRequest {
  roomCode: string;
  /**
   * Display name for assistant/unnamed-role joins. IGNORED for `role === "student"` in Phase 1:
   * a student's display name always derives from the resolved `Student.displayName`, never the
   * join body (so a client cannot override the enrolled identity).
   */
  name?: string;
  /** Role to join as (defaults to "student" if not provided). */
  role?: Role;
  /**
   * Persistent student identity (Phase 1). REQUIRED when `role === "student"` once the
   * persistent-join path lands (Step 5): the server looks up the enrolled `Student` and
   * validates tenant, rather than minting an ephemeral id. Optional at the type level only
   * because assistants/teachers never send it. No dual ephemeral/persistent path — a student
   * join with a MISSING `studentId` is rejected `400 INVALID_INPUT`, and an UNKNOWN one
   * `404 STUDENT_NOT_FOUND`; never silently back-filled. See docs/contracts/enrollment.md.
   */
  studentId?: string;
}

export interface SessionJoinResponse {
  /** Student ID returned when joining as student. */
  studentId?: string;
  sessionId: string;
  role: Role;
  /** Assistant ID returned when joining as assistant. */
  assistantId?: string;
}
