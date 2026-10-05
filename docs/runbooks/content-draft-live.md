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

## Published Content Reads

Public routes such as `/`, `/blog`, `/publications`, `/news`, `/works`, `/teaching`, `/bio`, and `/pages/*` use prerendered HTML. They do not read unreviewed drafts on each visit. This keeps the public path within the Workers Free CPU budget.

- `/api/public/now` reads only the published `now.json` source, not the saved draft.
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
