# Design System Inventory

This inventory freezes the current production-facing visual language before any
new UI polish work. The goal is stability: public pages keep the restored
Notion/classic look while the codebase gains shared contracts for future work.

## Baseline

- Production visual baseline: current classic Notion/Super public site.
- Public routes protected by static-shell regression:
  - `/`
  - `/news`
  - `/publications`
  - `/works`
  - `/teaching`
  - `/blog`
  - `/bio`
  - `/connect`
- Design-system gallery: `/site-admin/design-system`
- Promotion rule: staging first; production only after explicit approval.

## Surfaces

| Surface | Owner | Styling Source | Rule |
| --- | --- | --- | --- |
| Public classic pages | Web public | `public/styles/super*.css`, `public/styles/notion.css`, `app/(classic)/*.css` | Preserve production appearance unless explicitly approved. |
| Site Admin web | Web admin | `app/design-system.css`, `app/(classic)/site-admin/styles/*.css`, `components/ui/*` | Prefer shared primitives and `--ds-*` tokens. |
| Tauri workspace | Desktop app | `apps/workspace/src/index.css` | Keep macOS-native layout, expose `--ds-*` aliases for shared semantics. |
| Home preview iframe | Tauri/Web bridge | `apps/workspace/src/surfaces/site-admin/home-builder/preview-document.ts` and preview API stylesheets | Use built public CSS assets, not hand-rolled preview-only styling. |
| Compatibility bridge | Migration layer | `app/(classic)/design-system-bridge.css` | Bridge legacy variables only; new names start in `--ds-*`. |

## Token Contract

Tokens are organized into 3 groups:

- `foundation`: fonts, spacing, radii, shadows, timing.
- `semantic`: page/panel surfaces, text hierarchy, borders, interaction, status colors.
- `component`: selection, navigation, search, lightbox, publication tags, scrollbars.

Source of truth:

- [tokens.ts](/Users/jinnkunn/Desktop/jinnkunn.com/lib/design-system/tokens.ts)
- [design-system.css](/Users/jinnkunn/Desktop/jinnkunn.com/app/design-system.css)
- [design-system-bridge.css](</Users/jinnkunn/Desktop/jinnkunn.com/app/(classic)/design-system-bridge.css>)

## Primitive Contract

Shared primitives:

- `Button`
- `IconButton`
- `Badge`
- `Field`
- `Textarea`
- `CheckboxRow`
- `Card`
- `Panel`
- `SectionHeader`
- `StatusNotice`
- `NavItem`

Shared patterns:

- `TextLink`
- `EmptyState`
- `ListRow`
- `Toolbar`
- `LoadingState`
- `DialogPanel`

Rules:

- Icon-only controls require `aria-label`.
- Form controls require a label plus meaningful `name` and `autocomplete`.
- Loading text uses `…`.
- Destructive actions need confirmation or an undo window.
- `outline: none` is only allowed with a visible `:focus-visible` replacement.
- Animations must respect `prefers-reduced-motion`.

## Page Patterns

| Pattern | Current Route/Area | Preferred Building Blocks |
| --- | --- | --- |
| Classic content page | `/bio`, `/connect`, long-tail Notion pages | Classic shell, raw Notion renderer, route CSS only for compatibility fixes. |
| Home layout | `/` | Classic home CSS + content schema. Do not substitute generic hero components. |
| List pages | `/news`, `/works`, `/publications`, `/blog` | Existing classic list markup until a migration is explicitly approved. |
| Admin dashboard | `/site-admin` | `SectionHeader`, `StatusNotice`, `Card`, `Button`, `TextLink`. |
| Admin config/routes | `/site-admin/config`, `/site-admin/routes` | `Field`, `Badge`, `Button`, `ListRow`, `Toolbar`. |
| Empty/error/loading states | Web + Tauri | `EmptyState`, `StatusNotice`, `LoadingState`. |
| Dialog/popover content | Web + Tauri | `DialogPanel`, `Button`, `StatusNotice`. |

## Regression Gates

Minimum local gate for UI-impacting changes:

```bash
npm run check:design-system
npm test
npm run build
SMOKE_UI_QUICK=1 SMOKE_UI_SKIP_BUILD=1 npm run smoke:ui
npm run snapshot:ui
```

Design-system snapshot coverage includes `/site-admin/design-system` in both
light and dark themes, desktop and mobile viewports.

## Migration Rule

Migrations should follow this order:

1. Add tokens or primitive contract.
2. Add gallery example.
3. Add tests or snapshot coverage.
4. Migrate one representative low-risk surface.
5. Compare against production baseline before touching public pages.
