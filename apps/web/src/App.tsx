/**
 * Role entry — now a thin consumer of the Shell (Phase 6.5): `resolveEntry` owns the
 * URL→entry decision (all legacy query-param aliases preserved + precedence pinned
 * there); `ThemeProvider` applies the active ThemePack (brand default in v1 — derived
 * packs arrive with the playground work, theme.md). Real RBAC is shadow (Better Auth,
 * DF-8); the ?role= query param is a documented demo convenience (DF-M3-4).
 */
import { StudentApp } from "./student/StudentApp";
import { AssistantApp } from "./assistant/AssistantApp";
import { TeacherScreen } from "./teacher/TeacherScreen";
import { ParentShareApp } from "./parent/ParentShareApp";
import { ParentHomeApp } from "./parent/ParentHomeApp";
import { resolveEntry } from "./shell/entry";
import { ThemeProvider } from "./shell/theme/ThemeProvider";

const SURFACES = {
  share: ParentShareApp,
  parent: ParentHomeApp,
  assistant: AssistantApp,
  teacher: TeacherScreen,
  student: StudentApp,
} as const;

export function App(): React.JSX.Element {
  const Surface = SURFACES[resolveEntry(window.location.search).kind];
  return (
    <ThemeProvider>
      <Surface />
    </ThemeProvider>
  );
}
