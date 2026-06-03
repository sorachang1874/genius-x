/**
 * "Magic is happening" pending state (M3). Latency is ALWAYS dressed as thinking — never a
 * blank wait (PRD §0). Copy is child-safe ONLY: a friend doing magic. It must NEVER contain
 * "AI / Prompt / LLM / token / model" wording (hard product rule) — the banned-wording test
 * scans rendered output to enforce this.
 */
export interface ThinkingProps {
  /** Override copy per stage (e.g. shape uses an 8–15s "变身中" line). Keep it child-safe. */
  copy?: string;
}

export function Thinking({ copy = "魔法正在发生……" }: ThinkingProps): React.JSX.Element {
  return (
    <div className="thinking" role="status" aria-live="polite">
      <div className="thinking__sparkles" aria-hidden="true">
        <span>✨</span>
        <span>✨</span>
        <span>✨</span>
      </div>
      <p className="thinking__copy">{copy}</p>
    </div>
  );
}
