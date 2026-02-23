"use client";

import { usePathname } from "next/navigation";

import FireworksClickEffect from "@/components/fireworks-click-effect";
import FestivalOverlay from "@/components/festival-overlay";

export default function SeasonalEffects() {
  const pathname = usePathname();

  if (typeof window === "undefined") return null;

  if (pathname?.startsWith("/site-admin")) {
    return null;
  }

  return (
    <>
      <FestivalOverlay />
      <FireworksClickEffect />
    </>
  );
}
