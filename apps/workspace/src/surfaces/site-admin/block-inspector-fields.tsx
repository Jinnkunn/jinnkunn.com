import type { ReactNode } from "react";

import { useImeComposition } from "./useImeComposition";

export function InspectorTextField({
  disabled,
  label,
  multiline = false,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  disabled: boolean;
  label: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  const ime = useImeComposition(onChange);
  return (
    <label className="mdx-block-inspector__field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          disabled={disabled}
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={ime.onChange}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
        />
      ) : (
        <input
          disabled={disabled}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={ime.onChange}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
        />
      )}
    </label>
  );
}

export function InspectorSelect({
  children,
  disabled,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="mdx-block-inspector__field">
      <span>{label}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function InspectorFileButton({
  accept,
  disabled,
  label,
  onChange,
}: {
  accept: string;
  disabled: boolean;
  label: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="btn btn--secondary mdx-block-inspector__file">
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
