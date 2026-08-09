import assert from "node:assert/strict";
import test from "node:test";

import {
  NEWS_ENTRY_FIELDS,
  PUBLICATION_ENTRY_FIELDS,
  TEACHING_ENTRY_FIELDS,
  WORKS_ENTRY_FIELDS,
  structuredCollectionSearchValues,
} from "../../app/site-admin/site-admin-structured-collection-schema.ts";
import {
  formatMonthRangePeriod,
  parseMonthRangePeriod,
} from "../../app/site-admin/site-admin-month-range.ts";

function field(fields, key) {
  const result = fields.find((candidate) => candidate.key === key);
  assert.ok(result, `missing field schema: ${key}`);
  return result;
}

test("structured collection schema edits News, Teaching, and Works entries", () => {
  const news = { id: "news-1", type: "entry", date: "2026-08-01", body: "Before" };
  const nextNews = field(NEWS_ENTRY_FIELDS, "body").write(news, "After");
  assert.equal(nextNews.body, "After");
  assert.equal(nextNews.id, news.id);
  assert.equal(field(NEWS_ENTRY_FIELDS, "date").inputType, "date");

  const teaching = {
    id: "teaching-1",
    term: "2026/27",
    period: "Fall",
    role: "Instructor",
    courseCode: "CSCI 0000",
    courseName: "Systems",
  };
  const nextTeaching = field(TEACHING_ENTRY_FIELDS, "courseUrl").write(
    teaching,
    "https://example.com/course",
  );
  assert.equal(nextTeaching.courseUrl, "https://example.com/course");
  assert.ok(structuredCollectionSearchValues(nextTeaching, TEACHING_ENTRY_FIELDS).includes("Systems"));

  const work = {
    id: "works-1",
    category: "recent",
    role: "Researcher",
    period: "2026",
    body: "Work body",
  };
  const nextWork = field(WORKS_ENTRY_FIELDS, "category").write(work, "passed");
  assert.equal(nextWork.category, "passed");
  assert.equal(field(WORKS_ENTRY_FIELDS, "body").wide, true);
  assert.equal(field(WORKS_ENTRY_FIELDS, "period").control, "month-range");
});

test("work period month ranges parse and format existing content", () => {
  assert.deepEqual(parseMonthRangePeriod("Nov 2025 - Feb 2026"), {
    start: "2025-11",
    end: "2026-02",
    ongoing: false,
    valid: true,
  });
  assert.deepEqual(parseMonthRangePeriod("September 2019 – Now"), {
    start: "2019-09",
    end: "",
    ongoing: true,
    valid: true,
  });
  assert.equal(
    formatMonthRangePeriod({ start: "2025-11", end: "2026-02", ongoing: false }),
    "Nov 2025 – Feb 2026",
  );
  assert.equal(
    formatMonthRangePeriod({ start: "2019-09", end: "", ongoing: true }),
    "Sep 2019 – Now",
  );
});

test("publication schema preserves rich authors and non-primary venues", () => {
  const publication = {
    id: "publication-1",
    title: "A paper",
    year: "2026",
    url: "",
    labels: ["Oral"],
    authors: ["Jinkun Chen", "Vlado Keselj"],
    authorsRich: [
      { name: "Jinkun Chen", isSelf: true },
      { name: "Vlado Keselj", isSelf: false },
    ],
    venues: [
      { type: "Conference", text: "ACL" },
      { type: "DOI", text: "DOI", url: "https://doi.org/example" },
    ],
  };

  const renamedAuthors = field(PUBLICATION_ENTRY_FIELDS, "authors").write(
    publication,
    "Jinkun Chen, Evangelos Milios",
  );
  assert.deepEqual(renamedAuthors.authors, ["Jinkun Chen", "Evangelos Milios"]);
  assert.equal(renamedAuthors.authorsRich[0].isSelf, true);

  const highlighted = field(PUBLICATION_ENTRY_FIELDS, "selfAuthor").write(
    renamedAuthors,
    "Evangelos Milios",
  );
  assert.equal(
    highlighted.authorsRich.find((author) => author.isSelf)?.name,
    "Evangelos Milios",
  );

  const nextVenue = field(PUBLICATION_ENTRY_FIELDS, "venue").write(highlighted, "EMNLP");
  assert.equal(nextVenue.venue, "EMNLP");
  assert.equal(nextVenue.venues[0].text, "EMNLP");
  assert.equal(nextVenue.venues[1].type, "DOI");

  const nextLabels = field(PUBLICATION_ENTRY_FIELDS, "labels").write(
    nextVenue,
    "Oral, Best Paper, Oral",
  );
  assert.deepEqual(nextLabels.labels, ["Oral", "Best Paper", "Oral"]);
});

test("structured collection schemas expose stable field keys", () => {
  assert.deepEqual(NEWS_ENTRY_FIELDS.map((item) => item.key), ["date", "body"]);
  assert.deepEqual(TEACHING_ENTRY_FIELDS.map((item) => item.key), [
    "term",
    "period",
    "role",
    "courseCode",
    "courseName",
    "instructor",
    "courseUrl",
  ]);
  assert.ok(PUBLICATION_ENTRY_FIELDS.some((item) => item.key === "selfAuthor"));
  assert.ok(PUBLICATION_ENTRY_FIELDS.some((item) => item.key === "venueUrl"));
});
