"use client";

import { useEffect } from "react";

function computeScrollbarWidth(): number {
  const de = document.documentElement;
  return Math.max(0, window.innerWidth - de.clientWidth);
}

function computeLogoLeft(): number {
  const logo =
    document.querySelector<HTMLElement>(".super-navbar__logo .super-navbar__logo-text") ||
    document.querySelector<HTMLElement>(".super-navbar__logo");
  if (!logo) return 24;
  return Math.max(0, Math.round(logo.getBoundingClientRect().left));
}

export default function ViewportCssVars() {
  useEffect(() => {
    const update = () => {
      const w = computeScrollbarWidth();
      const logoLeft = computeLogoLeft();
      document.documentElement.style.setProperty("--scrollbar-width", `${w}px`);
      document.documentElement.style.setProperty("--logo-left", `${logoLeft}px`);
    };

    update();
    const raf = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, []);

  return null;
}
