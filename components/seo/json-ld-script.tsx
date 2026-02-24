type JsonLdValue = Record<string, unknown> | Array<Record<string, unknown>>;

function stringifyJsonLd(value: JsonLdValue): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default function JsonLdScript({
  id,
  data,
}: {
  id: string;
  data: JsonLdValue;
}) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: stringifyJsonLd(data) }}
    />
  );
}
