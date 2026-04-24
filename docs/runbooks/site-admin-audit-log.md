# Site Admin Audit Log (D1)

## Purpose

Record the operational events that matter for v1:

- config saves
- routes/protected saves
- source conflicts (`SOURCE_CONFLICT`)
- deploy triggers

## Enable D1 Sink

Set:

- `SITE_ADMIN_AUDIT_D1_DATABASE_ID`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

When D1 is unavailable, the API falls back to local append-only JSONL:

- `content/generated/site-admin-audit.log.jsonl`

## Table

The service auto-creates `site_admin_audit_logs` if missing and writes rows with:

- `at`
- `actor`
- `action`
- `result`
- `endpoint`
- `method`
- `status`
- `code`
- `message`
- `metadata_json`

## Query (example)

```sql
SELECT at, actor, action, result, status, code
FROM site_admin_audit_logs
ORDER BY id DESC
LIMIT 100;
```

