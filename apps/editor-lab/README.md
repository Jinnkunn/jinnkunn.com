# Editor Lab

Standalone playground for the future block editor line.

This app intentionally does not integrate with Site Admin, Notes, Tauri, or the
iOS companion yet. The rendered surface is deliberately just the editor itself:
no debug sidebar, transaction inspector, or host controls.

- `packages/editor-core`: block schema, document operations, markdown import/export.
- `packages/editor-web`: DOM/React editor surface.
- `packages/editor-bridge`: host protocol for WebView/Tauri/iOS embedding.

Run locally:

```bash
npm install --prefix apps/editor-lab
npm run editor:lab
```
