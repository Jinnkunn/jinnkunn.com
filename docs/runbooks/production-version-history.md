# Production Version History

Append-only log of production Cloudflare Worker versions. Read top-
to-bottom: most-recent first. The version IDs in this file are the
fastest path to a known-good rollback target during an incident.

Each row is written by `npm run snapshot:prod` (standalone) or by
`scripts/release-from-staging.mjs` after a successful production
release.

| Snapshot at (UTC) | Version ID | Deployment ID | Code SHA | Branch | Note |
| --- | --- | --- | --- | --- | --- |
| 2026-05-03 18:31:29 | `42d19310-c696-4b31-8539-71984d2c2b65` | `2902e16b-4a39-4eb0-aa18-7024680513c2` | `550caa850aa7` | main | Promoted 550caa850aa7 from staging |
| 2026-05-03 18:30:30 | `2f239ccd-8dfa-42c5-9f96-58405607b282` | `706d3570-022e-4c86-b0d5-42b44d7862f8` | `c434e712f1f5` | main | Pre-promotion baseline before 550caa850aa7 |
| 2026-05-02 16:49:32 | `1c453a31-54b3-4cdc-830e-c4b2aeaa3290` | `a18f7afc-5db3-462a-860c-16dde99be86f` | `86b9f9a3ffff` | main | Post-promotion 86b9f9a3ffff |
| 2026-05-02 16:45:45 | `46002614-3267-4fb9-a1cc-746d5e5e5484` | `08855062-25fc-46bd-aba8-79ef642a0c72` | `9ce0733534e9` | main | Pre-promotion baseline before 86b9f9a3ffff |
| 2026-04-29 05:34:52 | `00807bb0-f8ff-427b-9d21-cd4dd48181f3` | `bdd1c704-a3c7-4c24-aba8-877a8923586e` | `5ccc401e721d` | main | Initial snapshot (history file added) |
