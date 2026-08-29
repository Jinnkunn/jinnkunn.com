"use client";

import type { HTMLInputTypeAttribute, ReactNode } from "react";

import { CheckboxRow, Field, Textarea } from "@/components/ui/field";
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
  type?: HTMLInputTypeAttribute;
};

export function SiteAdminTextFieldRow({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  type = "text",
}: TextFieldRowProps) {
  return (
    <SiteAdminFormRow label={label}>
      <Field
        className={`site-admin-form__input${mono ? " site-admin-form__input--mono" : ""}`}
        mono={mono}
        type={type}
        value={asString(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </SiteAdminFormRow>
  );
}

export function SiteAdminSelectFieldRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <SiteAdminFormRow label={label}>
      <select
        className="site-admin-form__select ds-field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
      <Textarea
        className={`site-admin-form__textarea${mono ? " site-admin-form__textarea--mono" : ""}`}
        mono={mono}
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
      <CheckboxRow
        className="site-admin-form__switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      >
        {text}
      </CheckboxRow>
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
            <Field
              className="site-admin-form__input site-admin-form__input--mono"
              mono
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
