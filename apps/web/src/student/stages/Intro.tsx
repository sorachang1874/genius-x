/**
 * Intro stage (M3). The white clay "魔法泥人" waits; the start is locked until the assistant
 * unlocks the next stage (STAGE_UNLOCK), so there is no child-driven start button to press.
 * Pure presentation — child-safe copy only.
 */
export function Intro(): React.JSX.Element {
  return (
    <div className="stage stage--intro">
      <div className="clay clay--idle" aria-hidden="true">🧸</div>
      <h1 className="stage__title">一个魔法泥人正在等你……</h1>
      <p className="stage__copy">坐好啦，神奇的事情马上就要发生 ✨</p>
    </div>
  );
}
