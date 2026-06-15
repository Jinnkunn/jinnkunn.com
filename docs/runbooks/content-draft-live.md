# Content Draft/Live Runbook

The public site is moving toward a CMS-style content model:

- Staging D1 is the Draft workspace.
- Production D1 is the Live content mirror.
- Git is the code source of truth and a backup/export target for content, not the daily content editing path.

## Daily Content Flow

1. Edit content in Site Admin, iOS, Tauri, or MCP.
2. Save writes to staging D1.
3. Publish Draft to staging with:

```bash
npm run publish:content:staging
```

4. After checking staging, publish the same verified content to production:

```bash
npm run publish:content:prod:from-staging
```

This path should not create git commits and should not dirty the repository. It builds any temporary static shell overlay from an ignored release snapshot under `.cache/release`.

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
