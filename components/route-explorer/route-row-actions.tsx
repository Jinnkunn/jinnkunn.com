"use client";

import { IconButton } from "./icon-button";
import { copyToClipboard } from "./utils";

export function RouteRowActions({
  routePath,
  pageId,
  adminOpen,
  onToggleAdmin,
}: {
  routePath: string;
  pageId: string;
  adminOpen: boolean;
  onToggleAdmin: () => void;
}) {
  return (
    <div className="routes-tree__actions">
      <IconButton href={routePath} label={`Open ${routePath}`} title="Open page">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
          <path
            d="M14 4h6v6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 14 20 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 14v6H4V4h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>

      <IconButton
        label={`Copy URL ${routePath}`}
        onClick={() => void copyToClipboard(routePath)}
        title="Copy URL"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
          <path
            d="M8 8h10v12H8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>

      <IconButton
        label={`Copy page id ${pageId}`}
        onClick={() => void copyToClipboard(pageId)}
        title="Copy page id"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
          <path
            d="M4 7.5A3.5 3.5 0 0 1 7.5 4h7A3.5 3.5 0 0 1 18 7.5v9A3.5 3.5 0 0 1 14.5 20h-7A3.5 3.5 0 0 1 4 16.5v-9Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M8 9h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M8 13h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </IconButton>

      <IconButton
        label={adminOpen ? "Close settings" : "Open settings"}
        onClick={onToggleAdmin}
        className={adminOpen ? "is-active" : ""}
        title={adminOpen ? "Close settings" : "Settings"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
          <path
            d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M19.4 15a8.9 8.9 0 0 0 .1-1 8.9 8.9 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8.2 8.2 0 0 0-1.7-1l-.4-2.6H11l-.4 2.6a8.2 8.2 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a8.9 8.9 0 0 0-.1 1 8.9 8.9 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a8.2 8.2 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8.2 8.2 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>
    </div>
  );
}
