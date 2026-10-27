# Collections Editor QA

## Isolated Browser Workflows

After changes to draft persistence, collection operations, editing panels, or release monitoring:

```bash
CONTENT_SYNC_MODE=stubs npm run build
npm run smoke:site-admin:collections
npm run smoke:site-admin:drafts
npm run smoke:site-admin:followup
```

The test starts a local Next production server with a synthetic administrator session. It simulates the staging hostname to exercise environment-specific publish buttons, but never contacts staging: documents and assets come from localhost, and every admin API request is intercepted by an in-memory transport. Unconfigured API requests and non-GET requests outside that transport fail closed. No real D1 writes, publishing jobs, or production sessions are used.

Covered workflows:

- Teaching academic year/season, term inheritance, trailing spaces, autosave.
- Works cross-group drag, month selection, duplicate/delete/undo/redo.
- Publication author names containing commas and preservation of rich author metadata.
- Incomplete local drafts, refresh recovery, validation, failed saves, optimistic conflicts.
- Failed publishing, retry, success monitoring, captured draft/live snapshots, and saves made while a previous snapshot is being published.
- Desktop and 390px mobile panels, horizontal overflow, modal focus, Escape dismissal.

Screenshots are written to `/tmp/collections-workflow-desktop.png` and `/tmp/collections-workflow-mobile.png`. Browser publishing is simulated; this test does not substitute for deployed D1/static overlay verification.

The follow-up workflow also covers byte-preserving document round trips, unknown
frontmatter and comments, empty descriptions, Save/Discard/Stay navigation,
failed and in-flight saves, semantic version comparisons and explicit restore
confirmation on desktop and mobile. Restoring a revision must not queue a release.

## Real Staging Write Test

Run the read-only preflight first:

```bash
npm run smoke:site-admin:write:staging
```

Only in a clean staging window, with explicit permission for test writes:

```bash
npm run smoke:site-admin:write:staging:execute
```

This creates a uniquely named test post, verifies optimistic conflicts, publishes
through the runner, checks public HTML and search, then deletes and unpublishes
the test post. It refuses production, other pending drafts and active releases.
If the remote runner is unavailable, an explicitly selected local publisher can
exercise the same D1/static overlay pipeline using the live Worker's immutable
source, without deploying the working tree:

```bash
npm run smoke:site-admin:write:staging:execute -- --publisher=local
```

A local pass does not certify remote-runner health. A 302 while reading the
staging build ID, despite successful local authenticated reads, requires checking
the runner's `NEXTAUTH_SECRET` and allowed admin identity against staging. Do not
disable staging authentication or copy production content to work around it.
After any interrupted test, inspect the printed job and post IDs before retrying;
never cancel another user's release or overwrite their drafts.

## Published Content Verification

The content publisher verifies every unprotected HTML route in the expected static overlay, excluding intentional runtime-only `/blog/list` routes. A 200 response or overlay header alone is not success: the response body SHA-1 and served asset path must match the exact overlay snapshot. An ETag, when present, must also match (weak ETags are accepted). CDNs may omit ETags, so their absence does not override the actual byte verification. Protected routes remain protected and are skipped.

Retries apply only to failed routes. A mismatch follows the existing publish rollback flow. Copy-from-staging, rollback, and already-current publishes also verify the served snapshot. No content bodies or credentials are logged in verification output.

Run the focused verifier tests with:

```bash
node --test tests/release/overlay-serving-verification.test.mjs
```
## Release Acceptance Additions

- CI runs collections, draft safety and follow-up browser suites serially, then
  `node scripts/qa/public-acceptance-workflow.mjs`. All mutations use isolated
  fixtures; the public suite performs GET requests only. Failure screenshots
  are captured under `/tmp` and uploaded by CI.
- Media deletion checks saved drafts and published baselines in **both** D1
  environments because staging and production share the same R2 bucket.
  An unavailable database/baseline or malformed source disables deletion.
  References in the media library are informational; DELETE always rechecks.
- Image descriptions are contextual: the media library's Copy image Markdown
  action includes the supplied alt text in the document, not a global label
  applied to every reuse of the image.
- A staging write/publish round trip remains an explicit operator action:
  `npm run smoke:site-admin:write:staging -- --execute`. It creates a unique
  fixture, publishes through the remote runner, verifies HTML/search, removes
  that fixture using CAS, and republishes the deletion. Never run against
  production or while unrelated draft changes are pending.
