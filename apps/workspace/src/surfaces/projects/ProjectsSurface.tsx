import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import {
  projectLinksCreate,
  projectLinksDelete,
  projectLinksList,
  projectsArchive,
  projectsCreate,
  projectsList,
  projectsMove,
  projectsUnarchive,
  projectsUpdate,
  type ProjectLinkRow,
  type ProjectRow,
} from "../../modules/projects/api";
import {
  filterProjects,
  projectsByStatusCount,
  projectsNeedingAttention,
  sortProjects,
} from "../../modules/projects/model";
import { notesCreate, notesUpdate } from "../../modules/notes/api";
import {
  todosCreate,
  todosList,
  todosListByProject,
  todosUpdate,
  type TodoRow,
} from "../../modules/todos/api";
import { useSurfaceNav } from "../../shell/surface-nav-context";
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceEmptyState,
  WorkspaceInlineStatus,
  WorkspaceSurfaceFrame,
} from "../../ui/primitives";
import { noteNavId } from "../notes/tree";
import { ProjectDetailView } from "./ProjectDetail";
import { ProjectsHome, ProjectsListView } from "./ProjectsHome";
import {
  PROJECTS_ACTIVE_NAV_ID,
  PROJECTS_ARCHIVED_NAV_ID,
  PROJECTS_COMPLETED_NAV_ID,
  PROJECTS_DEFAULT_NAV_ITEM_ID,
  PROJECTS_HOME_NAV_ID,
  PROJECTS_LIST_GROUP_ID,
  PROJECTS_PAUSED_NAV_ID,
  PROJECTS_SYSTEM_GROUP_ID,
  PROJECTS_VIEWS_GROUP_ID,
  createProjectsNavGroups,
  isProjectCreateNavItem,
  projectIdFromNavItem,
  projectNavId,
  projectRowsToNavItems,
  type ProjectsNavCounts,
} from "./nav";
import {
  viewFromNavItem,
  viewTitle,
  type ProjectLinkDraft,
  type ProjectUpdatePatch,
} from "./projectFormat";
import "../../styles/surfaces/projects.css";

const PROJECT_NAV_IDS = new Set([
  PROJECTS_HOME_NAV_ID,
  PROJECTS_ACTIVE_NAV_ID,
  PROJECTS_PAUSED_NAV_ID,
  PROJECTS_COMPLETED_NAV_ID,
  PROJECTS_ARCHIVED_NAV_ID,
]);

type NoticeKind = "error" | "info";

interface ProjectsNotice {
  kind: NoticeKind;
  text: string;
}

function isNativeBridgeUnavailable(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  );
}

function formatProjectsError(error: unknown): string {
  if (isNativeBridgeUnavailable(error)) return "Projects unavailable in this preview.";
  return String(error);
}

function mergeProject(rows: readonly ProjectRow[], row: ProjectRow): ProjectRow[] {
  return sortProjects([
    ...rows.filter((project) => project.id !== row.id),
    row,
  ]);
}

function mergeTodo(rows: readonly TodoRow[], row: TodoRow): TodoRow[] {
  return [
    ...rows.filter((todo) => todo.id !== row.id),
    row,
  ].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function ProjectsSurface() {
  const {
    activeNavItemId,
    selectWorkspaceNavItem,
    setActiveNavItemId,
    setMoveNavItemHandler,
    setNavGroupItems,
    setRenameNavItemHandler,
    setRenameValidator,
    setReorderNavItemHandler,
  } = useSurfaceNav();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [allTodos, setAllTodos] = useState<TodoRow[]>([]);
  const [projectTodos, setProjectTodos] = useState<TodoRow[]>([]);
  const [links, setLinks] = useState<ProjectLinkRow[]>([]);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ProjectsNotice | null>(null);
  const [linkDraft, setLinkDraft] = useState<ProjectLinkDraft>({
    label: "",
    target: "",
    type: "url",
  });

  const view = viewFromNavItem(activeNavItemId);
  const selectedProjectId = projectIdFromNavItem(activeNavItemId);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const liveProjects = useMemo(
    () => projects.filter((project) => project.archivedAt === null),
    [projects],
  );

  const refreshProjects = async () => {
    const rows = await projectsList();
    setProjects(sortProjects(rows));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projectRows, todoRows] = await Promise.all([
          projectsList(),
          todosList(),
        ]);
        if (cancelled) return;
        setProjects(sortProjects(projectRows));
        setAllTodos(todoRows);
      } catch (error) {
        if (!cancelled && !isNativeBridgeUnavailable(error)) {
          setNotice({
            kind: "error",
            text: `Failed to load projects: ${formatProjectsError(error)}`,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeNavItemId) {
      setActiveNavItemId(PROJECTS_DEFAULT_NAV_ITEM_ID);
      return;
    }
    if (isProjectCreateNavItem(activeNavItemId)) return;
    if (PROJECT_NAV_IDS.has(activeNavItemId)) return;
    const projectId = projectIdFromNavItem(activeNavItemId);
    if (projectId && projects.some((project) => project.id === projectId)) return;
    setActiveNavItemId(PROJECTS_DEFAULT_NAV_ITEM_ID);
  }, [activeNavItemId, projects, setActiveNavItemId]);

  useEffect(() => {
    if (!selectedProject) {
      setLinks([]);
      setProjectTodos([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      projectLinksList(selectedProject.id),
      todosListByProject(selectedProject.id),
    ])
      .then(([linkRows, todoRows]) => {
        if (cancelled) return;
        setLinks(linkRows);
        setProjectTodos(todoRows);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({
            kind: "error",
            text: `Failed to load links: ${formatProjectsError(error)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  const navCounts = useMemo<ProjectsNavCounts>(
    () => ({
      [PROJECTS_HOME_NAV_ID]: projectsNeedingAttention(projects).length,
      [PROJECTS_ACTIVE_NAV_ID]: projectsByStatusCount(projects, "active"),
      [PROJECTS_PAUSED_NAV_ID]: projectsByStatusCount(projects, "paused"),
      [PROJECTS_COMPLETED_NAV_ID]: projectsByStatusCount(projects, "completed"),
      [PROJECTS_ARCHIVED_NAV_ID]: projects.filter((project) => project.archivedAt !== null)
        .length,
    }),
    [projects],
  );

  const navGroups = useMemo(
    () =>
      createProjectsNavGroups(
        navCounts,
        projectRowsToNavItems(sortProjects(liveProjects)),
      ),
    [liveProjects, navCounts],
  );

  useEffect(() => {
    for (const group of navGroups) {
      setNavGroupItems(group.id, group.items);
    }
    return () => {
      setNavGroupItems(PROJECTS_VIEWS_GROUP_ID, null);
      setNavGroupItems(PROJECTS_LIST_GROUP_ID, null);
      setNavGroupItems(PROJECTS_SYSTEM_GROUP_ID, null);
    };
  }, [navGroups, setNavGroupItems]);

  useEffect(() => {
    setMoveNavItemHandler(async (fromId, toId) => {
      const fromProjectId = projectIdFromNavItem(fromId);
      const toProjectId = projectIdFromNavItem(toId);
      if (!fromProjectId || !toProjectId || fromProjectId === toProjectId) return;
      try {
        const rows = await projectsMove({
          edge: "before",
          id: fromProjectId,
          targetId: toProjectId,
        });
        setProjects(sortProjects(rows));
      } catch (error) {
        setNotice({
          kind: "error",
          text: `Failed to move project: ${formatProjectsError(error)}`,
        });
      }
    });
    return () => setMoveNavItemHandler(null);
  }, [setMoveNavItemHandler]);

  useEffect(() => {
    setReorderNavItemHandler(async (itemId, direction) => {
      const projectId = projectIdFromNavItem(itemId);
      if (!projectId) return;
      const rows = sortProjects(liveProjects);
      const index = rows.findIndex((project) => project.id === projectId);
      const target = rows[direction === "up" ? index - 1 : index + 1];
      if (!target) return;
      try {
        const next = await projectsMove({
          edge: direction === "up" ? "before" : "after",
          id: projectId,
          targetId: target.id,
        });
        setProjects(sortProjects(next));
      } catch (error) {
        setNotice({
          kind: "error",
          text: `Failed to reorder project: ${formatProjectsError(error)}`,
        });
      }
    });
    return () => setReorderNavItemHandler(null);
  }, [liveProjects, setReorderNavItemHandler]);

  useEffect(() => {
    setRenameNavItemHandler(async (itemId, nextTitle) => {
      const projectId = projectIdFromNavItem(itemId);
      if (!projectId) return;
      try {
        const row = await projectsUpdate({ id: projectId, title: nextTitle });
        setProjects((current) => mergeProject(current, row));
      } catch (error) {
        setNotice({
          kind: "error",
          text: `Failed to rename project: ${formatProjectsError(error)}`,
        });
      }
    });
    setRenameValidator((itemId, nextTitle) => {
      if (!projectIdFromNavItem(itemId)) return null;
      if (!nextTitle.trim()) return "Project title is required";
      return null;
    });
    return () => {
      setRenameNavItemHandler(null);
      setRenameValidator(null);
    };
  }, [setRenameNavItemHandler, setRenameValidator]);

  const createProject = useCallback(async (title?: string) => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const row = await projectsCreate({
        title: (title ?? newProjectTitle.trim()) || null,
      });
      setProjects((current) => mergeProject(current, row));
      setNewProjectTitle("");
      setActiveNavItemId(projectNavId(row.id));
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to create project: ${formatProjectsError(error)}`,
      });
    } finally {
      setSaving(false);
    }
  }, [newProjectTitle, saving, setActiveNavItemId]);

  useEffect(() => {
    if (!isProjectCreateNavItem(activeNavItemId)) return;
    setActiveNavItemId(PROJECTS_DEFAULT_NAV_ITEM_ID);
    void createProject("");
  }, [activeNavItemId, createProject, setActiveNavItemId]);

  const updateProject = async (
    project: ProjectRow,
    patch: ProjectUpdatePatch,
  ) => {
    setNotice(null);
    try {
      const row = await projectsUpdate({
        id: project.id,
        description: patch.description,
        dueAt: patch.dueAt,
        pinned: patch.pinned,
        status: patch.status,
        title: patch.title,
      });
      setProjects((current) => mergeProject(current, row));
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to update project: ${formatProjectsError(error)}`,
      });
    }
  };

  const archiveProject = async (project: ProjectRow) => {
    setNotice(null);
    try {
      await projectsArchive(project.id);
      await refreshProjects();
      setActiveNavItemId(PROJECTS_ARCHIVED_NAV_ID);
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to archive project: ${formatProjectsError(error)}`,
      });
    }
  };

  const restoreProject = async (project: ProjectRow) => {
    setNotice(null);
    try {
      const row = await projectsUnarchive(project.id);
      setProjects((current) => mergeProject(current, row));
      setActiveNavItemId(projectNavId(row.id));
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to restore project: ${formatProjectsError(error)}`,
      });
    }
  };

  const createProjectTodo = async (project: ProjectRow) => {
    const title = newTodoTitle.trim();
    if (!title) return;
    setNotice(null);
    try {
      const row = await todosCreate({ projectId: project.id, title });
      setProjectTodos((current) => mergeTodo(current, row));
      setAllTodos((current) => mergeTodo(current, row));
      setNewTodoTitle("");
      await refreshProjects();
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to create todo: ${formatProjectsError(error)}`,
      });
    }
  };

  const toggleTodo = async (todo: TodoRow) => {
    const optimistic = {
      ...todo,
      completedAt: todo.completedAt ? null : Date.now(),
      updatedAt: Date.now(),
    };
    setProjectTodos((current) => mergeTodo(current, optimistic));
    setAllTodos((current) => mergeTodo(current, optimistic));
    try {
      const row = await todosUpdate({
        completed: !todo.completedAt,
        id: todo.id,
      });
      setProjectTodos((current) => mergeTodo(current, row));
      setAllTodos((current) => mergeTodo(current, row));
      await refreshProjects();
    } catch (error) {
      setProjectTodos((current) => mergeTodo(current, todo));
      setAllTodos((current) => mergeTodo(current, todo));
      setNotice({
        kind: "error",
        text: `Failed to update todo: ${formatProjectsError(error)}`,
      });
    }
  };

  const createProjectNote = async (project: ProjectRow) => {
    setNotice(null);
    try {
      const created = await notesCreate({ title: project.title });
      const body = `# ${project.title}\n\n## Overview\n\n${project.description}\n\n## Next actions\n\n- `;
      const note = await notesUpdate({
        bodyMdx: body,
        icon: "i:project",
        id: created.note.id,
        title: project.title,
      });
      const link = await projectLinksCreate({
        label: note.title,
        projectId: project.id,
        targetId: note.id,
        targetType: "note",
      });
      setLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setNotice({ kind: "info", text: "Project note created." });
      selectWorkspaceNavItem("notes", noteNavId(note.id));
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to create project note: ${formatProjectsError(error)}`,
      });
    }
  };

  const addLink = async (project: ProjectRow, event: FormEvent) => {
    event.preventDefault();
    const target = linkDraft.target.trim();
    if (!target) return;
    setNotice(null);
    try {
      const link = await projectLinksCreate({
        label: linkDraft.label.trim() || null,
        projectId: project.id,
        targetId: linkDraft.type === "url" ? null : target,
        targetType: linkDraft.type,
        url: linkDraft.type === "url" ? target : null,
      });
      setLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setLinkDraft({ label: "", target: "", type: "url" });
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to add link: ${formatProjectsError(error)}`,
      });
    }
  };

  const deleteLink = async (link: ProjectLinkRow) => {
    setNotice(null);
    try {
      await projectLinksDelete(link.id);
      setLinks((current) => current.filter((item) => item.id !== link.id));
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to delete link: ${formatProjectsError(error)}`,
      });
    }
  };

  const activeProjects = filterProjects(projects, "active");
  const visibleProjects =
    view === "archived" ||
    view === "active" ||
    view === "paused" ||
    view === "completed"
      ? filterProjects(projects, view)
      : [];

  return (
    <WorkspaceSurfaceFrame className="projects-surface">
      <WorkspaceCommandBar
        className="projects-commandbar"
        leading={
          <form
            className="projects-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void createProject();
            }}
          >
            <input
              aria-label="Project title"
              autoComplete="off"
              placeholder="New project..."
              value={newProjectTitle}
              onChange={(event) => setNewProjectTitle(event.currentTarget.value)}
            />
            <WorkspaceCommandButton
              disabled={saving}
              tone="accent"
              type="submit"
            >
              <Plus absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
              Add
            </WorkspaceCommandButton>
          </form>
        }
        trailing={
          <WorkspaceCommandGroup align="end">
            <span className="projects-commandbar__count">
              {viewTitle(view)} · {view === "home" ? activeProjects.length : visibleProjects.length}
            </span>
          </WorkspaceCommandGroup>
        }
      />

      {notice ? (
        <WorkspaceInlineStatus
          className="projects-notice"
          data-kind={notice.kind}
          tone={notice.kind === "error" ? "error" : "default"}
        >
          {notice.text}
        </WorkspaceInlineStatus>
      ) : null}

      {loading ? (
        <WorkspaceEmptyState className="projects-empty" title="Loading projects" />
      ) : selectedProject && view === "detail" ? (
        <ProjectDetailView
          linkDraft={linkDraft}
          links={links}
          newTodoTitle={newTodoTitle}
          onAddLink={(event) => void addLink(selectedProject, event)}
          onArchive={() => void archiveProject(selectedProject)}
          onCreateNote={() => void createProjectNote(selectedProject)}
          onCreateTodo={() => void createProjectTodo(selectedProject)}
          onDeleteLink={(link) => void deleteLink(link)}
          onLinkDraftChange={setLinkDraft}
          onOpenNote={(noteId) => selectWorkspaceNavItem("notes", noteNavId(noteId))}
          onRestore={() => void restoreProject(selectedProject)}
          onSetNewTodoTitle={setNewTodoTitle}
          onToggleTodo={(todo) => void toggleTodo(todo)}
          onUpdate={(patch) => void updateProject(selectedProject, patch)}
          project={selectedProject}
          todos={projectTodos}
        />
      ) : view === "home" ? (
        <ProjectsHome
          onOpenProject={(project) => setActiveNavItemId(projectNavId(project.id))}
          projects={projects}
          todos={allTodos}
        />
      ) : (
        <ProjectsListView
          emptyLabel={
            view === "archived"
              ? "No archived projects"
              : `No ${viewTitle(view).toLowerCase()} projects`
          }
          onOpenProject={(project) => setActiveNavItemId(projectNavId(project.id))}
          onRestore={(project) => void restoreProject(project)}
          projects={visibleProjects}
          todos={allTodos}
          view={view}
        />
      )}
    </WorkspaceSurfaceFrame>
  );
}
