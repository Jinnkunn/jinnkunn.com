"use client";

import { useEffect } from "react";

import { setupClickFireworks } from "@/lib/client/fireworks/runtime";

export default function FireworksClickEffect() {
  useEffect(() => setupClickFireworks(), []);

  return <div id="firework-layer" className="firework-layer" aria-hidden="true" />;
}
