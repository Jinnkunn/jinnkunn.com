# Design System

This repo now has a code-first design system built as a compatibility layer on top of the existing Super/Notion CSS base.

## Scope

- Public shell and admin UI share the same token contract and primitive components.
- Raw content rendering is still driven by the existing `public/styles/super*.css` and `public/styles/notion.css` stack.
- Light and dark themes are both supported through `html[data-theme="light" | "dark"]`.

## Source of Truth

- Typed tokens: [`lib/design-system/tokens.ts`](/Users/jinnkunn/Desktop/jinnkunn.com/lib/design-system/tokens.ts)
- Theme resolution/runtime: [`lib/design-system/theme.ts`](/Users/jinnkunn/Desktop/jinnkunn.com/lib/design-system/theme.ts)
- Global design system CSS: [`app/design-system.css`](/Users/jinnkunn/Desktop/jinnkunn.com/app/design-system.css)
- Classic compatibility bridge: [`app/(classic)/design-system-bridge.css`](</Users/jinnkunn/Desktop/jinnkunn.com/app/(classic)/design-system-bridge.css>)
- Shared primitives: [`components/ui`](/Users/jinnkunn/Desktop/jinnkunn.com/components/ui)

## Rules

- New visual decisions should be expressed through `--ds-*` tokens first.
- Legacy `--color-*` and `--navbar-*` variables are bridge output only.
- New shared UI should use `Button`, `IconButton`, `Badge`, `Field`, `Textarea`, `CheckboxRow`, `Card`, `Panel`, `SectionHeader`, `StatusNotice`, or `NavItem` before adding feature-local primitives.
- Route-scoped CSS may still exist, but it should consume design-system tokens instead of introducing new hard-coded colors.

## Theme Behavior

- Theme is resolved in this order:
  - `?theme=light|dark`
  - `localStorage["ds-theme"]`
  - system `prefers-color-scheme`
  - fallback `light`
- The root element always receives:
  - `data-theme="light|dark"`
  - compatibility class `theme-light` or `theme-dark`

## v1 Boundaries

- Long-tail Notion block dark-mode parity is intentionally incomplete.
- No Storybook or Figma library is included in this phase.

## v1 Stabilized Boundary

- Design-system owned surfaces:
  - public shell, including navigation, footer, search, state pages, lightbox, publications, and sitemap-like utility pages
  - site-admin shell, status, deploy, config, and routes views
  - shared interaction primitives under [`components/ui`](/Users/jinnkunn/Desktop/jinnkunn.com/components/ui)
- Compatibility/legacy surfaces:
  - raw content rendering through `public/styles/super*.css`
  - long-tail Notion block styling in `app/(classic)/notion-blocks.css`
  - bridge output in `app/(classic)/design-system-bridge.css`
- Temporary allowed exceptions:
  - `app/design-system.css` (foundation token definitions)
  - `public/styles/super*.css`
  - `public/styles/notion.css`
  - `app/(classic)/notion-blocks.css`
- Outside the exceptions above, new core-surface work should not introduce raw color literals. Prefer semantic or component `--ds-*` tokens, and only map back to legacy `--color-*` or `--navbar-*` through the bridge layer.

## QA Baseline

- Visual regression uses [`scripts/ui-snapshots.mjs`](/Users/jinnkunn/Desktop/jinnkunn.com/scripts/ui-snapshots.mjs) with a fixed light/dark matrix across:
  - home
  - one representative content page
  - `/blog`
  - `/publications`
  - one state page
  - `/site-admin`
- Interaction regression uses [`scripts/smoke-ui.mjs`](/Users/jinnkunn/Desktop/jinnkunn.com/scripts/smoke-ui.mjs) and must cover:
  - theme toggle
  - persisted theme after refresh
  - dark-mode navigation, search, mobile menu, and site-admin shell
- Accessibility regression stays on [`scripts/a11y-check.mjs`](/Users/jinnkunn/Desktop/jinnkunn.com/scripts/a11y-check.mjs) and audits representative light/dark pages through the same theme contract.
- Token leakage hard gate is [`scripts/check-design-system.mjs`](/Users/jinnkunn/Desktop/jinnkunn.com/scripts/check-design-system.mjs), exposed as `npm run check:design-system`.

## Post-v1 Expansion Entry

- Treat v1 as stabilized only when the current worktree can pass:
  - `npm run check:design-system`
  - `npm test`
  - `npm run build`
  - `SMOKE_UI_QUICK=1 SMOKE_UI_SKIP_BUILD=1 npm run smoke:ui`
  - `A11Y_SKIP_BUILD=1 A11Y_FULL_SITE=1 A11Y_FAIL_ALL=1 npm run check:a11y`
  - `npm run snapshot:ui`
- CI must keep these gates for UI-impacting changes, including light/dark snapshot generation.
- Once those gates stay green, phase D can focus on long-tail `app/(classic)/notion-blocks.css` parity only:
  - fix blocker-level dark-mode contrast/accessibility issues
  - avoid broad visual rework in raw content rendering
  - keep shell/admin/primitives changes in the design-system layer (`--ds-*` + shared primitives)

## Phase D Minimal Closure

- `app/(classic)/notion-blocks.css` now uses `--ds-*` for blocker-level interactions:
  - copy-success feedback
  - toggle focus ring and touch active state
  - sticky table header surfaces
  - code token contrast for table headers/data in dark mode
- Regression is locked by [`tests/design-system-notion-blocks.test.mjs`](/Users/jinnkunn/Desktop/jinnkunn.com/tests/design-system-notion-blocks.test.mjs), which prevents raw color literals and legacy `--color-*` reintroduction in `notion-blocks.css`.
- This does not expand scope into full long-tail Notion visual parity; only blocker-level accessibility/readability fixes are in-phase.
