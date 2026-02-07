export type V2Link = {
  label: string;
  href: string;
  hint?: string;
};

export type V2Tag = {
  label: string;
  detail?: string;
};

export const v2Site = {
  name: "Jinkun Chen",
  pronouns: "he/him/his",
  role: "Ph.D. student in Computer Science",
  affiliation: "Dalhousie University",
  locationLine: "Halifax, Canada",
  intro:
    "I work on Explainable AI, AI for Science, and Visualization, with an emphasis on fairness and open-ended co-evolution in LM-based agents. I also care about reliable long-term memory for LLMs and LLM-based agents.",
  tags: [
    { label: "Explainable AI", detail: "Interpretability and human trust" },
    { label: "AI for Science", detail: "Scientific workflows and discovery" },
    { label: "Visualization", detail: "Interfaces for reasoning" },
    { label: "Fairness", detail: "Responsible ML systems" },
    { label: "Agents", detail: "Open-ended co-evolution" },
    { label: "Memory", detail: "Long-term, reliable recall" },
  ] satisfies V2Tag[],
  links: [
    { label: "Email", href: "mailto:i@jinkunchen.com", hint: "i@jinkunchen.com" },
    { label: "GitHub", href: "https://github.com/Jinnkunn" },
    { label: "LinkedIn", href: "https://www.linkedin.com/in/jinkun-chen/" },
    { label: "X", href: "https://x.com/_jinnkunn" },
  ] satisfies V2Link[],
  selected: {
    publications: [
      {
        title: "Selected Publications (placeholder)",
        venue: "Add your top 3 to 6 papers here",
        year: "2024",
        href: "/v2/publications",
      },
      {
        title: "Another Paper Title (placeholder)",
        venue: "Conference / Journal",
        year: "2023",
        href: "/v2/publications",
      },
    ],
    works: [
      {
        title: "Selected Work (placeholder)",
        desc: "A project highlight with a one-line takeaway.",
        href: "/v2/works",
      },
      {
        title: "Another Work (placeholder)",
        desc: "Keep these short and scannable.",
        href: "/v2/works",
      },
    ],
  },
};

