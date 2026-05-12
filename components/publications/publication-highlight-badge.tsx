function highlightLabel(highlight: string): string {
  const normalized = highlight.trim().toLowerCase();
  if (normalized === "oral") return "Oral presentation";
  return highlight.trim();
}

function highlightAriaLabel(highlight: string): string {
  const normalized = highlight.trim().toLowerCase();
  if (normalized === "oral") return "Oral presentation";
  return highlight.trim();
}

export function PublicationHighlightBadge({ highlight }: { highlight: string }) {
  const label = highlightLabel(highlight);
  if (!label) return null;

  return (
    <span
      className="pub-highlight-badge ds-status-marker ds-status-marker--tone-warning"
      aria-label={highlightAriaLabel(highlight)}
    >
      <span className="pub-highlight-dot ds-status-marker__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
