"use client";

import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/classic.css";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  clearTextInCurrentBlockCommand,
  htmlAttr,
} from "@milkdown/kit/preset/commonmark";
import { insert, replaceAll } from "@milkdown/kit/utils";
import { useEffect, useRef, useState } from "react";

import { uploadSiteAdminAsset } from "./site-admin-media-library";
import styles from "./site-admin-dashboard.module.css";

type SiteAdminVisualEditorProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  minHeight: number;
  placeholder?: string;
  disabled?: boolean;
  allowImageUpload?: boolean;
  onVisualError?: (message: string) => void;
};

const componentIcon = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M8 5 3 12l5 7M16 5l5 7-5 7M14 3l-4 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

function mdxComponentName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.match(/^\s*<([A-Z][A-Za-z0-9.]*)\b/)?.[1] || "";
}

export function SiteAdminVisualEditor({
  label,
  value,
  onChange,
  minHeight,
  placeholder,
  disabled = false,
  allowImageUpload = true,
  onVisualError,
}: SiteAdminVisualEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const onVisualErrorRef = useRef(onVisualError);
  const disabledRef = useRef(disabled);
  const lastMarkdownRef = useRef(value);
  const [editorError, setEditorError] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
    onVisualErrorRef.current = onVisualError;
  }, [onChange, onVisualError]);

  useEffect(() => {
    disabledRef.current = disabled;
    crepeRef.current?.setReadonly(disabled);
  }, [disabled]);

  useEffect(() => {
    if (!rootRef.current) return;
    let disposed = false;

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: lastMarkdownRef.current,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholder || "Write, or type / for commands…",
          mode: "doc",
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file: File) => {
            if (!allowImageUpload) throw new Error("Image uploads are disabled here.");
            const asset = await uploadSiteAdminAsset(file);
            return asset.url;
          },
          blockCaptionPlaceholderText: "Add a caption",
          blockUploadPlaceholderText: "Paste an image URL",
          inlineUploadPlaceholderText: "Paste an image URL",
          maxWidth: 1600,
          maxHeight: 1200,
        },
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            builder.getGroup("advanced").addItem("mdx-component", {
              label: "MDX component",
              icon: componentIcon,
              onRun: (ctx) => {
                const requested = window.prompt("Component name", "Component")?.trim();
                const name = requested?.match(/^[A-Z][A-Za-z0-9.]*$/)?.[0];
                if (!name) return;
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                insert(`<${name} />`)(ctx);
              },
            });
          },
        },
      },
    });

    crepe.editor.config((ctx) => {
      ctx.update(htmlAttr.key, (previous) => (node) => {
        const attrs = previous(node);
        const component = mdxComponentName(node.attrs.value);
        if (!component) return attrs;
        return {
          ...attrs,
          "data-mdx-component": component,
          "aria-label": `${component} MDX component. Edit in Source mode.`,
          title: `${component} component · edit in Source mode`,
        };
      });
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        lastMarkdownRef.current = markdown;
        onChangeRef.current(markdown);
      });
    });

    crepe
      .create()
      .then(() => {
        if (disposed) return;
        crepeRef.current = crepe;
        crepe.setReadonly(disabledRef.current);
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dom.setAttribute("aria-label", label);
        });
        setEditorError("");
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        setEditorError(message);
        onVisualErrorRef.current?.(message);
      });

    return () => {
      disposed = true;
      crepeRef.current = null;
      void crepe.destroy();
    };
  }, [allowImageUpload, label, placeholder]);

  useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe || value === lastMarkdownRef.current) return;
    lastMarkdownRef.current = value;
    crepe.editor.action(replaceAll(value));
  }, [value]);

  return (
    <div className={styles.visualEditorShell} style={{ minHeight }}>
      {editorError ? (
        <div className={styles.visualEditorError} role="alert">
          <strong>Visual editor could not open this MDX.</strong>
          <span>Switch to Source to edit the original content safely.</span>
        </div>
      ) : null}
      <div ref={rootRef} className={styles.visualEditor} style={{ minHeight }} />
    </div>
  );
}
