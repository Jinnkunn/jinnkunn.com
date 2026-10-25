import { useEffect, useState } from "react";
import { readContentPins } from "./site-admin-content-tasks";

export function useSiteAdminContentPins(actor: string) {
  const [pins, setPins] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const key = `site-admin:content-pins:${actor}`;
  useEffect(() => {
    function read() {
      try { setPins(readContentPins(localStorage.getItem(key))); setUnavailable(false); }
      catch { setPins([]); setUnavailable(true); }
    }
    read();
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  function toggle(value: string) {
    const next = pins.includes(value) ? pins.filter((item) => item !== value) : [...pins, value].slice(-40);
    setPins(next);
    try { localStorage.setItem(key, JSON.stringify({ version: 1, items: next })); setUnavailable(false); }
    catch { setUnavailable(true); }
  }
  return { pins, toggle, unavailable };
}
