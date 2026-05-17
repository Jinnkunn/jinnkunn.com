let counter = 0;

export function createEditorId(prefix = "block"): string {
  counter += 1;
  const entropy =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${counter.toString(36)}`;
  return `${prefix}_${entropy}`;
}

