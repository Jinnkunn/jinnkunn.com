import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  CalendarDays,
  FileText,
  Files,
  Globe2,
  Home,
  LayoutGrid,
  NotebookText,
  Route,
  Settings,
  SquareCheckBig,
} from "lucide-react";

function createWorkspaceIcon(Icon: LucideIcon, size = 16) {
  return function WorkspaceIconGlyph() {
    return (
      <Icon
        absoluteStrokeWidth
        aria-hidden="true"
        focusable="false"
        size={size}
        strokeWidth={1.6}
      />
    );
  };
}

export const SiteAdminIcon = createWorkspaceIcon(Globe2);
export const CalendarIcon = createWorkspaceIcon(CalendarDays);
export const NotesIcon = createWorkspaceIcon(NotebookText);
export const TodosIcon = createWorkspaceIcon(SquareCheckBig);
export const WorkspaceIcon = createWorkspaceIcon(LayoutGrid);
export const StatusIcon = createWorkspaceIcon(Activity, 14);
export const ConfigIcon = createWorkspaceIcon(Settings, 14);
export const RoutesIcon = createWorkspaceIcon(Route, 14);
export const PostsIcon = createWorkspaceIcon(FileText, 14);
export const PagesIcon = createWorkspaceIcon(Files, 14);
export const ArchiveIcon = createWorkspaceIcon(Archive, 14);
export const HomeIcon = createWorkspaceIcon(Home, 14);
