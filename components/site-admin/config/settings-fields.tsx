"use client";

import type { ReactNode } from "react";

import { asString } from "./utils";

export function SiteAdminFormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="site-admin-form__row">
      <label className="site-admin-form__label">{label}</label>
      {children}
    </div>
  );
}

type TextFieldRowProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
};

export function SiteAdminTextFieldRow({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: TextFieldRowProps) {
  return (
    <SiteAdminFormRow label={label}>
      <input
        className={`site-admin-form__input${mono ? " site-admin-form__input--mono" : ""}`}
        value={asString(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </SiteAdminFormRow>
  );
}

type TextAreaRowProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
};

export function SiteAdminTextAreaRow({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: TextAreaRowProps) {
  return (
    <SiteAdminFormRow label={label}>
      <textarea
        className={`site-admin-form__textarea${mono ? " site-admin-form__textarea--mono" : ""}`}
        value={asString(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </SiteAdminFormRow>
  );
}

type SwitchRowProps = {
  label: string;
  checked: boolean;
  text: string;
  onChange: (next: boolean) => void;
};

export function SiteAdminSwitchRow({
  label,
  checked,
  text,
  onChange,
}: SwitchRowProps) {
  return (
    <SiteAdminFormRow label={label}>
      <label className="site-admin-form__switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{text}</span>
      </label>
    </SiteAdminFormRow>
  );
}

export type DepthFieldKey = "pages" | "blog" | "publications" | "teaching";

export type DepthFieldItem = {
  key: DepthFieldKey;
  value: string;
};

type DepthGridRowProps = {
  label: string;
  fields: DepthFieldItem[];
  onChange: (key: DepthFieldKey, value: string) => void;
};

export function SiteAdminDepthGridRow({
  label,
  fields,
  onChange,
}: DepthGridRowProps) {
  return (
    <SiteAdminFormRow label={label}>
      <div className="site-admin-form__depth-grid">
        {fields.map((field) => (
          <label key={field.key} className="site-admin-form__depth-item">
            <span>{field.key}</span>
            <input
              className="site-admin-form__input site-admin-form__input--mono"
              inputMode="numeric"
              value={asString(field.value)}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder="-"
            />
          </label>
        ))}
      </div>
    </SiteAdminFormRow>
  );
}
