export type DeployVersionMetadata = {
  sourceSha: string | null;
  sourceBranch: string | null;
  codeSha: string | null;
  codeBranch: string | null;
  contentSha: string | null;
  contentBranch: string | null;
};

export type ExpectedDeployVersionMetadata = {
  codeSha?: string | null;
  contentSha?: string | null;
  contentBranch?: string | null;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSha(value: unknown): string | null {
  const raw = cleanString(value).toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw : null;
}

function cleanBranch(value: unknown): string | null {
  const raw = cleanString(value);
  return raw || null;
}

export function parseDeployMetadataMessage(value: unknown): DeployVersionMetadata {
  const message = cleanString(value);
  const token = (name: string): string => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = new RegExp(`\\b${escaped}=([^\\s]+)`, "i").exec(message);
    return hit?.[1] ?? "";
  };
  const sourceSha = cleanSha(token("source")) || cleanSha(token("sourcesha"));
  const sourceBranch = cleanBranch(token("branch"));
  const contentSha = cleanSha(token("content")) || sourceSha;
  const contentBranch = cleanBranch(token("contentBranch")) || sourceBranch;
  return {
    sourceSha,
    sourceBranch,
    codeSha: cleanSha(token("code")),
    codeBranch: cleanBranch(token("codeBranch")),
    contentSha,
    contentBranch,
  };
}

export function pickRuntimeCodeSha(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    cleanSha(env.ACTIVE_DEPLOY_CODE_SHA) ||
    cleanSha(env.DEPLOYED_CODE_SHA) ||
    cleanSha(env.ACTIVE_DEPLOY_SOURCE_SHA) ||
    cleanSha(env.DEPLOYED_SOURCE_SHA) ||
    cleanSha(env.VERCEL_GIT_COMMIT_SHA) ||
    cleanSha(env.GITHUB_SHA) ||
    cleanSha(env.CF_COMMIT_SHA) ||
    cleanSha(env.CF_PAGES_COMMIT_SHA)
  );
}

export function buildDeployMetadataMessage(input: {
  label: string;
  codeSha?: string | null;
  codeBranch?: string | null;
  contentSha?: string | null;
  contentBranch?: string | null;
  dirty?: boolean;
}): string {
  const parts = [input.label.trim() || "Deploy"];
  const contentSha = cleanSha(input.contentSha);
  const codeSha = cleanSha(input.codeSha);
  const contentBranch = cleanBranch(input.contentBranch);
  const codeBranch = cleanBranch(input.codeBranch);
  if (contentSha) parts.push(`source=${contentSha}`, `content=${contentSha}`);
  if (contentBranch) parts.push(`branch=${contentBranch}`, `contentBranch=${contentBranch}`);
  if (codeSha) parts.push(`code=${codeSha}`);
  if (codeBranch) parts.push(`codeBranch=${codeBranch}`);
  if (input.dirty) parts.push("dirty=1");
  return parts.join(" ");
}

export function describeDeployMetadataMismatch(input: {
  actual: DeployVersionMetadata;
  expected: ExpectedDeployVersionMetadata;
}): string | null {
  const expectedCode = cleanSha(input.expected.codeSha);
  const expectedContent = cleanSha(input.expected.contentSha);
  const expectedContentBranch = cleanBranch(input.expected.contentBranch);
  if (expectedCode && input.actual.codeSha && input.actual.codeSha !== expectedCode) {
    return `code=${input.actual.codeSha} expected ${expectedCode}`;
  }
  if (expectedCode && !input.actual.codeSha) {
    return `code metadata missing; expected ${expectedCode}`;
  }
  if (
    expectedContent &&
    input.actual.contentSha &&
    input.actual.contentSha !== expectedContent
  ) {
    return `content=${input.actual.contentSha} expected ${expectedContent}`;
  }
  if (expectedContent && !input.actual.contentSha) {
    return `content metadata missing; expected ${expectedContent}`;
  }
  if (
    expectedContentBranch &&
    input.actual.contentBranch &&
    input.actual.contentBranch !== expectedContentBranch
  ) {
    return `contentBranch=${input.actual.contentBranch} expected ${expectedContentBranch}`;
  }
  return null;
}
