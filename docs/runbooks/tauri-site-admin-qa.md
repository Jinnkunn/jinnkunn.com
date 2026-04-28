# Tauri Site Admin QA Runbook

## Scope

Use this runbook before requesting production promotion for changes that touch
the Tauri workspace, Site Admin APIs, public preview rendering, editor flows, or
asset uploads.

This runbook is staging-first. Production must remain unchanged unless the
release owner explicitly approves promotion.

## Automated Preflight

Run from a clean `main` checkout after the release candidate has been deployed
to staging:

```bash
git switch main
git pull --ff-only
git status --short
npm run qa:workspace:site-admin:local
npm run qa:workspace:site-admin:staging
```

Expected:

- `git status --short` prints nothing.
- Local QA builds the workspace, runs workspace tests, and runs workspace UI
  guardrails.
- Staging QA verifies authenticated public routes, Site Admin read APIs, asset
  upload smoke, and the production guard.
- `/api/site-admin/status` returns `pendingDeploy=false` on staging.
- `/api/site-admin/preview/home` returns real `/_next/static/css/*.css`
  stylesheets.

For one full local plus remote pass, use:

```bash
npm run qa:workspace:site-admin
```

## Manual Acceptance Checklist

Run the desktop app against staging and record pass/fail notes for each item.

### Connection And Shell

- Confirm native macOS window controls do not overlap the sidebar header, app
  rail, or context header.
- Drag the window from the titlebar, the traffic-light strip, and the sidebar
  context header; the app should move from each region.
- Confirm the connection pill shows the staging profile and signed-in state.
- Switch to the Production profile and confirm Site Admin shows a read-only
  environment badge plus a "Switch to Staging" action; Save/Delete/Publish
  controls must be disabled or blocked before any GitHub write is attempted.
- Click "Switch to Staging" from a Production read-only banner and confirm the
  profile changes without losing the selected sidebar item.
- Switch between Site Admin tabs; titlebar breadcrumbs and sidebar selection
  must stay aligned.
- Toggle light/dark theme; editor panels and preview surfaces must remain
  legible.
- Open the Workspace surface from the app rail. Confirm the dashboard shows
  Launch, Tools, Recent, Pinned, and Activity sections without forcing any
  Site Admin connection.
- Open the Site Admin command palette with `⌘K` and confirm core Site Admin
  commands are discoverable.
- Open the global workspace command palette with `⌘⇧K`; confirm surfaces,
  recent items, pinned shortcuts, and page titles are searchable.
- In the global workspace command palette, confirm Quick Actions appear before
  the full navigation index and can open Site Status, Home Editor, and Shared
  Content.
- Confirm the titlebar workspace status center opens, shows the active surface,
  recent count, pinned count, recent activity, and does not interfere with
  titlebar drag outside the popover trigger.
- Open several pages/posts, then confirm Recent appears in the sidebar and the
  global command palette can jump back to those entries.
- Trigger a Site Admin success/warn/error message and confirm it appears in the
  titlebar Activity popover and the Workspace dashboard Activity list.
- Clear Activity from the Workspace dashboard or command palette and confirm
  the titlebar Activity popover reflects the cleared state.

### Home WYSIWYG Editor

- Open Home and confirm it uses the shared MDX document editor with Write,
  Source, and Preview modes.
- Add Hero, Columns, Link list, Featured pages, regular text, and image blocks.
- Reorder blocks in the Write canvas; preview order must update immediately.
- Edit text inline in the canvas, then switch to Source and back without losing
  unsupported MDX.
- Type `/` in an empty text block; ArrowUp/ArrowDown should move the active
  slash-menu command and Enter should choose the highlighted command.
- Select inline text and confirm the floating format toolbar remains compact
  while Bold, Link, Icon Link, Upload Icon, and Color are discoverable.
- Save, reload the app, and confirm `content/home.json` round-trips as title +
  bodyMdx. The saved state should read "Saved to source branch" until Publish
  runs.

### Post And Page Editors

- Open one existing blog post and one existing page.
- Edit title, description/frontmatter, and body content.
- Confirm the Page properties drawer exposes routing/protection and SEO for the
  public `/<slug>` path.
- Use the shared MDX editor in Write mode, Source mode, and Preview mode.
- Confirm unsupported raw MDX, code fences, tables, lists, callouts, and links
  remain editable and serializable.
- Drag an image into the editor; the drop target should show clear visual
  feedback before upload.
- Save, reload, and confirm the body content round-trips.
- Simulate a stale edit conflict on a disposable page. Confirm the conflict
  banner offers "Copy current MDX" and "Reload latest", and that Reload latest
  preserves the current edit as a local draft before fetching remote content.

### Publish And Recovery

- Save a small staging-only change and confirm the success message says it was
  saved to the source branch and still needs staging publish.
- Open Publish, confirm deploy preview lists added/removed/changed pages,
  redirects, protected routes, and shared content.
- If the preview reports a stale Worker candidate, confirm the recovery card
  exposes Recheck, Open Deploy Action, and Copy release command.
- Open Status and confirm stale candidate recovery exposes the same actions.
- Confirm Deploy/Publish stays disabled in Production and points back to the
  staging-first workflow.

### Asset Library

- Upload a new image through the Asset Library.
- Confirm the returned URL is on the configured CDN/R2 path, not bundled into
  the site build.
- Select a recent upload, set alt text and caption, save, reload, and confirm
  preview still uses the saved asset URL.
- Delete only a disposable test asset after confirming version conflict handling
  works.

### Drafts And Version History

- Create a local draft, close or reload the app, restore it, then dismiss it.
- Save a small change, open Version History, and confirm previous versions are
  readable.
- Restore only a disposable test revision; verify the app makes the restore
  action explicit before writing.

### Public Preview

- Confirm Home preview typography, paragraph rhythm, links, and inline icons
  match the current public Notion/classic style.
- Confirm Post and Page preview heading links inherit heading color.
- Confirm Home profile image loads from the CDN URL directly.
- Confirm preview iframe styles are loaded from `/_next/static/css/*.css`.

### Page Tree

- Confirm Home contains Blog plus the standalone page tree in the sidebar.
- Create a root page and a nested page; reload the app and confirm the order is
  stable.
- Rename or reparent a disposable page; confirm the page tree remains stable
  after refresh.

## Evidence Template

```markdown
## Tauri Site Admin QA

- Source SHA:
- Staging Worker version:
- Tester:
- Date:

### Automated

- `npm run qa:workspace:site-admin:local`:
- `npm run qa:workspace:site-admin:staging`:

### Manual

- Connection and shell:
- Home WYSIWYG editor:
- Post and Page editors:
- Asset Library:
- Drafts and Version History:
- Public Preview:
- Publish and recovery:

### Notes / Follow-ups

-
```

## Stop Conditions

Do not request production promotion if any of these fail:

- Home editor save/reload changes content unexpectedly.
- Post/Page source mode drops unsupported MDX.
- Asset uploads return local build-bundled paths for new media.
- Staging public routes return non-`200` for authenticated checks.
- `/api/site-admin/status` reports `pendingDeploy=true`.
- Production guard reports a version different from the protected baseline.
