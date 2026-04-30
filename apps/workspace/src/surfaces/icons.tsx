// Inline SVGs used in the sidebar. Kept small + stroke-based so they
// inherit `color: currentColor` from their parent and swap cleanly
// between light/dark mode and hover/active states.

export const SiteAdminIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.8 2 2.8 3.8 2.8 5.5S9.8 13.5 8 15.5M8 2.5c-1.8 2-2.8 3.8-2.8 5.5S6.2 13.5 8 15.5" />
  </svg>
);

export const CalendarIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2.25" y="3.5" width="11.5" height="10.5" rx="1.5" />
    <path d="M2.25 6.5h11.5M5 2v3M11 2v3" />
  </svg>
);

export const NotesIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 2.5h6.25L13 5.25V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13V4A1.5 1.5 0 0 1 4 2.5Z" />
    <path d="M10 2.75V5.5h2.75M5.5 8h5M5.5 10.5h3.25" />
  </svg>
);

export const TodosIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
    <path d="M5 5.5l1.25 1.25L8.5 4.5M5 10.5h6" />
  </svg>
);

export const WorkspaceIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2.25" y="2.25" width="5" height="5" rx="1.35" />
    <rect x="8.75" y="2.25" width="5" height="5" rx="1.35" />
    <rect x="2.25" y="8.75" width="5" height="5" rx="1.35" />
    <path d="M9.25 11.25h4.5M11.5 9v4.5" />
  </svg>
);

export const StatusIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 8h3l2-5 2 10 2-5h3" />
  </svg>
);

export const ConfigIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" />
  </svg>
);

export const RoutesIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="3.5" cy="4" r="1.25" />
    <circle cx="3.5" cy="12" r="1.25" />
    <circle cx="12.5" cy="8" r="1.25" />
    <path d="M4.75 4h3.5c1.5 0 2.75 1.25 2.75 2.75v.25M4.75 12h3.5c1.5 0 2.75-1.25 2.75-2.75V9" />
  </svg>
);

export const PostsIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 2.75h6.5L13 6.25v7a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 3 2.75Z" />
    <path d="M9.25 2.75v3.5H13" />
    <path d="M5 9h5M5 11.5h3.5" />
  </svg>
);

export const PagesIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="2" width="10" height="12" rx="1.5" />
    <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
  </svg>
);

export const ArchiveIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2.25" y="3" width="11.5" height="3" rx="0.75" />
    <path d="M3.5 6.25v6A1.25 1.25 0 0 0 4.75 13.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-6" />
    <path d="M6.5 9h3" />
  </svg>
);

export const HomeIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 7.25 8 2.75l5.5 4.5" />
    <path d="M4 6.75v6a1.25 1.25 0 0 0 1.25 1.25h5.5A1.25 1.25 0 0 0 12 12.75v-6" />
    <path d="M6.5 14v-3.5h3V14" />
  </svg>
);
