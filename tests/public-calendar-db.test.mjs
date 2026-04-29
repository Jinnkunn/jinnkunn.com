import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  readPublicCalendarFromDb,
  writePublicCalendarToDb,
} from "../lib/server/public-calendar-db.ts";

async function makeCalendarDb() {
  const client = createClient({ url: ":memory:" });
  const schema = await readFile(
    path.join(process.cwd(), "migrations/003_calendar_public.sql"),
    "utf8",
  );
  await client.executeMultiple(schema);
  return client;
}

test("public-calendar-db: writes and reads normalized public events", async () => {
  const client = await makeCalendarDb();
  await writePublicCalendarToDb(
    {
      schemaVersion: 1,
      generatedAt: "2026-04-28T12:00:00.000Z",
      range: {
        startsAt: "2026-04-28T00:00:00.000Z",
        endsAt: "2026-05-28T00:00:00.000Z",
      },
      events: [
        {
          id: "full",
          title: "Talk",
          startsAt: "2026-04-30T15:00:00.000Z",
          endsAt: "2026-04-30T16:00:00.000Z",
          isAllDay: false,
          visibility: "full",
          description: "Public detail",
          location: "Room 1",
          url: "https://example.com/talk",
        },
        {
          id: "busy",
          title: "Secret",
          startsAt: "2026-04-29T15:00:00.000Z",
          endsAt: "2026-04-29T16:00:00.000Z",
          isAllDay: false,
          visibility: "busy",
          description: "Private detail",
          location: "Room 2",
          url: "https://example.com/secret",
          colorHex: "#FF0000",
        },
      ],
    },
    client,
  );

  const data = await readPublicCalendarFromDb(client);
  assert.ok(data);
  assert.equal(data.generatedAt, "2026-04-28T12:00:00.000Z");
  assert.deepEqual(
    data.events.map((event) => event.id),
    ["busy", "full"],
  );
  assert.equal(data.events[0].title, "Busy");
  assert.equal(data.events[0].description, null);
  assert.equal(data.events[0].colorHex, "#9B9A97");
  assert.equal(data.events[1].description, "Public detail");
});

test("public-calendar-db: missing migration degrades to null/no-op", async () => {
  const client = createClient({ url: ":memory:" });
  assert.equal(await readPublicCalendarFromDb(client), null);
  await assert.doesNotReject(() =>
    writePublicCalendarToDb({ events: [] }, client),
  );
});
