import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";

import SiteAdminBreadcrumbs from "@/components/site-admin-breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogPanel } from "@/components/ui/dialog-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckboxRow, Field, Textarea } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { LoadingState } from "@/components/ui/loading-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusNotice } from "@/components/ui/status-notice";
import { TextLink } from "@/components/ui/text-link";
import { Toolbar } from "@/components/ui/toolbar";
import {
  BADGE_VARIANTS,
  BUTTON_SURFACES,
  CONTAINER_SURFACES,
  DESIGN_DENSITIES,
  DESIGN_PATTERNS,
  DESIGN_SIZES,
  DESIGN_TONES,
  DESIGN_VARIANTS,
} from "@/lib/design-system/primitives";
import { DESIGN_THEMES, designThemeTokens } from "@/lib/design-system/tokens";

export const metadata: Metadata = {
  title: "Design System",
  description: "Design system inventory and gallery",
};

const inventory = [
  {
    title: "Public Classic Surface",
    description:
      "Production-facing Notion/Super rendering remains the visual baseline. Route CSS consumes bridge variables and should not introduce new page-specific visual language.",
  },
  {
    title: "Site Admin Surface",
    description:
      "Admin pages use shared primitives for buttons, form controls, status cards, route tables, and the design-system gallery itself.",
  },
  {
    title: "Tauri Workspace Surface",
    description:
      "The desktop app keeps its native macOS layout while exposing matching --ds-* aliases for future shared component work.",
  },
  {
    title: "Compatibility Layer",
    description:
      "Legacy --color-* and --navbar-* variables are bridge output only. New shared work should start from --ds-* tokens.",
  },
];

function isColorLike(value: string) {
  return /^(#|rgba?\(|hsla?\()/.test(value);
}

function IconSample() {
  return (
    <svg className="ds-gallery-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="ds-gallery-section">
      <div className="ds-gallery-section__head">
        <h2 className="ds-gallery-section__title">{title}</h2>
        <p className="ds-gallery-section__description">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Surface({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ds-gallery-surface">
      <div className="ds-gallery-surface__label">
        <span>{label}</span>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className="ds-gallery-surface__body">{children}</div>
    </div>
  );
}

function TokenGroup({
  theme,
  section,
  tokens,
}: {
  theme: string;
  section: string;
  tokens: Record<string, string>;
}) {
  return (
    <Surface label={`${theme} / ${section}`}>
      <div className="ds-gallery-token-grid">
        {Object.entries(tokens).map(([name, value]) => {
          const hasSwatch = isColorLike(value);
          return (
            <div className="ds-gallery-token" key={`${theme}-${section}-${name}`}>
              <span
                className="ds-gallery-token__swatch"
                data-empty={hasSwatch ? undefined : "true"}
                style={
                  hasSwatch
                    ? ({ "--ds-gallery-swatch": value } as CSSProperties)
                    : undefined
                }
                aria-hidden="true"
              />
              <span className="ds-gallery-token__copy">
                <span className="ds-gallery-token__name">{name}</span>
                <span className="ds-gallery-token__value">{value}</span>
              </span>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

export default function SiteAdminDesignSystemPage() {
  return (
    <main id="page-site-admin-design-system" className="super-content page__site-admin parent-page__index">
      <SiteAdminBreadcrumbs
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/site-admin", label: "Site Admin" },
          { href: "/site-admin/design-system", label: "Design System" },
        ]}
      />
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">Design System</h1>
          </div>
        </div>
      </div>

      <article id="block-site-admin-design-system" className="notion-root max-width has-footer">
        <div className="site-admin-design-system">
          <SectionHeader
            eyebrow="Stabilization Gallery"
            title="Production Classic Style, Codified"
            description="Use this gallery to validate tokens, primitives, and UI patterns before changing public pages or Tauri editor surfaces."
            actions={
              <Button href="/site-admin" variant="ghost">
                Back to Site Admin
              </Button>
            }
          />

          <Section
            title="Inventory"
            description="The current UI is deliberately split between public classic rendering, admin tools, Tauri workspace, and compatibility bridges."
          >
            <ul className="ds-gallery-inventory">
              {inventory.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Tokens"
            description="Foundation, semantic, and component tokens are the source of truth. Raw content CSS can stay in compatibility layers; new shared work should use these names."
          >
            <div className="ds-gallery-grid ds-gallery-grid--wide">
              {DESIGN_THEMES.map((theme) =>
                Object.entries(designThemeTokens[theme]).map(([section, tokens]) => (
                  <TokenGroup
                    key={`${theme}-${section}`}
                    theme={theme}
                    section={section}
                    tokens={tokens}
                  />
                )),
              )}
            </div>
          </Section>

          <Section
            title="Primitive Contract"
            description="Primitive dimensions are intentionally small. New variants should be added only when a real repeated UI pattern needs them."
          >
            <div className="ds-gallery-grid">
              <Surface label="Variants">
                <div>
                  {DESIGN_VARIANTS.map((variant) => (
                    <Badge key={variant} className="ds-gallery-code" variant="outline">
                      {variant}
                    </Badge>
                  ))}
                </div>
              </Surface>
              <Surface label="Tones">
                <div>
                  {DESIGN_TONES.map((tone) => (
                    <Badge key={tone} tone={tone}>
                      {tone}
                    </Badge>
                  ))}
                </div>
              </Surface>
              <Surface label="Sizes & Density">
                <p className="ds-gallery-section__description">
                  sizes: {DESIGN_SIZES.join(", ")} · density: {DESIGN_DENSITIES.join(", ")}
                </p>
                <p className="ds-gallery-section__description">
                  button surfaces: {BUTTON_SURFACES.join(", ")} · containers:{" "}
                  {CONTAINER_SURFACES.join(", ")} · badges: {BADGE_VARIANTS.join(", ")}
                </p>
              </Surface>
              <Surface label="Patterns">
                <p className="ds-gallery-section__description">
                  {DESIGN_PATTERNS.join(", ")}
                </p>
              </Surface>
            </div>
          </Section>

          <Section
            title="Components"
            description="These components are safe defaults for new admin and shared UI. Public Notion content keeps its existing classic CSS unless explicitly migrated."
          >
            <div className="ds-gallery-grid ds-gallery-grid--wide">
              <Surface label="Buttons">
                <Toolbar
                  label="Button examples"
                  start={
                    <>
                      <Button>Save Changes</Button>
                      <Button variant="ghost">Cancel</Button>
                      <Button variant="solid" tone="accent">
                        Preview
                      </Button>
                    </>
                  }
                  end={
                    <IconButton label="Add item">
                      <IconSample />
                    </IconButton>
                  }
                />
              </Surface>

              <Surface label="Fields">
                <form className="ds-gallery-form">
                  <label className="ds-gallery-form__label">
                    Title
                    <Field
                      name="gallery-title"
                      autoComplete="off"
                      placeholder="Homepage heading…"
                      defaultValue="Hi there!"
                    />
                  </label>
                  <label className="ds-gallery-form__label">
                    Notes
                    <Textarea
                      name="gallery-notes"
                      autoComplete="off"
                      placeholder="Describe the page state…"
                      defaultValue="Keep public pages visually aligned with production."
                    />
                  </label>
                  <CheckboxRow name="gallery-published" defaultChecked>
                    Include in release QA
                  </CheckboxRow>
                </form>
              </Surface>

              <Surface label="Feedback">
                <StatusNotice tone="success">Saved to staging. Production is unchanged.</StatusNotice>
                <StatusNotice tone="warning">Review screenshots before promotion.</StatusNotice>
                <LoadingState label="Checking visual contracts…" />
              </Surface>

              <Surface label="Lists">
                <div className="ds-gallery-row-stack" role="list" aria-label="Design system list examples">
                  <ListRow
                    title="Public Web Style Stability"
                    description="Classic/Notion style contracts, route shells, link styling, and home layout protection."
                    meta="phase 2"
                    href="/site-admin/design-system"
                  />
                  <ListRow
                    title="Tauri Site Admin Editor"
                    description="Home builder, preview iframe bridge, draft restore, version history, and asset library."
                    meta="phase 3"
                  />
                </div>
              </Surface>

              <Surface label="Empty State">
                <EmptyState
                  icon={<IconSample />}
                  title="No unpublished changes"
                  description="When a list is empty, show the user what happened and provide a concrete next step."
                  actions={<Button variant="subtle">Create Draft</Button>}
                />
              </Surface>

              <Surface label="Dialog">
                <div className="ds-gallery-dialog-area">
                  <DialogPanel
                    title="Promote to Production?"
                    description="Production promotion requires explicit approval and a verified source SHA."
                    actions={
                      <>
                        <Button variant="ghost">Cancel</Button>
                        <Button tone="danger">Confirm Deploy</Button>
                      </>
                    }
                  >
                    <span>
                      Run <span className="ds-gallery-code">release:prod:dry-run</span> first.
                    </span>
                  </DialogPanel>
                </div>
              </Surface>

              <Surface label="Text Links">
                <p className="ds-gallery-section__description">
                  Inline links should preserve the production classic behavior while shared UI uses{" "}
                  <TextLink href="/site-admin/design-system">TextLink</TextLink> for internal
                  navigation and{" "}
                  <TextLink href="https://jinkunchen.com" external>
                    external destinations
                  </TextLink>
                  .
                </p>
              </Surface>
            </div>
          </Section>
        </div>
      </article>
    </main>
  );
}
