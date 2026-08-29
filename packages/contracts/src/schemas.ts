import { z } from "zod";

export const apiErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
    code: z.string().optional(),
  })
  .passthrough();

export const apiSuccessEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    data: z.unknown(),
  })
  .passthrough();

export const fileSourceVersionSchema = z.object({ fileSha: z.string() });

export const documentLoadSchema = z
  .object({
    source: z.string(),
    version: z.string().optional(),
    sourceVersion: fileSourceVersionSchema.optional(),
  })
  .passthrough();

export const documentSaveSchema = z
  .object({
    version: z.string().optional(),
    sourceVersion: fileSourceVersionSchema.optional(),
  })
  .passthrough();

export const listSnapshotSchema = z.union([
  z.array(z.unknown()),
  z.object({ rows: z.array(z.unknown()) }).passthrough(),
]);

const nullableString = z.string().nullable();
const nonNegativeInt = z.number().int().nonnegative();

export const postListRowSchema = z
  .object({
    slug: z.string().trim().min(1),
    href: z.string().optional(),
    title: z.string().optional(),
    dateIso: nullableString.optional(),
    dateText: nullableString.optional(),
    description: nullableString.optional(),
    draft: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    wordCount: nonNegativeInt.optional(),
    readingMinutes: nonNegativeInt.optional(),
    version: z.string().optional(),
  })
  .passthrough();

export const pageListRowSchema = z
  .object({
    slug: z.string().trim().min(1),
    href: z.string().optional(),
    title: z.string().optional(),
    description: nullableString.optional(),
    updatedIso: nullableString.optional(),
    draft: z.boolean().optional(),
    wordCount: nonNegativeInt.optional(),
    readingMinutes: nonNegativeInt.optional(),
    version: z.string().optional(),
  })
  .passthrough();

export const siteAdminConfigCommandInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("settings"),
      rowId: z.unknown().optional(),
      patch: z.record(z.unknown()).optional(),
      expectedSiteConfigSha: z.unknown().optional(),
      allowStaleSiteConfigSha: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("nav-update"),
      rowId: z.unknown().optional(),
      patch: z.record(z.unknown()).optional(),
      expectedSiteConfigSha: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("nav-create"),
      input: z.record(z.unknown()).optional(),
      expectedSiteConfigSha: z.unknown().optional(),
    })
    .passthrough(),
]);

export const siteAdminRoutesCommandInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("override"),
      pageId: z.unknown().optional(),
      routePath: z.unknown().optional(),
      expectedSiteConfigSha: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("protected"),
      pageId: z.unknown().optional(),
      path: z.unknown().optional(),
      auth: z.unknown().optional(),
      password: z.unknown().optional(),
      expectedProtectedRoutesSha: z.unknown().optional(),
    })
    .passthrough(),
]);

export type SiteAdminConfigCommandInput = z.infer<
  typeof siteAdminConfigCommandInputSchema
>;
export type SiteAdminRoutesCommandInput = z.infer<
  typeof siteAdminRoutesCommandInputSchema
>;
