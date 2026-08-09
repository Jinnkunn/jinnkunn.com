import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The behavioural rules themselves are covered by
 * site-admin-console-model.test.mjs. These checks only assert that the console
 * is still wired to them, because each of these defects was a wiring mistake:
 * the rule existed, the call site ignored it.
 */

const CONSOLE = readFileSync(
  new URL("../../app/site-admin/site-admin-web-console.tsx", import.meta.url),
  "utf8",
);
const SOURCE_EDITOR = readFileSync(
  new URL("../../app/site-admin/site-admin-source-editor.tsx", import.meta.url),
  "utf8",
);

const SAVE_PATH = CONSOLE.slice(
  CONSOLE.indexOf("async function saveSelectedContent"),
  CONSOLE.indexOf("function reloadConflictVersion"),
);
const SELECT_PATH = CONSOLE.slice(
  CONSOLE.indexOf("async function selectContent"),
  CONSOLE.indexOf("async function saveSelectedContent"),
);

test("a save that outlives its document cannot write the response back", () => {
  assert.match(SAVE_PATH, /const token = selectionGateRef\.current\.current\(\);/);

  const tokenIndex = SAVE_PATH.indexOf("const token = selectionGateRef.current.current();");
  const patchIndex = SAVE_PATH.indexOf('"PATCH"');
  const staleIndex = SAVE_PATH.indexOf("if (selectionGateRef.current.isStale(token)) return;");
  const applyIndex = SAVE_PATH.indexOf("setSelected(next);");
  assert.ok(tokenIndex >= 0 && tokenIndex < patchIndex, "the token must be claimed before the PATCH");
  assert.ok(
    staleIndex > patchIndex && staleIndex < applyIndex,
    "the round-trip response must be discarded before it reaches the editor",
  );

  // The live `selected` may already point at another document by then.
  assert.doesNotMatch(SAVE_PATH, /endpointFor\(selected\.kind, selected\.id\)/);
  assert.match(SAVE_PATH, /endpointFor\(selectedAtStart\.kind, selectedAtStart\.id\)/);
});

test("opening a document claims the selection before its detail request", () => {
  const tokenIndex = SELECT_PATH.indexOf("const token = selectionGateRef.current.open();");
  const readIndex = SELECT_PATH.indexOf("await readJson<EditableDetailPayload>");
  const staleIndex = SELECT_PATH.indexOf("if (selectionGateRef.current.isStale(token)) return false;");
  const applyIndex = SELECT_PATH.indexOf("applySelectedDetail(nextKind, id, detail, token)");
  assert.ok(tokenIndex >= 0 && tokenIndex < readIndex, "the token must be claimed before the GET");
  assert.ok(staleIndex > readIndex && staleIndex < applyIndex);
  assert.ok(applyIndex >= 0, "the claimed token must be forwarded, not re-opened");

  // A second click on a *different* row must still win; only a repeat of the
  // same row is dropped.
  assert.match(SELECT_PATH, /if \(selectionLoadingRef\.current === requestKey\) return false;/);

  // Conflict-resolve and version-restore also apply a detail payload after an
  // await, so they must carry a token too instead of claiming a fresh one.
  assert.doesNotMatch(
    CONSOLE,
    /applySelectedDetail\(selected\.kind, selected\.id, detail\);/,
    "an untokened apply after an await can overwrite a document opened meanwhile",
  );
});

test("autosave stands down outside the document editor", () => {
  const end = CONSOLE.indexOf("}, 1600);");
  assert.ok(end > 0, "expected the 1.6s autosave timer");
  const effect = CONSOLE.slice(
    CONSOLE.lastIndexOf("useEffect(() => {", end),
    CONSOLE.indexOf("]);", end) + 3,
  );
  assert.match(effect, /if \(area !== "content"\) return;/);
  assert.match(effect, /if \(contentMode === "create"\) return;/);
  // Guards that are not dependencies re-arm on the next unrelated render.
  const deps = effect.slice(effect.lastIndexOf("}, ["));
  assert.match(deps, /\barea\b/);
  assert.match(deps, /\bcontentMode\b/);
});

test("the publish queue is gated on the save effects, not called unconditionally", () => {
  const savePath = CONSOLE.slice(
    CONSOLE.indexOf("async function saveSelectedContent"),
    CONSOLE.indexOf("function reloadConflictVersion"),
  );
  assert.match(savePath, /const effects = contentSaveEffects\(options\)/);
  assert.match(savePath, /if \(!effects\.publish\) return;/);

  const publishIndex = savePath.indexOf("queueSavedContentPublish");
  const guardIndex = savePath.indexOf("if (!effects.publish) return;");
  assert.ok(guardIndex >= 0 && guardIndex < publishIndex);
});

test("list reconciliation happens after the mutation try, so it cannot fail the save", () => {
  const savePath = CONSOLE.slice(
    CONSOLE.indexOf("async function saveSelectedContent"),
    CONSOLE.indexOf("function reloadConflictVersion"),
  );
  const finallyIndex = savePath.indexOf("setSaving(false)");
  const reconcileIndex = savePath.indexOf("effects.reconcileLists");
  assert.ok(finallyIndex >= 0 && reconcileIndex > finallyIndex);
  assert.match(CONSOLE, /Promise\.allSettled\(\[\s*readJson<PagesPayload>/);
});

test("autosave never locks a document editor", () => {
  assert.doesNotMatch(
    CONSOLE,
    /<SiteAdminMarkdownEditor[\s\S]{0,400}?disabled=\{saving\}/,
    "autosave sets `saving`; locking the editor with it swallows keystrokes",
  );
  assert.match(CONSOLE, /blocking=\{blockingMutation\}/);
});

test("the CodeMirror view is not rebuilt when props change while typing", () => {
  const createEffect = SOURCE_EDITOR.slice(
    SOURCE_EDITOR.indexOf("const view = new EditorView({"),
  );
  const depsMatch = createEffect.match(/view\.destroy\(\);[\s\S]*?\}, \[(.*?)\]\);/);
  assert.ok(depsMatch, "expected the create effect to end with a dependency array");
  assert.equal(depsMatch[1].trim(), "");
  assert.match(SOURCE_EDITOR, /editableCompartmentRef\.current\.reconfigure/);
});
