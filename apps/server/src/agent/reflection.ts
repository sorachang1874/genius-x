/**
 * ReflectionService (L1, Phase 6.5 Step 4 — Agent I) — the companion "thinks about
 * today" at lesson end and writes ONE diary entry per student per lesson.
 *
 * HONEST TIER (APP PRD §5.1): v1 is a DETERMINISTIC curation of real episode data —
 * no model call, no FakeProvider theater. The generative first-person diary arrives
 * with real LLM providers (same seam: this service swaps its composer, nothing else).
 *
 * Discipline: fire-and-forget from the lesson-end sweep (AFTER episodic consolidations
 * settle — the diary reads what they wrote); failure = countable trace, the classroom
 * never blocks; the entry passes a defensive safety review before storage (episode
 * summaries were reviewed at THEIR write, this is belt-and-braces); idempotent per
 * (student, lesson): an existing entry for the lesson is a NO-OP (the P4.5 retry rule).
 */
import type { TraceEvent, TraceSink } from "@genius-x/contracts";
import { DIARY_MEMORY_KEY, DIARY_SUMMARY_MAX_CHARS, EPISODE_MEMORY_KEY, parseDiaryValue, parseEpisodeValue } from "@genius-x/contracts";
import type { SafetyFilter } from "@genius-x/ai-gateway";
import { KeywordSafetyFilter } from "@genius-x/ai-gateway";
import type { WorkspaceService } from "../workspace/service";

export class ReflectionService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly trace: TraceSink,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly safety: SafetyFilter = new KeywordSafetyFilter(),
  ) {}

  private mk(reason: string, payload: Record<string, unknown>): void {
    const e: TraceEvent = { at: this.now(), kind: "interaction", payload: { ...payload, reason } };
    try {
      this.trace.record(e);
    } catch {
      // trace is shadow
    }
  }

  /**
   * Reflect on one student's lesson: episodes of THIS session → one diary entry.
   * Returns true when an entry was written (false = skipped, traced with cause).
   */
  async reflectOnLesson(studentId: string, lessonId: string, sessionId: string): Promise<boolean> {
    // Idempotency (the P4.5 retry rule): one entry per (student, lesson) — re-runs no-op.
    const existing = await this.workspace.listDiaryEntries(studentId, 50);
    if (existing.some((d) => d.lessonId === lessonId)) {
      this.mk("reflection_skipped", { cause: "already_written", studentId, lessonId });
      return false;
    }

    // The diary reads what consolidation wrote: this SESSION's episodes only.
    const episodes = await this.workspace.listSessionEpisodes(studentId, sessionId);
    const summaries = episodes
      .map((e) => parseEpisodeValue(e.value)?.summary)
      .filter((x): x is string => typeof x === "string");
    if (summaries.length === 0) {
      // A degraded lesson (no consolidations landed) writes NO diary — absence is the
      // honest state; countable, never a fabricated memory.
      this.mk("reflection_skipped", { cause: "no_episodes", studentId, lessonId });
      return false;
    }
    const madeCount = await this.workspace.countLessonWorks(studentId, lessonId);

    // DETERMINISTIC composition from reviewed data (no model, no free text beyond the
    // episode summaries themselves). First-person companion voice, banned-wording-safe
    // template; bounded.
    let summary = `今天${summaries.join("；然后")}。`;
    if (madeCount > 0) summary += `我们一起做了${madeCount}件小东西，都好好收着呢。`;
    if (summary.length > DIARY_SUMMARY_MAX_CHARS) {
      summary = `${summary.slice(0, DIARY_SUMMARY_MAX_CHARS - 1)}…`;
    }

    // Belt-and-braces review (episode summaries were reviewed at their write).
    const review = this.safety.reviewInput(summary);
    if (!review.ok) {
      this.mk("reflection_failed", { cause: "safety_rejected", studentId, lessonId });
      return false;
    }

    const value = JSON.stringify({ summary, lessonId, madeCount });
    // The validator both boundaries share — compose-side proof before the write path
    // re-checks it (drift between composer and schema fails HERE, loudly).
    if (parseDiaryValue(value) === null) {
      this.mk("reflection_failed", { cause: "schema_invalid", studentId, lessonId });
      return false;
    }
    await this.workspace.recordMemory({
      studentId,
      key: DIARY_MEMORY_KEY,
      value,
      context: { lessonId, stageId: "lesson_end", sessionId },
      importance: 0.5,
    });
    this.mk("reflection_written", { studentId, lessonId, episodes: summaries.length, madeCount });
    return true;
  }
}

/** Re-exported for callers that compose greetings from the same episode source. */
export { EPISODE_MEMORY_KEY };
