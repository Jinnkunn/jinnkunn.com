# Calendar Observation Sync

The collector writes to staging. That request only reports success after the
same observation revision, or a newer staging revision, is confirmed in Live.
The mirror updates only calendar observation state, projection exclusions,
and the revision receipt. The public projection still exposes those observations as `Busy`.

## Rollout

Before releasing the Worker that uses `calendar_observation_revision`, apply
[`011_calendar_observation_revision.sql`](../../migrations/011_calendar_observation_revision.sql)
to **both** the staging and production `SITE_ADMIN_DB` databases. Use the
normal D1 migration and [release](./production-promotion.md) procedures. The
migration is additive and idempotent; it does not change existing events.
The first verified mirror reconciles data left by the old publisher.

For scoped Docs snapshots, apply [`012_calendar_projection_exclusions.sql`](../../migrations/012_calendar_projection_exclusions.sql)
to both databases before deploying the website code that writes exclusions.
Update Docs after the website rollout and verify one full sync. Existing clients
can keep sending snapshots without scope declarations; those do not supersede
any other collector's records.

## Complete Calendar Scope

- Docs includes `sources[].syncScope.completeCalendarIds` on complete snapshots
  after EventKit confirms all selected calendars were readable. Selected IDs are
  included even if they returned no events. An omitted calendar is not an empty scan.
- A complete scope can supersede an old Workspace/iOS observation only when its
  provider, account ID, and calendar ID match and its whole interval was covered.
  The old observation remains in the database. Exclusions persist when the sync
  window rolls forward or an older collector replays the same occurrence.
- The same projection also removes exact Busy copies in older public snapshots.
  A match requires a known old event ID, start, end, and all-day flag. Overlap by
  itself does not remove an occurrence, and explicitly published detail is not
  affected. Exclusion evidence stays server-side.
- Test a reschedule and an empty selected calendar, with an overlapping event
  from a separate calendar. Confirm the same changes on the website, JSON, and
  ICS before retiring any old collector. Do not bulk-delete unverified events.

## Diagnose and Retry

- `503 LIVE_DB_NOT_CONFIGURED`: the write did not start. Use the authenticated
  staging API, where `SITE_ADMIN_DB_LIVE` is bound to the production database.
- `502 LIVE_DB_WRITE_FAILED` with `stagingSaved: true`: staging committed, but
  Live did not confirm the update. After resolving the error, retry the mirror
  via authenticated `POST /api/site-admin/calendar-observations/publish-live`
  on staging. This requires no new device upload or site release.
- To compare the databases without opening private calendar records, query
  `SELECT revision, updated_at FROM calendar_observation_revision WHERE id = 1`
  in each. A non-null `updated_at` on Live records a verified mirror. If Live
  has a higher revision than staging, check for a staging restore or incorrect
  binding before attempting any manual repair.
- Docs settings distinguish local sync, the last batch accepted by staging for
  this Mac, and the verified Live receipt. The authenticated read is
  `GET /api/site-admin/calendar-observations?view=publication&collectorId=...`.
  It returns revisions and timestamps, not events. **Retry Live only** checks
  the receipt again and posts with `?revision=<staging revision>`. A changed
  revision returns `409 CALENDAR_REVISION_CHANGED`; refresh before retrying.
  This path does not read EventKit or upload a second snapshot.
- Verify the public JSON and ICS feeds after their cache windows. Use a
  dedicated test calendar for a device check; select only calendars meant to
  contribute busy times before enabling background sync.
- Inventory inactive collectors read-only before cleanup. Count future
  deduplicated entities with exclusively inactive sources separately from
  raw observations. Inactivity alone does not authorize deleting a source.

## Public Feed Verification

- Docs shows the public page and ICS revisions beside the Staging and Live
  receipts. It makes anonymous HEAD requests to the two canonical production
  feed URLs. The public header comes from the response's projected observation
  revision, not from the Live D1 receipt or the time the request ran.
- Older or fallback responses without a revision are unverified. A lower
  revision can wait for public cache convergence; it never enables another
  upload or a Live retry. Only the authenticated D1 receipt controls retries.
- Normal code releases run `npm run verify:calendar:staging` or
  `npm run verify:calendar:prod` against the activated Worker before marking it
  accepted. The checks only read; they compare unique occurrence keys, times,
  public fields, Busy privacy, and JSON/ICS revisions without printing events.
- Verify move, deletion, empty scope, and unrelated overlaps in isolated
  databases. Ordinary staging sync still mirrors to Live, so never inject
  synthetic events into the hosted staging API.
- The public event ID still owns permalinks. A reused historical ID gets a
  separate occurrence key from its public interval before time filtering.
  Already unique UIDs and the subscription URL stay unchanged; no source
  calendar identifiers, notes, or other private data are added.
