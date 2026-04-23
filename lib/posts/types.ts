export type PostFrontmatter = {
  title: string;
  date: string; // ISO date "YYYY-MM-DD" or full ISO timestamp
  description?: string;
  draft?: boolean;
  tags?: string[];
  cover?: string;
  ogImage?: string;
};

export type PostEntry = {
  slug: string;
  href: string;
  title: string;
  dateText: string; // Display-friendly ("January 5, 2026")
  dateIso: string; // YYYY-MM-DD
  description: string | null;
  draft: boolean;
  tags: string[];
  wordCount: number;
  readingMinutes: number;
};
