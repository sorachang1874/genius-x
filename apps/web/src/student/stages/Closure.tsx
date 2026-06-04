/**
 * Closure stage — 全班收束 (M4b). The whole class flips to a summary with the 伙伴出生证 docked.
 * The teacher leads the 互动三问 verbally — no app logic; the child just sees their friend + cert.
 */
import type { StageId } from "@genius-x/contracts";
import { useSession } from "../../shared/session";
import { Certificate } from "../Certificate";

export interface ClosureProps {
  stageId: StageId;
}

export function Closure(_props: ClosureProps): React.JSX.Element {
  const { you } = useSession();
  return (
    <div className="stage stage--closure">
      <h1 className="stage__title">这个好朋友，全世界只有你有 🌟</h1>
      <Certificate you={you} />
      <p className="stage__copy">下次我们带它去更远的地方冒险吧！</p>
    </div>
  );
}
