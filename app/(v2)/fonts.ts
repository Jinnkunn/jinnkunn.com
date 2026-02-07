import localFont from "next/font/local";

// Route-scoped typography for /v2.
// Use next/font so fonts are hashed + preloaded automatically without relying on head.tsx.

export const v2Sans = localFont({
  src: [
    {
      path: "../../public/fonts/noto-sans-v27-regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/noto-sans-v27-600.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--v2-font-sans",
  display: "swap",
  preload: true,
});

export const v2Serif = localFont({
  src: [
    {
      path: "../../public/fonts/fraunces-var.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--v2-font-serif",
  display: "swap",
  preload: true,
});

