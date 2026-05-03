import type { ReactNode } from "react";
import { ArchiveRestore } from "lucide-react";

import type { ProjectRow } from "../../modules/projects/api";
import {
  filterProjects,
  projectTodoStats,
  projectsDueSoon,
  projectsNeedingAttention,
  recentProjects,
} from "../../modules/projects/model";
import type { TodoRow } from "../../modules/todos/api";
import {
  copyTextToClipboard,
  showContextMenuWithActions,
} from "../../shell/contextMenu";
import { WorkspaceEmptyState } from "../../ui/primitives";
import {
  attentionReasonLabel,
  formatShortDate,
  statusLabel,
  type ProjectView,
} from "./projectFormat";

export function ProjectsHome({
  onOpenProject,
  onProjectContextMenu,
  projects,
  todos,
}: {
  onOpenProject: (project: ProjectRow) => void;
  onProjectContextMenu?: (project: ProjectRow) => void;
  projects: readonly ProjectRow[];
  todos?: readonly TodoRow[];
}) {
  const attention = projectsNeedingAttention(projects, todos);
  const dueSoon = projectsDueSoon(projects);
  const recent = recentProjects(projects);
  const active = filterProjects(projects, "active");

  return (
    <section className="projects-home">
      <ProjectSection
        label="Needs attention"
        projects={attention.map((item) => item.project)}
        renderMeta={(project) =>
          attentionReasonLabel(
            attention.find((item) => item.project.id === project.id)?.reason ??
              "noNextAction",
          )
        }
        todos={todos}
        onOpenProject={onOpenProject}
        onProjectContextMenu={onProjectContextMenu}
      />
      <ProjectSection
        label="Active projects"
        projects={active}
        todos={todos}
        onOpenProject={onOpenProject}
        onProjectContextMenu={onProjectContextMenu}
      />
      <ProjectSection
        label="Due soon"
        projects={dueSoon}
        renderMeta={(project) => formatShortDate(project.dueAt)}
        todos={todos}
        onOpenProject={onOpenProject}
        onProjectContextMenu={onProjectContextMenu}
      />
      <ProjectSection
        label="Recent"
        projects={recent}
        renderMeta={(project) => formatShortDate(project.updatedAt)}
        todos={todos}
        onOpenProject={onOpenProject}
        onProjectContextMenu={onProjectContextMenu}
      />
    </section>
  );
}

export function ProjectsListView({
  emptyLabel,
  onOpenProject,
  onProjectContextMenu,
  onRestore,
  projects,
  todos,
  view,
}: {
  emptyLabel: string;
  onOpenProject: (project: ProjectRow) => void;
  onProjectContextMenu?: (project: ProjectRow) => void;
  onRestore: (project: ProjectRow) => void;
  projects: readonly ProjectRow[];
  todos?: readonly TodoRow[];
  view: ProjectView;
}) {
  if (!projects.length) {
    return <WorkspaceEmptyState className="projects-empty" title={emptyLabel} />;
  }
  return (
    <section className="projects-list-view">
      {projects.map((project) => (
        <ProjectCard
          action={
            view === "archived" ? (
              <button
                type="button"
                className="projects-card__restore"
                onClick={(event) => {
                  event.stopPropagation();
                  onRestore(project);
                }}
              >
                <ArchiveRestore absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
                Restore
              </button>
            ) : null
          }
          key={project.id}
          onOpen={() => onOpenProject(project)}
          onContextMenu={() => onProjectContextMenu?.(project)}
          project={project}
          todos={todos}
        />
      ))}
    </section>
  );
}

function ProjectSection({
  label,
  onOpenProject,
  onProjectContextMenu,
  projects,
  renderMeta,
  todos,
}: {
  label: string;
  onOpenProject: (project: ProjectRow) => void;
  onProjectContextMenu?: (project: ProjectRow) => void;
  projects: readonly ProjectRow[];
  renderMeta?: (project: ProjectRow) => string;
  todos?: readonly TodoRow[];
}) {
  return (
    <section className="projects-panel">
      <div className="projects-panel__header">
        <h2>{label}</h2>
        <span>{projects.length}</span>
      </div>
      {projects.length ? (
        <div className="projects-card-grid">
          {projects.slice(0, 6).map((project) => (
            <ProjectCard
              key={project.id}
              meta={renderMeta?.(project)}
              onOpen={() => onOpenProject(project)}
              onContextMenu={() => onProjectContextMenu?.(project)}
              project={project}
              todos={todos}
            />
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState
          className="projects-empty projects-empty--compact"
          compact
          title="None"
        />
      )}
    </section>
  );
}

function ProjectCard({
  action,
  meta,
  onOpen,
  onContextMenu,
  project,
  todos,
}: {
  action?: ReactNode;
  meta?: string;
  onOpen: () => void;
  onContextMenu?: () => void;
  project: ProjectRow;
  todos?: readonly TodoRow[];
}) {
  const stats = projectTodoStats(project, todos);
  const progress =
    stats.totalCount === 0 ? 0 : Math.round((stats.completedCount / stats.totalCount) * 100);
  return (
    <button
      type="button"
      className="projects-card"
      data-status={project.status}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        if (onContextMenu) {
          onContextMenu();
          return;
        }
        showContextMenuWithActions([
          { label: "Open project", run: onOpen },
          {
            label: "Copy title",
            run: () => copyTextToClipboard(project.title),
          },
        ]);
      }}
    >
      <span className="projects-card__accent" style={{ background: project.color ?? undefined }} />
      <span className="projects-card__body">
        <span className="projects-card__topline">
          <strong>{project.title}</strong>
          <small>{meta ?? statusLabel(project.status)}</small>
        </span>
        <span className="projects-card__meta">
          {stats.nextTodo
            ? stats.nextTodo.title
            : stats.openCount > 0
              ? "Next actions pending"
              : "No next action"}
        </span>
        <span className="projects-progress" aria-label={`${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </span>
      </span>
      <span className="projects-card__count">{stats.openCount}</span>
      {action}
    </button>
  );
}
