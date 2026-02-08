## Getting Started

```bash
npm run dev
```

## Notion-Backed Site (Super-Like)

This repo can compile a Notion page tree into a static Next.js site.

### 1) Create Notion "Site Admin" Page

- Create a Notion page (e.g. `Site Admin`).
- Under it, create child pages (these become site pages, recursive).
- Add a **Code** block (language: `json`) containing site config. Example:

```json
{
  "siteName": "Jinkun Chen.",
  "lang": "en",
  "seo": {
    "title": "Jinkun Chen",
    "description": "Personal site.",
    "favicon": "/assets/favicon.png"
  },
  "nav": {
    "top": [
      { "href": "/", "label": "Home" },
      { "href": "/publications", "label": "Publications" }
    ],
    "more": [{ "href": "/blog", "label": "Blog" }]
  },
  "content": {
    "rootPageId": null,
    "homePageId": null
  }
}
```

### 2) Notion Integration + Env Vars

- Create a Notion internal integration, copy its secret token.
- Share the `Site Admin` page with that integration.
- Set env vars (see `.env.example`).

### 3) Sync

```bash
npm run sync:notion
```

This generates:
- `content/generated/site-config.json`
- `content/generated/raw/<route>.html`

`npm run build` automatically runs Notion sync first when `NOTION_*` env vars are set.

## Deploy Button (Notion -> Vercel)

The site exposes `/api/deploy?token=...` which triggers a Vercel Deploy Hook.

Required env:
- `DEPLOY_TOKEN`
- `VERCEL_DEPLOY_HOOK_URL`

In Notion, create a button or link pointing to:

`https://<your-site-domain>/api/deploy?token=<DEPLOY_TOKEN>`

## Legacy Content Sync (Clone Mode)

This repo can also sync hydrated HTML from an existing Super site into `content/raw/`:

```bash
npm run sync:raw
```

## UI Regression Snapshots

```bash
npm run snapshot:ui
```

Outputs go to `output/ui-snapshots/<timestamp>/`.

## UI Smoke Checks

Quick end-to-end checks for critical interactions (nav, mobile menu, toggles, code copy, lightbox, embeds):

```bash
npm run smoke:ui
```

Outputs go to `output/ui-smoke/<timestamp>/` and `output/ui-smoke/latest.json`.

## One-Command Verification

Run the full pipeline:

- sync raw HTML from the live site
- audit Notion/Super blocks in use
- run UI smoke checks
- generate UI snapshots

```bash
npm run check:ui
```

To skip syncing (offline / only validate current local content):

```bash
SKIP_SYNC=1 npm run check:ui
```

## Notion Block Audit

This scans the current raw HTML and lists all `notion-*` and `super-*` classes in use. This is how we
know which Notion/Super block styles we must support.

```bash
npm run audit:notion
```

Outputs go to `output/notion-block-audit/<timestamp>/` and `output/notion-block-audit/latest.*`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
