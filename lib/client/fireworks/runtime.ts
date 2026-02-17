import { isTypingContext } from "@/lib/client/dom-utils";

const FIREWORK_LAYER_ID = "firework-layer";
const MIN_TRIGGER_INTERVAL_MS = 105;
const FIREWORK_MAX_LIFETIME_MS = 1900;

const PARTICLE_COUNT_DESKTOP = 30;
const PARTICLE_COUNT_MOBILE = 20;
const SUB_BURST_DELAY_MS = 90;

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
  const distance = randomBetween(96, 236);
  const dx = Math.cos(angle) * distance;
  const dy = Math.sin(angle) * distance;

  particle.style.setProperty("--fw-dx", `${dx.toFixed(2)}px`);
  particle.style.setProperty("--fw-dy", `${dy.toFixed(2)}px`);
  particle.style.setProperty("--fw-size", `${Math.round(randomBetween(34, 102))}px`);
  particle.style.setProperty("--fw-duration", `${Math.round(randomBetween(980, 1650))}ms`);
  particle.style.setProperty("--fw-delay", `${Math.round(randomBetween(0, 220))}ms`);
  particle.style.setProperty("--fw-opacity", randomBetween(0.52, 0.98).toFixed(2));
  particle.style.setProperty("--fw-scale", randomBetween(0.13, 0.62).toFixed(2));
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

function createCore() {
  const core = document.createElement("span");
  core.className = "firework-layer__core";
  core.style.setProperty("--fw-core-size", `${Math.round(randomBetween(44, 82))}px`);
  return core;
}

function createMist() {
  const mist = document.createElement("span");
  mist.className = "firework-layer__mist";
  mist.style.setProperty("--fw-mist-size", `${Math.round(randomBetween(160, 250))}px`);
  mist.style.setProperty("--fw-mist-opacity", randomBetween(0.16, 0.32).toFixed(2));
  return mist;
}

function spawnBurst(clientX: number, clientY: number, particleCount: number) {
  const layer = document.getElementById(FIREWORK_LAYER_ID);
  if (!layer) return;

  const burst = document.createElement("span");
  burst.className = "firework-layer__burst";
  burst.style.left = `${Math.round(clientX)}px`;
  burst.style.top = `${Math.round(clientY)}px`;

  burst.appendChild(createFlash());
  burst.appendChild(createCore());
  burst.appendChild(createMist());
  for (let i = 0; i < particleCount; i += 1) {
    burst.appendChild(createParticle(i, particleCount));
  }

  layer.appendChild(burst);
  window.setTimeout(() => burst.remove(), FIREWORK_MAX_LIFETIME_MS);
}

function spawnFirework(clientX: number, clientY: number) {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const primaryCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;
  const secondaryCount = Math.max(8, Math.round(primaryCount * 0.55));
  const tertiaryCount = isMobile ? 6 : 10;
  const delayMs = isMobile ? 90 : 118;

  spawnBurst(clientX, clientY, primaryCount);
  window.setTimeout(() => {
    spawnBurst(
      clientX + randomBetween(-26, 26),
      clientY + randomBetween(-18, 18),
      secondaryCount,
    );
  }, delayMs);

  window.setTimeout(() => {
    spawnBurst(
      clientX + randomBetween(-54, 54),
      clientY + randomBetween(-30, 30),
      tertiaryCount,
    );
  }, delayMs + SUB_BURST_DELAY_MS);
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
