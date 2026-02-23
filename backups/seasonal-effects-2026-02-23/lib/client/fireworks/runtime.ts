import { isTypingContext } from "@/lib/client/dom-utils";

const FIREWORK_LAYER_ID = "firework-layer";
const MIN_TRIGGER_INTERVAL_MS = 105;
const FIREWORK_MAX_LIFETIME_MS = 980;

function isSafeFireworkTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const safeSelector =
    "a, button, input, textarea, select, option, label, summary, details, form, .notion-search, #notion-search";
  return target.closest(safeSelector) !== null;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function spawnBurst(clientX: number, clientY: number) {
  const layer = document.getElementById(FIREWORK_LAYER_ID);
  if (!layer) return;

  const burst = document.createElement("span");
  burst.className = "firework-layer__burst";
  burst.style.left = `${Math.round(clientX)}px`;
  burst.style.top = `${Math.round(clientY)}px`;
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const firework = document.createElement("span");
  firework.className = "firework-layer__single";
  firework.style.setProperty(
    "--fw-size",
    `${Math.round(randomBetween(isMobile ? 112 : 132, isMobile ? 152 : 186))}px`,
  );
  firework.style.setProperty("--fw-rot", `${Math.round(randomBetween(-8, 8))}deg`);
  firework.style.setProperty("--fw-rise", `${Math.round(randomBetween(-12, -5))}px`);
  burst.appendChild(firework);

  layer.appendChild(burst);
  window.setTimeout(() => burst.remove(), FIREWORK_MAX_LIFETIME_MS);
}

function spawnFirework(clientX: number, clientY: number) {
  spawnBurst(clientX, clientY);
}

export function setupClickFireworks() {
  if (typeof window === "undefined") return () => undefined;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => undefined;
  }

  let lastTriggerAt = 0;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (event.defaultPrevented) return;
    if (isSafeFireworkTarget(event.target)) return;
    if (isTypingContext(event.target)) return;

    const now = performance.now();
    if (now - lastTriggerAt < MIN_TRIGGER_INTERVAL_MS) return;
    lastTriggerAt = now;

    spawnFirework(event.clientX, event.clientY);
  };

  document.addEventListener("pointerdown", onPointerDown, true);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}
