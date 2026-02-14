export function normalizeGithubUser(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

export function normalizeGithubUserList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const item of values) {
    const login = normalizeGithubUser(item);
    if (!login) continue;
    seen.add(login);
  }
  return [...seen];
}

export function parseGithubUserCsv(raw: unknown): string[] {
  return String(raw ?? "")
    .split(",")
    .map(normalizeGithubUser)
    .filter(Boolean);
}
