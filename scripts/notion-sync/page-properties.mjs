import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { extractFirstDateProperty } from "./date-utils.mjs";

function calendarIconSvg16() {
  // Matches the icon used in Super's page properties ("Date").
  return `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><path d="M3.29688 14.4561H12.7031C14.1797 14.4561 14.9453 13.6904 14.9453 12.2344V3.91504C14.9453 2.45215 14.1797 1.69336 12.7031 1.69336H3.29688C1.82031 1.69336 1.05469 2.45215 1.05469 3.91504V12.2344C1.05469 13.6973 1.82031 14.4561 3.29688 14.4561ZM3.27637 13.1162C2.70898 13.1162 2.39453 12.8154 2.39453 12.2207V5.9043C2.39453 5.30273 2.70898 5.00879 3.27637 5.00879H12.71C13.2842 5.00879 13.6055 5.30273 13.6055 5.9043V12.2207C13.6055 12.8154 13.2842 13.1162 12.71 13.1162H3.27637Z"></path></svg>`;
}

function personIconSvg16() {
  // Matches the icon used in Super's page properties ("Person").
  return `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><path d="M10.9536 7.90088C12.217 7.90088 13.2559 6.79468 13.2559 5.38525C13.2559 4.01514 12.2114 2.92017 10.9536 2.92017C9.70142 2.92017 8.65137 4.02637 8.65698 5.39087C8.6626 6.79468 9.69019 7.90088 10.9536 7.90088ZM4.4231 8.03003C5.52368 8.03003 6.42212 7.05859 6.42212 5.83447C6.42212 4.63843 5.51245 3.68945 4.4231 3.68945C3.33374 3.68945 2.41846 4.64966 2.41846 5.84009C2.42407 7.05859 3.32251 8.03003 4.4231 8.03003ZM1.37964 13.168H5.49561C4.87231 12.292 5.43384 10.6074 6.78711 9.51807C6.18628 9.14746 5.37769 8.87231 4.4231 8.87231C1.95239 8.87231 0.262207 10.6917 0.262207 12.1628C0.262207 12.7974 0.548584 13.168 1.37964 13.168ZM7.50024 13.168H14.407C15.4009 13.168 15.7322 12.8423 15.7322 12.2864C15.7322 10.8489 13.8679 8.88354 10.9536 8.88354C8.04492 8.88354 6.17505 10.8489 6.17505 12.2864C6.17505 12.8423 6.50635 13.168 7.50024 13.168Z"></path></svg>`;
}

function extractFirstPeopleProperty(page) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const [name, v] of Object.entries(props)) {
    if (!v || typeof v !== "object") continue;
    if (v.type !== "people") continue;
    const people = Array.isArray(v.people) ? v.people : [];
    const names = people.map((p) => String(p?.name || "").trim()).filter(Boolean);
    if (!names.length) continue;
    return { name, id: String(v.id || ""), names };
  }
  return null;
}

export function renderPagePropertiesFromPageObject(pageObj) {
  const date = extractFirstDateProperty(pageObj);
  const people = extractFirstPeopleProperty(pageObj);

  const props = [];

  if (date) {
    const propId = date.id ? String(date.id).replace(/[^a-z0-9]/gi, "") : "";
    const dateClass = propId ? ` property-${escapeHtml(propId)}` : "";
    props.push(
      `<div class="notion-page__property"><div class="notion-page__property-name-wrapper"><div class="notion-page__property-icon-wrapper">${calendarIconSvg16()}</div><div class="notion-page__property-name"><span>${escapeHtml(
        date.name,
      )}</span></div></div><div class="notion-property notion-property__date${dateClass} notion-semantic-string"><span class="date">${escapeHtml(
        date.text,
      )}</span></div></div>`,
    );
  }

  if (people) {
    const propId = people.id ? String(people.id).replace(/[^a-z0-9]/gi, "") : "";
    const personClass = propId ? ` property-${escapeHtml(propId)}` : "";
    const primary = people.names[0] || "Person";
    const avatarLetter = escapeHtml(primary.trim().slice(0, 1).toUpperCase() || "P");
    props.push(
      `<div class="notion-page__property"><div class="notion-page__property-name-wrapper"><div class="notion-page__property-icon-wrapper">${personIconSvg16()}</div><div class="notion-page__property-name"><span>${escapeHtml(
        people.name,
      )}</span></div></div><div class="notion-property notion-property__person${personClass} notion-semantic-string no-wrap"><span class="individual-with-image"><div class="individual-letter-avatar">${avatarLetter}</div><span>${escapeHtml(
        primary,
      )}</span></span></div></div>`,
    );
  }

  if (!props.length) return "";
  return `<div class="notion-page__properties">${props.join("")}<div id="block-root-divider" class="notion-divider"></div></div>`;
}
