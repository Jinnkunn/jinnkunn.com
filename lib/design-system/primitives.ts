export const DESIGN_VARIANTS = ["solid", "ghost", "subtle", "nav"] as const;
export const DESIGN_TONES = [
  "neutral",
  "accent",
  "success",
  "danger",
  "warning",
  "info",
] as const;
export const DESIGN_SIZES = ["sm", "md"] as const;
export const DESIGN_DENSITIES = ["compact", "default"] as const;

export const BUTTON_SURFACES = ["default", "inverse"] as const;
export const CONTAINER_SURFACES = ["default", "elevated", "soft"] as const;
export const BADGE_VARIANTS = ["soft", "outline"] as const;
export const DESIGN_PATTERNS = [
  "textLink",
  "emptyState",
  "listRow",
  "toolbar",
  "loadingState",
  "dialogPanel",
] as const;

export type DesignVariant = (typeof DESIGN_VARIANTS)[number];
export type DesignTone = (typeof DESIGN_TONES)[number];
export type DesignSize = (typeof DESIGN_SIZES)[number];
export type DesignDensity = (typeof DESIGN_DENSITIES)[number];

export type ButtonSurface = (typeof BUTTON_SURFACES)[number];
export type ContainerSurface = (typeof CONTAINER_SURFACES)[number];
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];
export type DesignPattern = (typeof DESIGN_PATTERNS)[number];

export const BUTTON_DEFAULTS = {
  variant: "solid",
  tone: "neutral",
  size: "md",
  density: "default",
  surface: "default",
} as const satisfies {
  variant: DesignVariant;
  tone: DesignTone;
  size: DesignSize;
  density: DesignDensity;
  surface: ButtonSurface;
};

export const ICON_BUTTON_DEFAULTS = {
  variant: "subtle",
  tone: "neutral",
  size: "sm",
  density: "compact",
  surface: "default",
} as const satisfies {
  variant: DesignVariant;
  tone: DesignTone;
  size: DesignSize;
  density: DesignDensity;
  surface: ButtonSurface;
};

export const BADGE_DEFAULTS = {
  variant: "soft",
  tone: "neutral",
  size: "sm",
  density: "default",
} as const satisfies {
  variant: BadgeVariant;
  tone: DesignTone;
  size: DesignSize;
  density: DesignDensity;
};

export const FIELD_DEFAULTS = {
  size: "md",
  density: "default",
} as const satisfies {
  size: DesignSize;
  density: DesignDensity;
};

export const CONTAINER_DEFAULTS = {
  surface: "default",
} as const satisfies {
  surface: ContainerSurface;
};

export const STATUS_NOTICE_DEFAULTS = {
  tone: "neutral",
  size: "md",
  density: "default",
} as const satisfies {
  tone: DesignTone;
  size: DesignSize;
  density: DesignDensity;
};
