"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminActionDialog({ title, children, onClose, busy = false, wide = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <dialog ref={ref} className={styles.actionDialog} data-wide={wide} aria-label={title}
      onKeyDown={handleKeyDown}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Close dialog" title="Close">×</Button>
      </header>
      {children}
    </dialog>
  );
}
