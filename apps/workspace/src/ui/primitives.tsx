import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function joinClassNames(
  ...items: Array<string | false | null | undefined>
): string {
  return items.filter(Boolean).join(" ");
}

export interface WorkspaceIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  tone?: "default" | "danger" | "accent";
}

export function WorkspaceIconButton({
  className,
  tone = "default",
  type = "button",
  ...props
}: WorkspaceIconButtonProps) {
  return (
    <button
      className={joinClassNames(
        "workspace-icon-button",
        tone !== "default" && `workspace-icon-button--${tone}`,
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export interface WorkspaceToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function WorkspaceToolbar({
  className,
  label = "Actions",
  role = "toolbar",
  ...props
}: WorkspaceToolbarProps) {
  return (
    <div
      aria-label={label}
      className={joinClassNames("workspace-toolbar", className)}
      role={role}
      {...props}
    />
  );
}

export interface WorkspaceCommandBarProps extends HTMLAttributes<HTMLElement> {
  center?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function WorkspaceCommandBar({
  center,
  children,
  className,
  leading,
  trailing,
  ...props
}: WorkspaceCommandBarProps) {
  return (
    <header
      className={joinClassNames("workspace-commandbar", className)}
      {...props}
    >
      <div className="workspace-commandbar__leading">{leading}</div>
      <div className="workspace-commandbar__center">{center}</div>
      <div className="workspace-commandbar__trailing" data-window-drag-exclude>
        {trailing}
      </div>
      {children}
    </header>
  );
}

export interface WorkspaceCommandGroupProps
  extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
}

export function WorkspaceCommandGroup({
  align = "start",
  className,
  ...props
}: WorkspaceCommandGroupProps) {
  return (
    <div
      className={joinClassNames("workspace-commandbar__group", className)}
      data-align={align}
      {...props}
    />
  );
}

export interface WorkspaceCommandButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "default" | "ghost" | "accent" | "danger";
}

export function WorkspaceCommandButton({
  className,
  tone = "default",
  type = "button",
  ...props
}: WorkspaceCommandButtonProps) {
  return (
    <button
      className={joinClassNames(
        "workspace-commandbar__button",
        tone !== "default" && `workspace-commandbar__button--${tone}`,
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export interface WorkspacePaneProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  label?: string;
  role?: string;
}

export function WorkspacePane({
  children,
  className,
  label,
  role,
  ...props
}: WorkspacePaneProps) {
  const Element = role ? "section" : "div";
  return (
    <Element
      aria-label={label}
      className={joinClassNames("workspace-pane", className)}
      role={role}
      {...props}
    >
      {children}
    </Element>
  );
}

export interface WorkspaceSplitViewProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  inspector?: ReactNode;
  sidebar?: ReactNode;
}

export function WorkspaceSplitView({
  children,
  className,
  inspector,
  sidebar,
  ...props
}: WorkspaceSplitViewProps) {
  return (
    <div
      className={joinClassNames("workspace-split-view", className)}
      data-has-inspector={inspector ? "true" : undefined}
      data-has-sidebar={sidebar ? "true" : undefined}
      {...props}
    >
      {sidebar ? (
        <WorkspacePane
          className="workspace-split-view__sidebar"
          label="Sidebar"
        >
          {sidebar}
        </WorkspacePane>
      ) : null}
      <WorkspacePane className="workspace-split-view__detail" label="Detail">
        {children}
      </WorkspacePane>
      {inspector ? (
        <WorkspacePane
          className="workspace-split-view__inspector"
          label="Inspector"
        >
          {inspector}
        </WorkspacePane>
      ) : null}
    </div>
  );
}

export interface WorkspaceSheetProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  open?: boolean;
  placement?: "right" | "bottom";
}

export function WorkspaceSheet({
  children,
  className,
  open = true,
  placement = "right",
  ...props
}: WorkspaceSheetProps) {
  return (
    <div
      className={joinClassNames("workspace-sheet", className)}
      data-open={open ? "true" : "false"}
      data-placement={placement}
      {...props}
    >
      {children}
    </div>
  );
}

export function WorkspaceBottomSheet(props: Omit<WorkspaceSheetProps, "placement">) {
  return <WorkspaceSheet placement="bottom" {...props} />;
}

export interface WorkspaceActionMenuProps
  extends HTMLAttributes<HTMLDetailsElement> {
  label: ReactNode;
}

export function WorkspaceActionMenu({
  children,
  className,
  label,
  ...props
}: WorkspaceActionMenuProps) {
  return (
    <details className={joinClassNames("workspace-action-menu", className)} {...props}>
      <summary className="workspace-action-menu__trigger">{label}</summary>
      <div className="workspace-action-menu__popover" role="menu">
        {children}
      </div>
    </details>
  );
}

export interface WorkspaceSegmentedControlOption<T extends string> {
  label: ReactNode;
  value: T;
}

export interface WorkspaceSegmentedControlProps<T extends string>
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  label: string;
  onChange: (value: T) => void;
  options: readonly WorkspaceSegmentedControlOption<T>[];
  value: T;
}

export function WorkspaceSegmentedControl<T extends string>({
  className,
  label,
  onChange,
  options,
  value,
  ...props
}: WorkspaceSegmentedControlProps<T>) {
  return (
    <div
      aria-label={label}
      className={joinClassNames("workspace-segmented-control", className)}
      role="tablist"
      {...props}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            aria-selected={active}
            data-active={active ? "true" : undefined}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="tab"
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface WorkspacePopoverProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const WorkspacePopover = forwardRef<HTMLDivElement, WorkspacePopoverProps>(
  function WorkspacePopover({ className, children, ...props }, ref) {
    return (
      <div
        className={joinClassNames("workspace-popover", className)}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  },
);

export interface WorkspaceFormRowProps extends HTMLAttributes<HTMLLabelElement> {
  label: string;
  hint?: ReactNode;
}

export function WorkspaceFormRow({
  className,
  children,
  hint,
  label,
  ...props
}: WorkspaceFormRowProps) {
  return (
    <label className={joinClassNames("workspace-form-row", className)} {...props}>
      <span className="workspace-form-row__label">{label}</span>
      {children}
      {hint ? <span className="workspace-form-row__hint">{hint}</span> : null}
    </label>
  );
}

export interface WorkspaceTextFieldProps
  extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function WorkspaceTextField({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: WorkspaceTextFieldProps) {
  return (
    <WorkspaceFormRow hint={hint} label={label} className={wrapperClassName}>
      <input className={joinClassNames("ds-input", className)} {...props} />
    </WorkspaceFormRow>
  );
}

export interface WorkspaceTextareaFieldProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function WorkspaceTextareaField({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: WorkspaceTextareaFieldProps) {
  return (
    <WorkspaceFormRow hint={hint} label={label} className={wrapperClassName}>
      <textarea className={joinClassNames("ds-input", className)} {...props} />
    </WorkspaceFormRow>
  );
}

export interface WorkspaceSelectFieldProps
  extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function WorkspaceSelectField({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: WorkspaceSelectFieldProps) {
  return (
    <WorkspaceFormRow hint={hint} label={label} className={wrapperClassName}>
      <select className={joinClassNames("ds-input", className)} {...props} />
    </WorkspaceFormRow>
  );
}

export interface WorkspaceCheckboxFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  children: ReactNode;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function WorkspaceCheckboxField({
  children,
  className,
  hint,
  wrapperClassName,
  ...props
}: WorkspaceCheckboxFieldProps) {
  return (
    <label
      className={joinClassNames("workspace-checkbox-field", wrapperClassName)}
    >
      <span className="workspace-checkbox-field__control">
        <input
          className={className}
          type="checkbox"
          {...props}
        />
      </span>
      <span className="workspace-checkbox-field__body">
        <span className="workspace-checkbox-field__label">{children}</span>
        {hint ? <span className="workspace-checkbox-field__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export interface WorkspaceStatusBannerProps
  extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "muted" | "success" | "warn" | "error";
}

export function WorkspaceStatusBanner({
  className,
  role = "status",
  tone = "default",
  ...props
}: WorkspaceStatusBannerProps) {
  return (
    <div
      aria-live={role === "status" ? "polite" : undefined}
      className={joinClassNames(
        "workspace-status-banner",
        `workspace-status-banner--${tone}`,
        className,
      )}
      role={role}
      {...props}
    />
  );
}

export interface WorkspaceMainProps extends HTMLAttributes<HTMLElement> {
  label: string;
}

export function WorkspaceMain({
  children,
  className,
  label,
  ...props
}: WorkspaceMainProps) {
  return (
    <main
      aria-label={label}
      className={joinClassNames("workspace-main", className)}
      {...props}
    >
      {children}
    </main>
  );
}

export interface WorkspaceContentLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  inspector?: ReactNode;
  sidebar?: ReactNode;
}

export function WorkspaceContentLayout({
  children,
  className,
  inspector,
  sidebar,
  ...props
}: WorkspaceContentLayoutProps) {
  return (
    <div
      className={joinClassNames("workspace-content-layout", className)}
      data-has-inspector={inspector ? "true" : undefined}
      data-has-sidebar={sidebar ? "true" : undefined}
      {...props}
    >
      {sidebar ? <aside className="workspace-content-layout__sidebar">{sidebar}</aside> : null}
      <div className="workspace-content-layout__main">{children}</div>
      {inspector ? (
        <aside className="workspace-content-layout__inspector">{inspector}</aside>
      ) : null}
    </div>
  );
}

export interface WorkspaceSurfaceFrameProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function WorkspaceSurfaceFrame({
  children,
  className,
  ...props
}: WorkspaceSurfaceFrameProps) {
  return (
    <section
      className={joinClassNames("workspace-surface-frame", className)}
      {...props}
    >
      {children}
    </section>
  );
}

export interface WorkspaceSurfaceHeaderProps extends HTMLAttributes<HTMLElement> {
  actions?: ReactNode;
  description?: ReactNode;
  heading: ReactNode;
}

export function WorkspaceSurfaceHeader({
  actions,
  className,
  description,
  heading,
  ...props
}: WorkspaceSurfaceHeaderProps) {
  return (
    <header
      className={joinClassNames("workspace-surface-header", className)}
      {...props}
    >
      <div className="workspace-surface-header__titleblock">
        <h1 className="workspace-surface-header__title">{heading}</h1>
        {description ? (
          <p className="workspace-surface-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="workspace-surface-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}

export interface WorkspaceInspectorProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  label?: string;
}

export function WorkspaceInspector({
  children,
  className,
  label = "Inspector",
  ...props
}: WorkspaceInspectorProps) {
  return (
    <aside
      aria-label={label}
      className={joinClassNames("workspace-inspector", className)}
      {...props}
    >
      {children}
    </aside>
  );
}

export interface WorkspaceInspectorHeaderProps
  extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
  kicker?: ReactNode;
  heading: ReactNode;
}

export function WorkspaceInspectorHeader({
  actions,
  className,
  heading,
  kicker,
  ...props
}: WorkspaceInspectorHeaderProps) {
  return (
    <div
      className={joinClassNames("workspace-inspector__header", className)}
      {...props}
    >
      <div className="workspace-inspector__titleblock">
        {kicker ? <span className="workspace-inspector__kicker">{kicker}</span> : null}
        <strong className="workspace-inspector__title">{heading}</strong>
      </div>
      {actions ? (
        <div className="workspace-inspector__actions">{actions}</div>
      ) : null}
    </div>
  );
}

export interface WorkspaceInspectorSectionProps
  extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  description?: ReactNode;
  heading?: ReactNode;
}

export function WorkspaceInspectorSection({
  children,
  className,
  description,
  heading,
  ...props
}: WorkspaceInspectorSectionProps) {
  return (
    <section
      className={joinClassNames("workspace-inspector__section", className)}
      {...props}
    >
      {heading || description ? (
        <header className="workspace-inspector__section-head">
          {heading ? <h3>{heading}</h3> : null}
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface WorkspaceSidebarRowProps extends HTMLAttributes<HTMLDivElement> {
  depth?: number;
  dragging?: boolean;
  dragOver?: boolean;
  selected?: boolean;
}

export function WorkspaceSidebarRow({
  className,
  depth,
  dragging,
  dragOver,
  selected,
  style,
  ...props
}: WorkspaceSidebarRowProps) {
  const rowStyle =
    depth === undefined
      ? style
      : ({ ...style, ["--sidebar-depth" as string]: depth } as CSSProperties);
  return (
    <div
      className={joinClassNames("workspace-sidebar-row", className)}
      data-dragging={dragging ? "true" : undefined}
      data-drag-over={dragOver ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      style={rowStyle}
      {...props}
    />
  );
}
