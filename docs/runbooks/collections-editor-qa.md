# Collections Editor QA

## Isolated Browser Workflows

After changes to draft persistence, collection operations, editing panels, or release monitoring:

```bash
CONTENT_SYNC_MODE=stubs npm run build
npm run smoke:site-admin:collections
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

## Published Content Verification

The content publisher verifies every unprotected HTML route in the expected static overlay, excluding intentional runtime-only `/blog/list` routes. A 200 response or overlay header alone is not success: the response body SHA-1, ETag, and served asset path must match the exact overlay snapshot. Protected routes remain protected and are skipped.

Retries apply only to failed routes. A mismatch follows the existing publish rollback flow. Copy-from-staging, rollback, and already-current publishes also verify the served snapshot. No content bodies or credentials are logged in verification output.

Run the focused verifier tests with:

```bash
node --test tests/release/overlay-serving-verification.test.mjs
```
