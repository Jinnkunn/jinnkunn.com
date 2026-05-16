type NowStatusProps = {
  label?: string;
  title: string;
  description: string;
  location?: string;
  period?: string;
  freshness?: string;
};

export function NowStatus({
  label = "Current status",
  title,
  description,
  location,
  period,
  freshness,
}: NowStatusProps) {
  const meta = [location, period, freshness].filter(Boolean);

  return (
    <section className="now-status" aria-label={label}>
      <p className="now-status__eyebrow">
        <span className="now-status__dot" aria-hidden="true" />
        <span>{label}</span>
      </p>
      <h2 className="now-status__title">{title}</h2>
      <p className="now-status__line">{description}</p>
      {meta.length > 0 ? (
        <div className="now-status__meta" aria-label="Status metadata">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
