import type {
  EditorAttrSpec,
  EditorBlockExtensionSpec,
  EditorBlockSpec,
  EditorBlockType,
  EditorExtensionGroup,
  EditorExtensionManifest,
  EditorTextMarkExtensionSpec,
  EditorTextMarkSpec,
  EditorTextMarkType,
} from "./types.ts";
import { listBlockSpecs, listTextMarkSpecs } from "./wasm.ts";

const EMPTY_ATTRS: EditorAttrSpec[] = [];

const BLOCK_GROUPS: Partial<Record<EditorBlockType, EditorExtensionGroup>> = {
  paragraph: "basic",
  heading: "basic",
  quote: "basic",
  divider: "basic",
  todo: "basic",
  "bulleted-list": "basic",
  "numbered-list": "basic",
  "code-block": "format",
  callout: "format",
  image: "media",
  toggle: "basic",
  table: "advanced",
  bookmark: "embed",
  embed: "embed",
  file: "media",
  "page-link": "navigation",
  raw: "advanced",
};

const STRUCTURED_BLOCKS = new Set<EditorBlockType>(["image", "bookmark", "embed", "file", "page-link"]);
const VOID_BLOCKS = new Set<EditorBlockType>(["divider"]);
const CONTAINER_BLOCKS = new Set<EditorBlockType>(["toggle", "table"]);

const BLOCK_ATTRS: Partial<Record<EditorBlockType, EditorAttrSpec[]>> = {
  image: [
    { name: "url", label: "URL", valueType: "url", placeholder: "https://image.jpg", required: true },
    { name: "alt", label: "Alt", valueType: "string", placeholder: "Image description" },
  ],
  bookmark: [
    { name: "url", label: "URL", valueType: "url", placeholder: "https://", required: true },
  ],
  embed: [
    { name: "url", label: "URL", valueType: "url", placeholder: "https://", required: true },
  ],
  file: [
    { name: "url", label: "URL", valueType: "url", placeholder: "https://", required: true },
  ],
  "page-link": [
    { name: "href", label: "Href", valueType: "string", placeholder: "/page", required: true },
  ],
  callout: [
    { name: "tone", label: "Tone", valueType: "select", defaultValue: "note", values: ["note", "info", "warning"] },
  ],
  "code-block": [
    { name: "language", label: "Language", valueType: "string", placeholder: "typescript" },
  ],
};

const MARK_ATTRS: Partial<Record<EditorTextMarkType, EditorAttrSpec[]>> = {
  link: [
    { name: "href", label: "URL", valueType: "url", placeholder: "https:// or /page", required: true },
  ],
  "icon-link": [
    { name: "icon", label: "Icon URL", valueType: "url", placeholder: "/icon.svg" },
  ],
  "text-color": [
    { name: "color", label: "Color", valueType: "color", required: true, values: ["default", "gray", "orange", "blue"] },
  ],
  "background-color": [
    {
      name: "color",
      label: "Background",
      valueType: "color",
      required: true,
      values: ["default", "yellow", "orange", "blue"],
    },
  ],
};

function blockRenderKind(blockType: EditorBlockType): EditorBlockExtensionSpec["renderKind"] {
  if (STRUCTURED_BLOCKS.has(blockType)) return "structured";
  if (VOID_BLOCKS.has(blockType)) return "void";
  if (CONTAINER_BLOCKS.has(blockType)) return "container";
  return "text";
}

function withBlockExtensionFields(spec: EditorBlockSpec): EditorBlockExtensionSpec {
  return {
    ...spec,
    attrsSchema: BLOCK_ATTRS[spec.blockType] ?? EMPTY_ATTRS,
    group: BLOCK_GROUPS[spec.blockType] ?? "advanced",
    renderKind: blockRenderKind(spec.blockType),
    slashMenu: true,
  };
}

function withTextMarkExtensionFields(spec: EditorTextMarkSpec): EditorTextMarkExtensionSpec {
  return {
    ...spec,
    attrsSchema: MARK_ATTRS[spec.mark] ?? EMPTY_ATTRS,
    group: spec.kind === "color" ? "format" : spec.kind === "toggle" ? "basic" : "navigation",
    toolbar: true,
  };
}

export function createDefaultEditorExtensionManifest(): EditorExtensionManifest {
  return {
    id: "jinnkunn.default",
    label: "Jinnkunn Editor",
    version: "0.1.0",
    blocks: listBlockSpecs().map(withBlockExtensionFields),
    textMarks: listTextMarkSpecs().map(withTextMarkExtensionFields),
  };
}

export function mergeEditorExtensionManifests(manifests: EditorExtensionManifest[]): EditorExtensionManifest {
  const [first, ...rest] = manifests;
  const merged: EditorExtensionManifest = {
    id: first?.id ?? "jinnkunn.empty",
    label: first?.label ?? "Empty Editor",
    version: first?.version ?? "0.0.0",
    blocks: [],
    textMarks: [],
  };
  const blocks = new Map<string, EditorBlockExtensionSpec>();
  const textMarks = new Map<string, EditorTextMarkExtensionSpec>();

  for (const manifest of [first, ...rest].filter(Boolean)) {
    for (const block of manifest.blocks) blocks.set(block.name, block);
    for (const mark of manifest.textMarks) textMarks.set(mark.mark, mark);
  }

  merged.blocks = Array.from(blocks.values());
  merged.textMarks = Array.from(textMarks.values());
  return merged;
}

export function getBlockExtensionSpec(
  manifest: EditorExtensionManifest,
  blockType: EditorBlockType,
  level?: 1 | 2 | 3,
): EditorBlockExtensionSpec | null {
  return manifest.blocks.find((spec) => spec.blockType === blockType && (spec.level ?? 1) === (level ?? 1)) ?? null;
}

export function getTextMarkExtensionSpec(
  manifest: EditorExtensionManifest,
  mark: EditorTextMarkType,
): EditorTextMarkExtensionSpec | null {
  return manifest.textMarks.find((spec) => spec.mark === mark) ?? null;
}
