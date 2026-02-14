import path from "node:path";

import { hydrateBlocks, listBlockChildrenCached } from "../../lib/notion/index.mjs";
import { renderDatabaseMain, renderPageMain } from "./render-page.mjs";
import { routePathToHtmlRel } from "./route-model.mjs";
import { buildSearchIndexFieldsFromBlocks } from "./search-text.mjs";
import { readJsonFile, writeFile, writeJsonAtomic } from "./fs-utils.mjs";
import { getPageInfo } from "./page-meta.mjs";

function cacheFile(cacheDir, kind, id) {
  const safeKind = String(kind || "misc").replace(/[^a-z0-9_-]/gi, "_");
  const safeId = String(id || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return path.join(cacheDir, safeKind, `${safeId}.json`);
}

export async function renderPagesAndBuildSearchIndex({
  allPages,
  cfg,
  ctx,
  outRawDir,
  cacheDir,
  cacheEnabled,
  cacheForce,
  searchMaxChars = 8_000,
  log = console.log,
}) {
  const searchIndex = [];

  for (const p of allPages) {
    const mainHtml = await (p.kind === "database"
      ? (async () => {
          const childTitles = (p.children || [])
            .filter((x) => x && x.kind !== "database")
            .map((x) => String(x.title || "").trim())
            .filter(Boolean)
            .join("\n");
          const dbTextRaw = `${p.title}\n${childTitles}`.trim();
          const dbText = dbTextRaw.length > searchMaxChars
            ? dbTextRaw.slice(0, searchMaxChars).trim()
            : dbTextRaw;
          searchIndex.push({
            id: p.id,
            title: p.title,
            kind: p.kind,
            routePath: p.routePath,
            text: dbText,
          });
          return renderDatabaseMain(p, cfg, ctx);
        })()
      : (async () => {
          let lastEdited = "";
          try {
            if (p.__page?.last_edited_time) lastEdited = String(p.__page.last_edited_time || "").trim();
          } catch {
            // ignore
          }
          if (!lastEdited) {
            // Fetch page metadata (cheap) so we can validate the build cache.
            try {
              lastEdited = (await getPageInfo(p.id)).lastEdited || "";
            } catch {
              // ignore
            }
          }

          const pageRenderCachePath = cacheFile(cacheDir, "page-render", p.id);
          if (cacheEnabled && !cacheForce && lastEdited) {
            const cached = readJsonFile(pageRenderCachePath);
            const cachedEdited = cached?.lastEdited ? String(cached.lastEdited) : "";
            if (cached && cachedEdited === lastEdited && typeof cached.html === "string") {
              const text = String(cached.text || "").trim();
              searchIndex.push({
                id: p.id,
                title: p.title,
                kind: p.kind,
                routePath: p.routePath,
                headings: Array.isArray(cached.headings) ? cached.headings : [],
                text,
              });
              return String(cached.html);
            }
          }

          const blocks = await hydrateBlocks(await listBlockChildrenCached(p.id));
          const fields = buildSearchIndexFieldsFromBlocks(blocks);
          searchIndex.push({
            id: p.id,
            title: p.title,
            kind: p.kind,
            routePath: p.routePath,
            headings: fields.headings,
            text: fields.text,
          });
          const html = await renderPageMain(p, blocks, cfg, ctx);

          if (cacheEnabled && !cacheForce && lastEdited) {
            try {
              writeJsonAtomic(pageRenderCachePath, {
                lastEdited,
                html,
                text: fields.text,
                headings: fields.headings,
              });
            } catch {
              // ignore cache write failures
            }
          }

          return html;
        })());

    const rel = routePathToHtmlRel(p.routePath);
    const outPath = path.join(outRawDir, rel);
    writeFile(outPath, mainHtml + "\n");
    log(`[sync:notion] Wrote ${rel}`);
  }

  return searchIndex;
}
