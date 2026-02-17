import { isTypingContext } from "@/lib/client/dom-utils";

const FIREWORK_LAYER_ID = "firework-layer";
const MIN_TRIGGER_INTERVAL_MS = 105;

function isSafeFireworkTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const safeSelector =
    "a, button, input, textarea, select, option, label, summary, details, form, .notion-search, #notion-search";
  return target.closest(safeSelector) !== null;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createParticle(index: number, total: number) {
  const particle = document.createElement("span");
  particle.className = "firework-layer__particle";

  const baseAngle = (index / total) * Math.PI * 2;
  const angle = baseAngle + randomBetween(-0.2, 0.2);
  const distance = randomBetween(72, 178);
  const dx = Math.cos(angle) * distance;
  const dy = Math.sin(angle) * distance;

  particle.style.setProperty("--fw-dx", `${dx.toFixed(2)}px`);
  particle.style.setProperty("--fw-dy", `${dy.toFixed(2)}px`);
  particle.style.setProperty("--fw-size", `${Math.round(randomBetween(62, 118))}px`);
  particle.style.setProperty("--fw-duration", `${Math.round(randomBetween(980, 1420))}ms`);
  particle.style.setProperty("--fw-opacity", randomBetween(0.55, 0.98).toFixed(2));
  particle.style.setProperty("--fw-scale", randomBetween(0.18, 0.44).toFixed(2));
  particle.style.setProperty("--fw-rot", `${Math.round(randomBetween(-30, 30))}deg`);
  particle.style.setProperty("--fw-spin", `${Math.round(randomBetween(70, 220))}deg`);

  return particle;
}

function createFlash() {
  const flash = document.createElement("span");
  flash.className = "firework-layer__flash";
  flash.style.setProperty("--fw-flash-size", `${Math.round(randomBetween(68, 112))}px`);
  return flash;
}

function spawnBurst(clientX: number, clientY: number, particleCount: number) {
  const layer = document.getElementById(FIREWORK_LAYER_ID);
  if (!layer) return;

  const burst = document.createElement("span");
  burst.className = "firework-layer__burst";
  burst.style.left = `${Math.round(clientX)}px`;
  burst.style.top = `${Math.round(clientY)}px`;

  burst.appendChild(createFlash());
  for (let i = 0; i < particleCount; i += 1) {
    burst.appendChild(createParticle(i, particleCount));
  }

  layer.appendChild(burst);
  window.setTimeout(() => burst.remove(), 1300);
}

function spawnFirework(clientX: number, clientY: number) {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const primaryCount = isMobile ? 12 : 18;
  const secondaryCount = isMobile ? 8 : 14;
  const delayMs = isMobile ? 70 : 96;

  spawnBurst(clientX, clientY, primaryCount);
  window.setTimeout(() => {
    spawnBurst(
      clientX + randomBetween(-26, 26),
      clientY + randomBetween(-18, 18),
      secondaryCount,
    );
  }, delayMs);
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
