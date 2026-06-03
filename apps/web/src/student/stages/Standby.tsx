/**
 * Standby / waiting view (M3). Used before the class starts and as the placeholder for stages
 * not yet built in M3 (talent/birth/closure → M4). Never a blank wait: the clay friend is
 * always present with child-safe copy. No AI/Prompt/LLM wording.
 */
export interface StandbyProps {
  copy?: string;
}

export function Standby({ copy = "魔法泥人正在睡觉，等老师喊开始就醒来啦 ✨" }: StandbyProps): React.JSX.Element {
  return (
    <div className="stage stage--standby">
      <div className="clay" aria-hidden="true">🫧</div>
      <p className="stage__copy">{copy}</p>
    </div>
  );
}
