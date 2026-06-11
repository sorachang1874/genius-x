/**
 * ContextBuilder — the COLD path (docs/contracts/agent-context.md): cross-lesson context
 * assembled per contextual call. Agent I's first module.
 *
 *   1. CANON first (always, smallest): the current companion state. Pre-4.5 source =
 *      identity's GeniusXProfile (ip-character.md's transition table names it today's
 *      source of truth); the `ip_characters` record replaces it at Phase 4.5 behind this
 *      same seam. Includes the child's displayName — a lead-serialized consumer addition
 *      on identity.md's displayName row (provider-facing, same posture as transcripts).
 *   2. SEMANTIC memories: latest-per-key dedup (DF-v2-15 — the READER dedups), importance-
 *      ranked, top CONTEXT_SEMANTIC_TOP_K.
 *   3. EPISODIC memories: importance-ranked (recency tie-break), top CONTEXT_EPISODE_TOP_K.
 *   Canon and memories fetch in PARALLEL; retrieval writes back lastAccessedAt/accessCount
 *   (pre-built Phase-2 fields), fire-and-forget, malformed rows excluded.
 *
 * TRACE TAXONOMY (contract reasons, exact-match preflights depend on them):
 *   reason = "context_canon_miss" / "context_cold_miss"  +  cause = why.
 *   Not-wired causes trace ONCE per builder (deployment state — the once-per-session
 *   discipline); runtime failures (lookup_failed, retrieval throw) trace per call.
 *   "context_served" (counts only) per contextful call; "context_episode_malformed"
 *   (memory id only) per corrupted row — countable, never silent.
 *
 * Availability class: SHADOW — identity/workspace down ⇒ the call proceeds with less
 * context, traced; the classroom never blocks.
 */
import type { EpisodeValue, StudentMemory, TraceEvent, TraceSink } from "@genius-x/contracts";
import { CONTEXT_EPISODE_TOP_K, CONTEXT_SEMANTIC_TOP_K, CONTEXT_VERSION, parseEpisodeValue } from "@genius-x/contracts";
import type { IdentityService } from "../identity/service";
import type { WorkspaceService } from "../workspace/service";
import type { IpCharacterService } from "../workspace/ip-character";
import type { ParentNoteRelay } from "../parent/service";

export interface ColdContext {
  version: string;
  text: string;
  /** Component counts — emitted in the context_served trace (counts only, never text). */
  hasCanon: boolean;
  semanticCount: number;
  episodeCount: number;
  /** Parent-note ids riding this block — the CONTROLLER marks them relayed only after a
   *  NON-DEGRADED contextful reply (parent-surface.md: a fallback answer never consumed
   *  them; they stay unrelayed and retry next call). Empty when no notes injected. */
  noteIds: string[];
}

export class ContextBuilder {
  /** Deployment-state absences trace ONCE per builder (wiring is fixed at construction). */
  private identityAbsenceTraced = false;
  private workspaceAbsenceTraced = false;

  constructor(
    private readonly identity: IdentityService | undefined,
    private readonly workspace: WorkspaceService | undefined,
    /** P4.5-B: the canonical canon source; the GeniusXProfile mirror is the fallback. */
    private readonly ipCharacter: IpCharacterService | undefined,
    private readonly trace: TraceSink,
    private readonly now: () => string,
    /** Phase 6 (parent-surface.md): unrelayed parent notes — injected once, then marked. */
    private readonly parentNotes?: ParentNoteRelay,
  ) {}

  /** Assemble the cold block for one student. Returns undefined when nothing is known. */
  async buildCold(sessionId: string, studentId: string): Promise<ColdContext | undefined> {
    // Canon, memories, and parent notes are independent — fetch in parallel.
    const [canonLines, mem, notes] = await Promise.all([
      this.canon(sessionId, studentId),
      this.memories(sessionId, studentId),
      this.notes(sessionId, studentId),
    ]);

    // context_v2 ASSEMBLY — headers, line formats, and section order ARE the version:
    // ANY change here is a context_v3 — bump CONTEXT_VERSION in @genius-x/contracts FIRST
    // (a golden test pins the exact text). Provider/operator-facing; never child-rendered.
    const sections: string[] = [];
    if (canonLines.length > 0) sections.push(`【你的伙伴设定】\n${canonLines.join("\n")}`);
    if (notes.length > 0) {
      sections.push(`【爸爸妈妈想对你说】\n${notes.map((n) => n.note).join("\n")}`);
    }
    if (mem.semantic.length > 0) {
      sections.push(`【你记得关于这个孩子的事】\n${mem.semantic.map((m) => `${m.key}: ${m.value}`).join("\n")}`);
    }
    if (mem.episodes.length > 0) {
      sections.push(`【你们一起经历过的时刻】\n${mem.episodes.map((e, i) => `${i + 1}. ${e.summary}`).join("\n")}`);
    }
    if (sections.length === 0) return undefined; // a brand-new child: correctly context-less

    const cold: ColdContext = {
      version: CONTEXT_VERSION,
      text: sections.join("\n\n"),
      hasCanon: canonLines.length > 0,
      semanticCount: mem.semantic.length,
      episodeCount: mem.episodes.length,
      // Relay marking moved to the CONTROLLER (review fix): marking at BUILD time lost
      // notes whenever the gateway served a fallback (input/output filtered, provider
      // error/timeout) — the note was "relayed" but the child never heard it.
      noteIds: notes.map((n) => n.id),
    };
    // Counts only — never text (trace-redaction posture).
    this.mk("context_served", {
      sessionId, studentId, hasCanon: cold.hasCanon,
      semantic: cold.semanticCount, episodes: cold.episodeCount, notes: notes.length,
    });
    return cold;
  }

  /** Unrelayed parent notes (≤2 newest) — failure ⇒ the lesson runs without them. */
  private async notes(sessionId: string, studentId: string): Promise<{ id: string; note: string }[]> {
    if (!this.parentNotes) return [];
    try {
      return await this.parentNotes.unrelayedNotes(studentId, 2);
    } catch (err) {
      this.mk("parent_note_relay_failed", { error: String((err as Error)?.name ?? err), sessionId, studentId });
      return [];
    }
  }

  /** Canon: the ip_characters record FIRST (the canonical entity, P4.5-B), GeniusXProfile
   *  mirror as the fallback — the SAME seam the contract promised. An EMPTY profile/no
   *  character is correctly no canon (a first lesson) — NOT a miss, untraced. */
  private async canon(sessionId: string, studentId: string): Promise<string[]> {
    if (this.ipCharacter) {
      try {
        const ch = await this.ipCharacter.getCharacter(studentId);
        if (ch) {
          const lines: string[] = [];
          if (ch.surface.name) lines.push(`你的名字：${ch.surface.name}`);
          if (ch.surface.personality) lines.push(`你的性格：${ch.surface.personality}`);
          if (ch.surface.backstory) lines.push(`你来自：${ch.surface.backstory}`);
          if (lines.length > 0 && this.identity) {
            try {
              const student = await this.identity.getStudent(studentId);
              if (student?.displayName) lines.push(`孩子的名字：${student.displayName}`);
            } catch {
              // the child's name line is optional garnish — canon itself already serves
            }
          }
          if (lines.length > 0) return lines;
          // an EMPTY surface falls through to the mirror (which may carry legacy fields)
        }
      } catch (err) {
        this.mk("context_canon_miss", { cause: "character_lookup_failed", error: String((err as Error)?.name ?? err), sessionId, studentId });
        // fall through to the mirror — degraded canon beats no canon
      }
    }
    if (!this.identity) {
      if (!this.identityAbsenceTraced) {
        this.identityAbsenceTraced = true;
        this.mk("context_canon_miss", { cause: "identity_not_wired", sessionId, studentId });
      }
      return [];
    }
    try {
      const student = await this.identity.getStudent(studentId);
      if (!student) {
        this.mk("context_canon_miss", { cause: "student_not_found", sessionId, studentId });
        return [];
      }
      const g = student.geniusX;
      const lines: string[] = [];
      if (g.name) lines.push(`你的名字：${g.name}`);
      if (g.personalityTag) lines.push(`你的性格：${g.personalityTag}`);
      if (g.backgroundSetting) lines.push(`你来自：${g.backgroundSetting}`);
      if (lines.length > 0 && student.displayName) lines.push(`孩子的名字：${student.displayName}`);
      return lines;
    } catch (err) {
      this.mk("context_canon_miss", { cause: "lookup_failed", error: String((err as Error)?.name ?? err), sessionId, studentId });
      return [];
    }
  }

  private async memories(sessionId: string, studentId: string): Promise<{ semantic: StudentMemory[]; episodes: EpisodeValue[] }> {
    if (!this.workspace) {
      if (!this.workspaceAbsenceTraced) {
        this.workspaceAbsenceTraced = true;
        this.mk("context_cold_miss", { cause: "workspace_not_wired", sessionId, studentId });
      }
      return { semantic: [], episodes: [] };
    }
    try {
      const r = await this.workspace.retrieveContextMemories(studentId, {
        semanticTopK: CONTEXT_SEMANTIC_TOP_K,
        episodeTopK: CONTEXT_EPISODE_TOP_K,
      });
      // Episode rows hold EpisodeValue JSON — parse defensively. A malformed row is a
      // CORRUPTION SIGNAL (the write path schema-validates), so it is counted, never
      // silently dropped — and it earns no access write-back.
      const episodes: EpisodeValue[] = [];
      const accessedIds: string[] = r.semantic.map((m) => m.id);
      for (const m of r.episodes) {
        const e = parseEpisodeValue(m.value);
        if (e === null) {
          this.mk("context_episode_malformed", { memoryId: m.id, sessionId, studentId });
          continue;
        }
        episodes.push(e);
        accessedIds.push(m.id);
      }
      // Access write-back: fire-and-forget (pre-built Phase-2 fields; failure irrelevant).
      if (accessedIds.length > 0) void this.workspace.markMemoriesAccessed(accessedIds).catch(() => {});
      return { semantic: r.semantic, episodes };
    } catch (err) {
      this.mk("context_cold_miss", { cause: "retrieval_failed", error: String((err as Error)?.name ?? err), sessionId, studentId });
      return { semantic: [], episodes: [] };
    }
  }

  private mk(reason: string, payload: Record<string, unknown>): void {
    // reason LAST — a payload key must never clobber the contract reason (review fix).
    const e: TraceEvent = { at: this.now(), kind: "interaction", payload: { ...payload, reason } };
    try {
      this.trace.record(e);
    } catch {
      // trace is shadow — never throws into the context path
    }
  }
}
