# Calendar Observation Sync

The collector writes to staging. That request only reports success after the
same observation revision, or a newer staging revision, is confirmed in Live.
The mirror updates only the four calendar observation tables and the revision
receipt. The public projection still exposes those observations as `Busy`.

## Rollout

Before releasing the Worker that uses `calendar_observation_revision`, apply
[`011_calendar_observation_revision.sql`](../../migrations/011_calendar_observation_revision.sql)
to **both** the staging and production `SITE_ADMIN_DB` databases. Use the
normal D1 migration and [release](./production-promotion.md) procedures. The
migration is additive and idempotent; it does not change existing events.
The first verified mirror reconciles data left by the old publisher.

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
- Verify the public JSON and ICS feeds after their cache windows. Use a
  dedicated test calendar for a device check; select only calendars meant to
  contribute busy times before enabling background sync.
