export type PageFrontmatter = {
  title: string;
  description?: string;
  draft?: boolean;
  updated?: string; // optional "last updated" timestamp
};

export type PageEntry = {
  slug: string;
  href: string;
  title: string;
  description: string | null;
  updatedIso: string | null;
  draft: boolean;
  wordCount: number;
  readingMinutes: number;
};
