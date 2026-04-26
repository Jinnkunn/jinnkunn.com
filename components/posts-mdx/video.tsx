import { Embed } from "./embed";

// Wraps Embed for known video providers, deriving an iframe-friendly src.
// Falls back to the raw URL for unknown kinds so authors aren't blocked.
function youtubeSrc(url: string): string {
  const match = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : url;
}

function vimeoSrc(url: string): string {
  const match = url.match(/vimeo\.com\/(\d+)/);
  return match ? `https://player.vimeo.com/video/${match[1]}` : url;
}

export function Video({
  url,
  kind,
  title = "Video",
}: {
  url: string;
  kind?: "youtube" | "vimeo" | "video";
  title?: string;
}) {
  if (kind === "video") {
    return (
      <figure className="notion-video mdx-video">
        <video controls preload="metadata" src={url} />
      </figure>
    );
  }
  const src =
    kind === "youtube" ? youtubeSrc(url) : kind === "vimeo" ? vimeoSrc(url) : url;
  return <Embed src={src} title={title} />;
}
