/**
 * Role entry. `?role=assistant` → assistant control panel; `?role=teacher` → 诞生礼 big-screen /
 * projection (M4b); otherwise the student client (room-code join → classroom). Real RBAC is shadow
 * (Better Auth, DF-8); the query param is a documented demo convenience (DF-M3-4).
 */
import { StudentApp } from "./student/StudentApp";
import { AssistantApp } from "./assistant/AssistantApp";
import { TeacherScreen } from "./teacher/TeacherScreen";
import { ParentShareApp } from "./parent/ParentShareApp";

export function App(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  // Phase 3: a parent share capability link (?share=<token>) wins over role routing.
  // PRESENCE (has), not truthiness: a link IM-truncated to "?share=" must land on the
  // parent app's warm "请联系老师" guidance, never on the student room-code screen.
  if (params.has("share")) return <ParentShareApp />;
  const role = params.get("role");
  if (role === "assistant") return <AssistantApp />;
  if (role === "teacher") return <TeacherScreen />;
  return <StudentApp />;
}
