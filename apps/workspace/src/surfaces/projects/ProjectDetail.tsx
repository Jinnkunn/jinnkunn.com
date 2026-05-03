import { useEffect, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  FileText,
  Link2,
  PanelRightOpen,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import {
  notesSearch,
  type NoteSearchResult,
} from "../../modules/notes/api";
import type {
  ProjectLinkRow,
  ProjectLinkTargetType,
  ProjectRow,
  ProjectStatus,
} from "../../modules/projects/api";
import { projectTodoStats } from "../../modules/projects/model";
import type { TodoRow } from "../../modules/todos/api";
import {
  CONTEXT_MENU_SEPARATOR,
  copyTextToClipboard,
  showContextMenuWithActions,
} from "../../shell/contextMenu";
import {
  WorkspaceCommandButton,
  WorkspaceEmptyState,
  WorkspaceIconButton,
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
  WorkspaceSplitView,
} from "../../ui/primitives";
import {
  dateInputValue,
  formatShortDate,
  linkIsOpenable,
  linkMetaLabel,
  linkTypeLabel,
  linkUrl,
  PROJECT_LINK_TYPES,
  PROJECT_STATUS_OPTIONS,
  statusLabel,
  timestampFromDateInput,
  todoMeta,
  type ProjectLinkDraft,
  type ProjectUpdatePatch,
} from "./projectFormat";

export function ProjectDetailView({
  linkDraft,
  links,
  newTodoTitle,
  onAddLink,
  onArchive,
  onCreateNote,
  onCreateTodo,
  onDeleteLink,
  onLinkDraftChange,
  onOpenNote,
  onOpenTodo,
  onRestore,
  onSetNewTodoTitle,
  onToggleTodo,
  onUpdate,
  project,
  todos,
}: {
  linkDraft: ProjectLinkDraft;
  links: readonly ProjectLinkRow[];
  newTodoTitle: string;
  onAddLink: (event: FormEvent) => void;
  onArchive: () => void;
  onCreateNote: () => void;
  onCreateTodo: () => void;
  onDeleteLink: (link: ProjectLinkRow) => void;
  onLinkDraftChange: (draft: ProjectLinkDraft) => void;
  onOpenNote: (noteId: string) => void;
  onOpenTodo: (todo: TodoRow) => void;
  onRestore: () => void;
  onSetNewTodoTitle: (value: string) => void;
  onToggleTodo: (todo: TodoRow) => void;
  onUpdate: (patch: ProjectUpdatePatch) => void;
  project: ProjectRow;
  todos: readonly TodoRow[];
}) {
  const stats = projectTodoStats(project, todos);
  const openTodos = todos.filter((todo) => todo.completedAt === null);
  const completedTodos = todos.filter((todo) => todo.completedAt !== null);
  const progress =
    stats.totalCount === 0 ? 0 : Math.round((stats.completedCount / stats.totalCount) * 100);

  return (
    <WorkspaceSplitView
      className="projects-detail-split"
      inspector={
        <WorkspaceInspector className="projects-inspector" label="Project details">
          <WorkspaceInspectorHeader
            heading="Project"
            kicker={statusLabel(project.status)}
            actions={
              <WorkspaceIconButton
                aria-label={project.pinnedAt ? "Unpin project" : "Pin project"}
                onClick={() => onUpdate({ pinned: project.pinnedAt === null })}
              >
                {project.pinnedAt ? (
                  <PinOff absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
                ) : (
                  <Pin absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
                )}
              </WorkspaceIconButton>
            }
          />
          <WorkspaceInspectorSection heading="Details">
            <label className="projects-field">
              <span>Status</span>
              <select
                value={project.status}
                onChange={(event) =>
                  onUpdate({ status: event.currentTarget.value as ProjectStatus })
                }
              >
                {PROJECT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="projects-field">
              <span>Due</span>
              <input
                type="date"
                value={dateInputValue(project.dueAt)}
                onChange={(event) =>
                  onUpdate({ dueAt: timestampFromDateInput(event.currentTarget.value) })
                }
              />
            </label>
            <label className="projects-field">
              <span>Description</span>
              <textarea
                key={`${project.id}:description`}
                rows={5}
                defaultValue={project.description}
                onBlur={(event) => {
                  if (event.currentTarget.value !== project.description) {
                    onUpdate({ description: event.currentTarget.value });
                  }
                }}
              />
            </label>
          </WorkspaceInspectorSection>
          <WorkspaceInspectorSection heading="Progress">
            <div className="projects-inspector__metric">
              <strong>{progress}%</strong>
              <span>
                {stats.completedCount}/{stats.totalCount} done
              </span>
            </div>
            <span className="projects-progress">
              <span style={{ width: `${progress}%` }} />
            </span>
          </WorkspaceInspectorSection>
          <WorkspaceInspectorSection heading="Actions">
            <button type="button" className="projects-detail__note" onClick={onCreateNote}>
              <FileText absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
              New note
            </button>
            {project.archivedAt ? (
              <button type="button" className="projects-detail__note" onClick={onRestore}>
                <ArchiveRestore absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
                Restore
              </button>
            ) : (
              <button type="button" className="projects-detail__archive" onClick={onArchive}>
                <Archive absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
                Archive
              </button>
            )}
          </WorkspaceInspectorSection>
        </WorkspaceInspector>
      }
    >
      <section className="projects-detail">
        <header className="projects-detail__header">
          <span className="projects-detail__accent" style={{ background: project.color ?? undefined }} />
          <input
            key={`${project.id}:title`}
            aria-label="Project title"
            className="projects-detail__title"
            defaultValue={project.title}
            onBlur={(event) => {
              if (event.currentTarget.value !== project.title) {
                onUpdate({ title: event.currentTarget.value });
              }
            }}
          />
          <span className="projects-detail__due">{formatShortDate(project.dueAt)}</span>
        </header>

        <section className="projects-detail__section">
          <div className="projects-detail__section-header">
            <h2>Next actions</h2>
            <span>{openTodos.length}</span>
          </div>
          <form
            className="projects-todo-composer"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateTodo();
            }}
          >
            <input
              aria-label="New project todo"
              placeholder="Add next action..."
              value={newTodoTitle}
              onChange={(event) => onSetNewTodoTitle(event.currentTarget.value)}
            />
            <WorkspaceCommandButton
              disabled={!newTodoTitle.trim()}
              tone="accent"
              type="submit"
            >
              Add
            </WorkspaceCommandButton>
          </form>
          <TodoList
            todos={openTodos}
            onOpenTodo={onOpenTodo}
            onToggleTodo={onToggleTodo}
          />
          {completedTodos.length ? (
            <>
              <div className="projects-detail__section-header projects-detail__section-header--subtle">
                <h2>Done</h2>
                <span>{completedTodos.length}</span>
              </div>
              <TodoList
                todos={completedTodos.slice(0, 5)}
                onOpenTodo={onOpenTodo}
                onToggleTodo={onToggleTodo}
              />
            </>
          ) : null}
        </section>

        <section className="projects-detail__section">
          <div className="projects-detail__section-header">
            <h2>Links</h2>
            <span>{links.length}</span>
          </div>
          <ProjectLinkComposer
            linkDraft={linkDraft}
            onAddLink={onAddLink}
            onLinkDraftChange={onLinkDraftChange}
          />
          {links.length ? (
            <ul className="projects-link-list" role="list">
              {links.map((link) => {
                const url = linkUrl(link);
                const openable = linkIsOpenable(link);
                return (
                  <li key={link.id}>
                    <span className="projects-link-list__icon" aria-hidden="true">
                      <Link2 absoluteStrokeWidth size={14} strokeWidth={1.8} />
                    </span>
                    <button
                      type="button"
                      className="projects-link-list__body"
                      disabled={!openable}
                      title={openable ? undefined : "This reference type cannot be opened yet"}
                      onClick={() => {
                        if (!openable) return;
                        if (link.targetType === "note") onOpenNote(link.targetId);
                        else if (url) window.open(url, "_blank", "noopener,noreferrer");
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const entries = [
                          openable && {
                            label: "Open link",
                            run: () => {
                              if (link.targetType === "note") onOpenNote(link.targetId);
                              else if (url) window.open(url, "_blank", "noopener,noreferrer");
                            },
                          },
                          {
                            label: "Copy label",
                            run: () => copyTextToClipboard(link.label),
                          },
                          url && {
                            label: "Copy URL",
                            run: () => copyTextToClipboard(url),
                          },
                          CONTEXT_MENU_SEPARATOR,
                          {
                            label: "Delete link",
                            run: () => onDeleteLink(link),
                          },
                        ].filter(Boolean) as Parameters<
                          typeof showContextMenuWithActions
                        >[0];
                        showContextMenuWithActions(entries);
                      }}
                    >
                      <strong>{link.label}</strong>
                      <small>{linkMetaLabel(link)}</small>
                    </button>
                    {url ? (
                      <ExternalLink absoluteStrokeWidth aria-hidden="true" size={13} strokeWidth={1.8} />
                    ) : null}
                    <WorkspaceIconButton
                      aria-label="Delete link"
                      onClick={() => onDeleteLink(link)}
                    >
                      <Trash2 absoluteStrokeWidth aria-hidden="true" size={13} strokeWidth={1.8} />
                    </WorkspaceIconButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <WorkspaceEmptyState
              className="projects-empty projects-empty--compact"
              compact
              title="No links"
            />
          )}
        </section>
      </section>
    </WorkspaceSplitView>
  );
}

function ProjectLinkComposer({
  linkDraft,
  onAddLink,
  onLinkDraftChange,
}: {
  linkDraft: ProjectLinkDraft;
  onAddLink: (event: FormEvent) => void;
  onLinkDraftChange: (draft: ProjectLinkDraft) => void;
}) {
  const [noteQuery, setNoteQuery] = useState("");
  const [noteChoices, setNoteChoices] = useState<NoteSearchResult[]>([]);
  const [noteLoading, setNoteLoading] = useState(false);
  const noteInputValue = noteQuery || linkDraft.label || "";
  const noteSearchActive = noteQuery.trim().length >= 2;
  const visibleNoteChoices = noteSearchActive ? noteChoices : [];

  useEffect(() => {
    if (linkDraft.type !== "note") return;
    const trimmed = noteQuery.trim();
    if (trimmed.length < 2) {
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setNoteLoading(true);
      notesSearch(trimmed)
        .then((rows) => {
          if (!cancelled) setNoteChoices(rows.slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setNoteChoices([]);
        })
        .finally(() => {
          if (!cancelled) setNoteLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [linkDraft.type, noteQuery]);

  return (
    <form
      className="projects-link-form"
      data-type={linkDraft.type}
      onSubmit={onAddLink}
    >
      <select
        aria-label="Link type"
        value={linkDraft.type}
        onChange={(event) => {
          const type = event.currentTarget.value as ProjectLinkTargetType;
          setNoteQuery("");
          onLinkDraftChange({ label: "", target: "", type });
        }}
      >
        {PROJECT_LINK_TYPES.map((type) => (
          <option key={type} value={type}>
            {linkTypeLabel(type)}
          </option>
        ))}
      </select>
      {linkDraft.type === "note" ? (
        <div className="projects-link-picker">
          <input
            aria-label="Search notes"
            placeholder="Search notes..."
            value={noteInputValue}
            onChange={(event) => {
              setNoteQuery(event.currentTarget.value);
              onLinkDraftChange({ ...linkDraft, label: "", target: "" });
            }}
          />
          <div className="projects-link-picker__results">
            {visibleNoteChoices.length ? (
              visibleNoteChoices.map((note) => (
                <button
                  type="button"
                  aria-pressed={linkDraft.target === note.id}
                  key={note.id}
                  onClick={() => {
                    setNoteQuery(note.title);
                    onLinkDraftChange({
                      label: note.title,
                      target: note.id,
                      type: "note",
                    });
                  }}
                >
                  <strong>{note.title || "Untitled"}</strong>
                  <span>{formatShortDate(note.updatedAt)}</span>
                </button>
              ))
            ) : noteSearchActive && noteLoading ? (
              <span className="projects-link-picker__empty">Searching notes...</span>
            ) : (
              <span className="projects-link-picker__empty">
                {noteQuery.trim().length < 2 ? "Type to search notes." : "No notes found."}
              </span>
            )}
          </div>
        </div>
      ) : (
        <input
          aria-label="Link target"
          placeholder="https://..."
          value={linkDraft.target}
          onChange={(event) =>
            onLinkDraftChange({ ...linkDraft, target: event.currentTarget.value })
          }
        />
      )}
      <input
        aria-label="Link label"
        placeholder="Label"
        value={linkDraft.label}
        onChange={(event) =>
          onLinkDraftChange({ ...linkDraft, label: event.currentTarget.value })
        }
      />
      <WorkspaceCommandButton disabled={!linkDraft.target.trim()} type="submit">
        Link
      </WorkspaceCommandButton>
    </form>
  );
}

function TodoList({
  onOpenTodo,
  onToggleTodo,
  todos,
}: {
  onOpenTodo: (todo: TodoRow) => void;
  onToggleTodo: (todo: TodoRow) => void;
  todos: readonly TodoRow[];
}) {
  if (!todos.length) {
    return (
      <WorkspaceEmptyState
        className="projects-empty projects-empty--compact"
        compact
        title="No todos"
      />
    );
  }
  return (
    <ul className="projects-todo-list" role="list">
      {todos.map((todo) => (
        <li
          key={todo.id}
          data-completed={todo.completedAt ? "true" : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            const completed = todo.completedAt !== null;
            showContextMenuWithActions([
              {
                label: "Open in Todos",
                run: () => onOpenTodo(todo),
              },
              {
                label: completed ? "Mark open" : "Mark done",
                run: () => onToggleTodo(todo),
              },
              CONTEXT_MENU_SEPARATOR,
              {
                label: "Copy title",
                run: () => copyTextToClipboard(todo.title || "(Untitled)"),
              },
            ]);
          }}
        >
          <button
            type="button"
            className="projects-todo-list__check"
            aria-label={todo.completedAt ? "Mark open" : "Mark done"}
            aria-pressed={todo.completedAt !== null}
            onClick={() => onToggleTodo(todo)}
          >
            <span aria-hidden="true" />
          </button>
          <span className="projects-todo-list__body">
            <strong>{todo.title}</strong>
            <small>{todoMeta(todo)}</small>
          </span>
          <PanelRightOpen absoluteStrokeWidth aria-hidden="true" size={14} strokeWidth={1.8} />
        </li>
      ))}
    </ul>
  );
}
