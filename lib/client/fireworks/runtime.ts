const FIREWORK_LAYER_ID = "firework-layer";
const MIN_TRIGGER_INTERVAL_MS = 80;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createParticle(index: number, total: number) {
  const particle = document.createElement("span");
  particle.className = "firework-layer__particle";

  const baseAngle = (index / total) * Math.PI * 2;
  const angle = baseAngle + randomBetween(-0.22, 0.22);
  const distance = randomBetween(56, 132);
  const dx = Math.cos(angle) * distance;
  const dy = Math.sin(angle) * distance;

  particle.style.setProperty("--fw-dx", `${dx.toFixed(2)}px`);
  particle.style.setProperty("--fw-dy", `${dy.toFixed(2)}px`);
  particle.style.setProperty("--fw-size", `${Math.round(randomBetween(34, 62))}px`);
  particle.style.setProperty("--fw-duration", `${Math.round(randomBetween(760, 1080))}ms`);
  particle.style.setProperty("--fw-opacity", randomBetween(0.22, 0.42).toFixed(2));
  particle.style.setProperty("--fw-scale", randomBetween(0.16, 0.34).toFixed(2));
  particle.style.setProperty("--fw-rot", `${Math.round(randomBetween(-22, 22))}deg`);
  particle.style.setProperty("--fw-spin", `${Math.round(randomBetween(38, 116))}deg`);

  return particle;
}

function createFlash() {
  const flash = document.createElement("span");
  flash.className = "firework-layer__flash";
  flash.style.setProperty("--fw-flash-size", `${Math.round(randomBetween(34, 64))}px`);
  return flash;
}

function spawnFirework(clientX: number, clientY: number) {
  const layer = document.getElementById(FIREWORK_LAYER_ID);
  if (!layer) return;

  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const particleCount = isMobile ? 7 : 11;

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

export function setupClickFireworks() {
  if (typeof window === "undefined") return () => undefined;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => undefined;
  }

  let lastTriggerAt = 0;

  const onClick = (event: MouseEvent) => {
    // Only primary button clicks for pointer devices.
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;

    const now = performance.now();
    if (now - lastTriggerAt < MIN_TRIGGER_INTERVAL_MS) return;
    lastTriggerAt = now;

    spawnFirework(event.clientX, event.clientY);
  };

  document.addEventListener("click", onClick, true);

  return () => {
    document.removeEventListener("click", onClick, true);
  };
}
