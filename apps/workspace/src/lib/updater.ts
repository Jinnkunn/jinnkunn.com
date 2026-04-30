// Wrapper around `@tauri-apps/plugin-updater`. Surfaces a single
// `runUpdateCheck()` entrypoint used by both the startup auto-check
// (App.tsx fires it once, ~10 s after mount) and the command-palette
// "Check for updates" action.
//
// Why a wrapper rather than calling the plugin directly:
//   - Centralizes the "ask user → download → install → relaunch"
//     prompt chain so the two trigger sites share UX.
//   - Lets the non-Tauri preview build (`npm run dev` in a regular
//     browser) no-op cleanly instead of throwing on plugin import.
//   - Hooks the existing `notify` helper so a successful or failed
//     update gets a system-level toast — important when the update
//     prompt's `confirm()` dialog isn't visible because the window is
//     hidden in the menubar tray.
//
// The plugin handles the signature dance: latest.json → SHA verify →
// download → ed25519 verify against the embedded pubkey → swap. We
// just orchestrate the user-facing flow.

import { check } from "@tauri-apps/plugin-updater";

import { notify } from "./notify";

export type UpdateCheckOutcome =
  | { kind: "up-to-date"; currentVersion: string }
  | { kind: "available"; nextVersion: string; currentVersion: string }
  | { kind: "installed"; nextVersion: string }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

export interface RunUpdateCheckOptions {
  /** When true the user gets a `confirm()` dialog before download. The
   * startup auto-check uses this; the palette path passes false to
   * always offer (matches the operator's explicit intent). */
  promptBeforeDownload?: boolean;
  /** When true a "no update available" notification fires on the
   * up-to-date branch. The startup auto-check sets false (silent on
   * the happy path); the palette path sets true so a manual click
   * always gets feedback. */
  notifyOnUpToDate?: boolean;
}

export async function runUpdateCheck(
  options: RunUpdateCheckOptions = {},
): Promise<UpdateCheckOutcome> {
  const promptBeforeDownload = options.promptBeforeDownload ?? true;
  const notifyOnUpToDate = options.notifyOnUpToDate ?? false;

  let update;
  try {
    update = await check();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Common cases:
    //   - "could not parse the response as a release schema" → updater
    //     endpoint returned 404 or HTML (often when running before the
    //     first published release).
    //   - "operation not permitted" → capabilities/default.json missing
    //     `updater:default`.
    // Either way the operator can't fix it from inside the app, so we
    // surface the message + don't pop a notification (would be noise on
    // a startup auto-check).
    return { kind: "error", message };
  }
  if (!update) {
    if (notifyOnUpToDate) {
      void notify({
        title: "Workspace is up to date",
        body: "No newer release published.",
      });
    }
    return { kind: "up-to-date", currentVersion: "" };
  }

  // The update is available. Confirm before downloading on the auto-
  // check path; explicit operator triggers go straight to download.
  if (promptBeforeDownload) {
    const accepted = window.confirm(
      `Workspace v${update.version} is available (you're on ${update.currentVersion}). Download and install now?`,
    );
    if (!accepted) {
      return {
        kind: "available",
        nextVersion: update.version,
        currentVersion: update.currentVersion,
      };
    }
  }

  try {
    await update.downloadAndInstall();
    void notify({
      title: `Updating to v${update.version}`,
      body: "Workspace will relaunch when ready.",
    });
    return { kind: "installed", nextVersion: update.version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void notify({
      title: "Workspace update failed",
      body: message,
    });
    return { kind: "error", message };
  }
}

/** No-op in non-Tauri preview builds. The dynamic-import sidesteps the
 * plugin's load-on-import behaviour (which throws when Tauri's IPC
 * bridge isn't injected). The Vite dev server in a regular browser
 * goes through this path; the bundled Tauri webview does not. */
export async function runUpdateCheckSafely(
  options: RunUpdateCheckOptions = {},
): Promise<UpdateCheckOutcome> {
  if (typeof window === "undefined") {
    return { kind: "unsupported" };
  }
  // The plugin throws "window.__TAURI_IPC__ is undefined" when called
  // from a non-Tauri context (e.g. running the workspace UI in regular
  // Chrome). Detect by checking for the Tauri IPC bridge before
  // calling.
  const tauriBridge = (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"];
  if (!tauriBridge) {
    return { kind: "unsupported" };
  }
  return runUpdateCheck(options);
}
