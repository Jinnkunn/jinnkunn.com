import { ClassicLink } from "@/components/classic/classic-link";
import type { SeriesLink } from "@/lib/posts/reasoning-drift-series";

export function ReasoningDriftSeries({ entries, current }: { entries: SeriesLink[]; current?: string }) {
  if (!entries.length || (current && !entries.some(({ href }) => href === current))) return null;
  return (
    <nav className="reading-guide" aria-labelledby="reasoning-drift-reading-order">
      <h2 id="reasoning-drift-reading-order">Reasoning Drift</h2>
      <ol>
        {entries.map(({ href, label }) => (
          <li key={href}>{current === href ? <span aria-current="page">{label}</span> : <ClassicLink href={href}>{label}</ClassicLink>}</li>
        ))}
      </ol>
    </nav>
  );
}
