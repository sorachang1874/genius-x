/**
 * Role entry (M3). `?role=assistant` → assistant control panel; otherwise the student client
 * (room-code join → classroom). Real RBAC is shadow (Better Auth, DF-8); query param is a
 * documented demo convenience (DF-M3-4).
 */
import { StudentApp } from "./student/StudentApp";
import { AssistantApp } from "./assistant/AssistantApp";

export function App(): React.JSX.Element {
  const role = new URLSearchParams(window.location.search).get("role");
  return role === "assistant" ? <AssistantApp /> : <StudentApp />;
}
