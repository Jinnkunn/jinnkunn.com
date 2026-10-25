# Content Draft/Live Runbook

Code and content have separate release paths:

- Each environment's D1 is its saved-content workspace. Saving there does not publish.
- The public site serves a published static overlay, with the code build's static shell as its fallback.
- Git is the code source of truth and a backup/export target for content, not the daily content editing path.

## Daily Content Flow

1. Edit content in Site Admin, iOS, Tauri, or MCP.
2. Save writes a draft to the active environment's D1. Home, Now, announcements, documents, collections, moves, deletions, and history restores all follow this rule.
3. In the web console, open **Review publication**. It compares all saved site content with the published source snapshot, including edits from other sessions. Confirm only after checking additions, edits, moves, and deletions.
4. The review SHA is checked both before queueing and after the runner dumps D1. A changed snapshot must be reviewed again; newer drafts saved during the build remain pending.

The browser console autosaves Home, Now, announcements, posts, pages, and collections to drafts. A recovery copy is kept on the current device and is scoped to the signed-in author. Failed saves pause until a retry or network reconnection. Restoring a copy based on an older server version requires explicit review and a manual save; it never silently replaces the server draft. Now current-status edits update one history row rather than recording every autosave as a new update.

Publication review shows collection additions/removals, field changes, and affected routes. Full JSON/MDX remains available under **Advanced source comparison**. Review still covers all saved content, not a selected subset.

Content lists use the review's inventory for pending-publication and validation states. Recently modified means the last 30 days of storage write timestamps, never a post's publication date. Filtering Pages preserves contextual ancestors and their human titles. Pins are device-local preferences scoped to the signed-in author; they do not modify content or publish anything.

Invalid documents remain visible in the inventory even if their normal metadata cannot be parsed. Their authenticated `?raw=1` read keeps the original source and version available for repair. Source-only repairs keep local recovery but require explicit Save; normal version checks still apply. Collection list problems and field errors use the same framework-free validation models.

Page preview uses the current editor source and a published site-context snapshot. It includes the matching announcement and monochrome setting, plus explicit desktop/mobile and light/dark controls. An announcement preview substitutes the unsaved announcement without changing its saved status. Preview is script-free; unsupported MDX is labeled approximate, failed refreshes keep the previous preview, and closing restores editor scroll/focus. No preview queues publication.

Blog posts with at least 600 words and three H2/H3 headings expose an inline collapsible outline. Targets come from the compiled heading IDs, not a second Markdown slugger. The existing anchor behavior handles keyboard focus and reduced motion; the active section follows scrolling, including the last section near the page bottom.

For an explicitly authorized CLI publication to staging:

```bash
npm run publish:content:staging
```

Routine production content edits do not need a staging code release. Publish production D1 to the production static overlay with:

```bash
npm run publish:content:prod
```

Use this only when intentionally promoting verified staging content to production, rather than publishing production's own saved drafts:

```bash
npm run publish:content:prod:from-staging
```

This path should not create git commits and should not dirty the repository. It builds any temporary static shell overlay from an ignored release snapshot under `.cache/release`.

## Validation and QA

Incomplete titles, dates and bodies can be saved as drafts without replacement text or an invented date. Malformed frontmatter and unsafe image references remain save errors. Publication checks the complete saved snapshot: incomplete public content blocks release, while incomplete hidden documents and draft announcements only warn. The API and runner repeat the check; direct CLI publishes and code promotions cannot bypass it.

Page preview shares the public article/page presenters, including metadata, breadcrumbs, headings and neighbouring posts. It reads reusable blocks from the published snapshot, replacing only the explicitly previewed collection. MDX previews accept literal data, not executable JavaScript. Unsupported content is labeled approximate.

- `npm run smoke:site-admin:write:local` runs an isolated in-memory SQLite database through the real D1 adapter, document repository and release queue. It covers conflicts, validation, failed-runner retry and HTML/search snapshots without network access.
- `npm run smoke:site-admin:write:staging` checks staging readiness without writing.
- `npm run smoke:site-admin:write:staging:execute` requires an explicitly authorized staging test window. It refuses any pre-existing pending drafts or active release, creates one uniquely named test post, verifies publication/search and removes it using its own version token. If another session edits or an uncertain runner remains active, it stops instead of publishing unrelated content or deleting another version. Inspect the reported post/job before retrying.
- Production is not a permitted write-smoke target. Ordinary production releases continue through the guarded manual paths.
- `node scripts/content/validate-publication.mjs --env=staging` (or `production`) dumps into a temporary directory and validates without writing remote content. `--root=.` validates the local snapshot.

## Published Content Reads

Public routes such as `/`, `/blog`, `/publications`, `/news`, `/works`, `/teaching`, `/bio`, and `/pages/*` use prerendered HTML. They do not read unreviewed drafts on each visit. This keeps the public path within the Workers Free CPU budget.

- `/api/public/now` reads only the published `now.json` source, not the saved draft.
- `/api/search` reads the search index attached to the same private publication-baseline row. Its `x-publication-snapshot` header is checked after content publication. Hidden/protected/removed routes cannot return via an old route manifest. An overlay with a missing or mismatched search snapshot fails explicitly rather than silently serving stale results; use the guarded code release and republish content when upgrading an older overlay.
- The legacy `publish:now:prod:from-staging` command copies only the saved Now draft; follow it with a production publication review. It no longer changes the public feed merely by copying D1.
- Publishing stores a private `/__admin/publication-baseline.json` row in `static_shell_overlays`; the Worker returns 404 for `/__admin/*`. This row is never exported into public assets or included in public-route verification.
- Overlay backups and rollbacks include that row, so the review baseline follows the restored content.
- A full code release replaces the overlay and uses the generated build snapshot as the baseline.

Calendar observations and security/access controls retain their dedicated runtime behavior; they are not ordinary publication drafts. Preview rendering is read-only and does not publish or execute client-only blocks.

## Code Release Flow

Use code release only when code, styles, components, build config, or runtime behavior changed:

```bash
npm run release:staging
npm run release:prod:from-staging
```

Staging release also builds from staging D1 content, but does so inside a release snapshot. It should not dump D1 content into the repository root.

## Backup D1 Content to Git

Only use this when intentionally exporting Draft content into git for backup/review:

```bash
npm run release:staging:sync-git
```

or, for content overlay publishing:

```bash
npm run publish:content:staging:sync-git
```

These commands may create and push content commits. They are recovery/backup tools, not the default publishing path.
