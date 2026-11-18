export function normalizeWorksAffiliation(value: string): string {
  // This legacy record accumulated HTML escaping before the editor fixed round trips.
  return /^Sino Gateway Media &(?:amp;)+ Marketing Ltd\.$/.test(value)
    ? "Sino Gateway Media & Marketing Ltd."
    : value;
}
