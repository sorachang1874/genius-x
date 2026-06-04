/**
 * Role entry. `?role=assistant` → assistant control panel; `?role=teacher` → 诞生礼 big-screen /
 * projection (M4b); otherwise the student client (room-code join → classroom). Real RBAC is shadow
 * (Better Auth, DF-8); the query param is a documented demo convenience (DF-M3-4).
 */
import { StudentApp } from "./student/StudentApp";
import { AssistantApp } from "./assistant/AssistantApp";
import { TeacherScreen } from "./teacher/TeacherScreen";

export function App(): React.JSX.Element {
  const role = new URLSearchParams(window.location.search).get("role");
  if (role === "assistant") return <AssistantApp />;
  if (role === "teacher") return <TeacherScreen />;
  return <StudentApp />;
}
