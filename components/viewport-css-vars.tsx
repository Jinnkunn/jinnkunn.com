"use client";

import { useEffect } from "react";

function computeScrollbarWidth(): number {
  const de = document.documentElement;
  return Math.max(0, window.innerWidth - de.clientWidth);
}

export default function ViewportCssVars() {
  useEffect(() => {
    const update = () => {
      const w = computeScrollbarWidth();
      document.documentElement.style.setProperty("--scrollbar-width", `${w}px`);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return null;
}

