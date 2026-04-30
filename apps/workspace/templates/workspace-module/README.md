# Workspace Module Scaffold

This template is for bundled first-party workspace modules. These are not runtime plugins: the code ships with the app, while the shell discovers each feature through `src/modules/registry.tsx`.

## Copy Plan

1. Copy the relevant `*.tmpl` files into real source locations.
2. Replace every `__PLACEHOLDER__`.
3. Register `__MODULE_CONST___MODULE` in `src/modules/registry.tsx`.
4. Add any required Rust command to `src-tauri/src/main.rs` and `tauri::generate_handler!`.
5. If the module owns local data, add its schema to `src-tauri/src/local_db.rs`.
6. Add registry/unit tests and a guardrail assertion in `../../scripts/workspace-ui-smoke.mjs`.

## Recommended File Layout

```text
apps/workspace/src/modules/__MODULE_ID__/index.tsx
apps/workspace/src/modules/__MODULE_ID__/api.ts
apps/workspace/src/surfaces/__MODULE_ID__/__MODULE_SURFACE__.tsx
apps/workspace/src/surfaces/__MODULE_ID__/nav.tsx
apps/workspace/src-tauri/src/__MODULE_ID__.rs
```

For a simple UI-only feature, skip `api.ts`, `nav.tsx`, and the Rust command template.

## Shell Contract

Each module contributes one `WorkspaceModuleDefinition`:

- `id`: stable module id, usually kebab-case.
- `surface`: the actual workspace surface definition.
- `enabledByDefault`: omit or `true` for daily tools; set `false` only for feature-gated work.
- `dashboardActions`: optional launcher rows on the Workspace dashboard.
- `commandActions`: optional command palette shortcuts.

The shell owns enabled/disabled state, surface ordering, recent items, favorites, tabs, and command palette wiring. The module owns only its surface UI, local API wrappers, and domain data.
