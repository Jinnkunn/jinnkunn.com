import type { PublicCalendarData, PublicCalendarEvent } from "@/lib/shared/public-calendar";

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(event: PublicCalendarEvent): string {
  if (event.isAllDay) return "All day";
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);
  const sameDay = dayKey(event.startsAt) === dayKey(event.endsAt);
  const startLabel = starts.toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
  const endLabel = ends.toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `${startLabel} - ${endLabel}`;
  return `${startLabel} - ${ends.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  })}, ${endLabel}`;
}

function groupEvents(events: PublicCalendarEvent[]): Array<[string, PublicCalendarEvent[]]> {
  const map = new Map<string, PublicCalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.startsAt);
    const bucket = map.get(key) ?? [];
    bucket.push(event);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function PublicCalendarView({ data }: { data: PublicCalendarData }) {
  const groups = groupEvents(data.events);

  if (groups.length === 0) {
    return (
      <div className="public-calendar public-calendar--empty notion-text notion-text__content">
        <p>No public calendar events are currently listed.</p>
      </div>
    );
  }

  return (
    <div className="public-calendar">
      {groups.map(([day, events]) => (
        <section className="public-calendar__day" key={day}>
          <h2 className="public-calendar__day-title">{formatDay(day)}</h2>
          <ol className="public-calendar__events">
            {events.map((event) => (
              <li className="public-calendar__event" key={event.id}>
                <span
                  className="public-calendar__event-color"
                  style={{ background: event.colorHex ?? "#9b9a97" }}
                  aria-hidden="true"
                />
                <div className="public-calendar__event-main">
                  <div className="public-calendar__event-topline">
                    <span className="public-calendar__event-time">
                      {formatTime(event)}
                    </span>
                    <strong className="public-calendar__event-title">
                      {event.title}
                    </strong>
                  </div>
                  {event.visibility === "full" && event.location ? (
                    <p className="public-calendar__event-meta">{event.location}</p>
                  ) : null}
                  {event.visibility === "full" && event.description ? (
                    <p className="public-calendar__event-description">
                      {event.description}
                    </p>
                  ) : null}
                  {event.visibility === "full" && event.url ? (
                    <p className="public-calendar__event-link">
                      <a href={event.url}>Event link</a>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
