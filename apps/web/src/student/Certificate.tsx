/**
 * 伙伴出生证 (M4b). Assembled CLIENT-SIDE from authoritative `RESUME_STATE.you` — avatar
 * (`outputs.avatarUrl`), 闪光记忆点 (`you.memories`, labelled + ordered by the lesson's
 * `certificate` config), name (`you.displayName`), and the played 专属台词. Child-facing copy is
 * called 「伙伴出生证」 — never "AI" (hard product rule). Rendered in Birth + Closure.
 */
import { lesson001 } from "@genius-x/course-config";
import type { StudentRuntimeState } from "@genius-x/contracts";

export interface CertificateProps {
  you: StudentRuntimeState;
  /** The played 专属台词 (from the prepared AI_OUTPUT), if any. */
  speechText?: string | undefined;
}

export function Certificate({ you, speechText }: CertificateProps): React.JSX.Element {
  const labels = lesson001.certificate?.memoryLabels ?? {};
  const order = lesson001.certificate?.order ?? [];
  // ordered declared memories first, then any remaining present memory (resilient to 1–3 of them)
  const keys = [...order.filter((k) => you.memories[k] != null), ...Object.keys(you.memories).filter((k) => !order.includes(k))];
  const avatar = you.outputs.avatarUrl;

  return (
    <div className="certificate">
      <h2 className="certificate__title">伙伴出生证 ✨</h2>
      {you.displayName && <p className="certificate__name">{you.displayName} 的好朋友</p>}
      {avatar && <img className="certificate__avatar" src={String(avatar)} alt="我的好朋友" />}
      {keys.length > 0 && (
        <ul className="certificate__memories">
          {keys.map((k) => (
            <li key={k}>
              <span className="certificate__label">{labels[k] ?? k}</span>：{you.memories[k]}
            </li>
          ))}
        </ul>
      )}
      {speechText && <p className="certificate__speech">「{speechText}」</p>}
    </div>
  );
}
