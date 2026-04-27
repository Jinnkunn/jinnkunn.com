import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createNamespacedSecureStorage } from "../../lib/secureStorage";
import { siteAdminBrowserLogin } from "../../lib/tauri";
import {
  cfAccessIdStoreKeyForBase,
  cfAccessSecretStoreKeyForBase,
  siteAdminRequest,
  tokenStoreKeyForBase,
  type SiteAdminRequestResult,
} from "./api";
import type {
  ConnectionProfile,
  ConnectionState,
  MessageKind,
  MessageState,
  NormalizedApiResponse,
  PageListRow,
  PostListRow,
} from "./types";
import {
  decodeJwtPayload,
  isMutatingHttpMethod,
  isProductionSiteAdminConnection,
  normalizeString,
  serializeJson,
  toIsoFromEpochSeconds,
} from "./utils";

const STAGING_BASE_URL = "https://staging.jinkunchen.com";
const PRODUCTION_BASE_URL = "https://jinkunchen.com";
const DEFAULT_BASE_URL = STAGING_BASE_URL;
const LOCAL_STORAGE_KEY = "workspace.site-admin.connection.v1";
const PROFILES_STORAGE_KEY = "workspace.site-admin.profiles.v1";
const POSTS_GROUPING_STORAGE_KEY = "workspace.site-admin.postsGrouping.v1";
const DEFAULT_PROFILE_ID = "default";
const STAGING_PROFILE_ID = "staging";
const PRODUCTION_PROFILE_ID = "production";

export type PostsGrouping = "all" | "drafts" | "published" | "by-year";

const POSTS_GROUPING_VALUES: ReadonlyArray<PostsGrouping> = [
  "all",
  "drafts",
  "published",
  "by-year",
];

function loadPostsGrouping(): PostsGrouping {
  try {
    const raw = localStorage.getItem(POSTS_GROUPING_STORAGE_KEY);
    if (!raw) return "all";
    return (POSTS_GROUPING_VALUES as readonly string[]).includes(raw)
      ? (raw as PostsGrouping)
      : "all";
  } catch {
    return "all";
  }
}

function persistPostsGrouping(mode: PostsGrouping): void {
  try {
    localStorage.setItem(POSTS_GROUPING_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private-mode errors
  }
}

// Per-tool secure storage namespace. Each feature module gets its own
// prefix in the system keychain so e.g. a future calendar tool can't
// read site-admin's tokens.
const secureStorage = createNamespacedSecureStorage("site-admin");

interface ConnectionMeta {
  login: string;
  expiresAt: string;
}

interface DebugResponseState {
  title: string;
  body: string;
}

export interface SiteAdminContextValue {
  // Connection
  connection: ConnectionState;
  setBaseUrl: (next: string) => void;
  saveConnectionLocally: () => void;
  signInWithBrowser: () => Promise<string>;
  clearAuth: () => Promise<void>;
  setCfAccessServiceToken: (
    clientId: string,
    clientSecret: string,
  ) => Promise<void>;
  clearCfAccessServiceToken: () => Promise<void>;

  // Message banner
  message: MessageState;
  setMessage: (kind: MessageKind, text: string) => void;
  clearMessage: () => void;

  // Debug response pane (last API invocation)
  debugResponse: DebugResponseState;
  writeDebugResponse: (title: string, payload: unknown) => void;

  // Dev drawer — collapsible bottom drawer that hosts ResponsePane +
  // other debug tooling. Hidden by default; user toggles via topbar
  // button or ⌘\.
  drawerOpen: boolean;
  toggleDrawer: () => void;
  setDrawerOpen: (open: boolean) => void;

  // Shared indexes — panels push their most-recently-fetched list here
  // so the command palette can search post/page titles without doing its
  // own fetch. Source of truth is still the panel; this is a snapshot.
  postsIndex: PostListRow[];
  pagesIndex: PageListRow[];
  setPostsIndex: (rows: PostListRow[]) => void;
  setPagesIndex: (rows: PageListRow[]) => void;

  // Bumped after any post/page mutation (create/update/delete). The
  // sidebar's eager-fetch effect listens for changes to refresh its
  // tree without waiting for the user to revisit the Posts/Pages panel.
  contentRevision: number;
  bumpContentRevision: () => void;

  // Sidebar grouping mode for posts. Controls how SiteAdminContent
  // folds the posts list into a SurfaceNavItem tree under the "Posts"
  // row. Persisted across reloads.
  postsGrouping: PostsGrouping;
  setPostsGrouping: (mode: PostsGrouping) => void;

  // Connection profiles — named environments (Local, Staging, Prod, …)
  // each with its own baseUrl. Credentials in the keyring are still
  // keyed by baseUrl, so switching profiles picks up the right token
  // automatically.
  profiles: ConnectionProfile[];
  activeProfileId: string;
  switchProfile: (id: string) => void;
  addProfile: (label: string, baseUrl: string) => string;
  renameProfile: (id: string, label: string) => void;
  removeProfile: (id: string) => void;

  // API helper — performs request + mirrors into the debug pane.
  request: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Promise<NormalizedApiResponse>;
}

const SiteAdminContext = createContext<SiteAdminContextValue | null>(null);

export function useSiteAdmin(): SiteAdminContextValue {
  const ctx = useContext(SiteAdminContext);
  if (!ctx) {
    throw new Error(
      "useSiteAdmin must be used inside <SiteAdminProvider>. Did you forget to wrap the surface?",
    );
  }
  return ctx;
}

interface PersistedConnection {
  baseUrl: string;
  authLogin: string;
  authExpiresAt: string;
}

function loadPersistedConnection(): PersistedConnection {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return { baseUrl: DEFAULT_BASE_URL, authLogin: "", authExpiresAt: "" };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedConnection>;
    return {
      baseUrl: normalizeString(parsed.baseUrl) || DEFAULT_BASE_URL,
      authLogin: normalizeString(parsed.authLogin),
      authExpiresAt: normalizeString(parsed.authExpiresAt),
    };
  } catch {
    return { baseUrl: DEFAULT_BASE_URL, authLogin: "", authExpiresAt: "" };
  }
}

function persistConnection(connection: ConnectionState) {
  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify({
      baseUrl: connection.baseUrl,
      authLogin: connection.authLogin,
      authExpiresAt: connection.authExpiresAt,
    }),
  );
}

interface ProfilesEnvelope {
  profiles: ConnectionProfile[];
  activeProfileId: string;
}

function loadProfiles(): ProfilesEnvelope {
  // Try the explicit profiles envelope first.
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProfilesEnvelope>;
      const profiles = Array.isArray(parsed.profiles)
        ? parsed.profiles
            .map((p) => {
              if (!p || typeof p !== "object") return null;
              const id = normalizeString((p as ConnectionProfile).id);
              const label = normalizeString((p as ConnectionProfile).label);
              const baseUrl = normalizeString(
                (p as ConnectionProfile).baseUrl,
              );
              if (!id || !baseUrl) return null;
              return { id, label: label || id, baseUrl } as ConnectionProfile;
            })
            .filter((p): p is ConnectionProfile => p !== null)
        : [];
      if (profiles.length > 0) {
        const activeFromStorage = normalizeString(parsed.activeProfileId);
        const activeProfileId = profiles.some((p) => p.id === activeFromStorage)
          ? activeFromStorage
          : profiles[0].id;
        return { profiles, activeProfileId };
      }
    }
  } catch {
    // fall through to migration
  }

  // Migration: first run after upgrade → seed explicit environments.
  // Staging is the daily editing target; production remains available
  // for inspection while real promotion stays guarded by the runbook.
  const legacy = loadPersistedConnection();
  const legacyBase = normalizeString(legacy.baseUrl);
  const seeded: ConnectionProfile[] = [
    {
      id: STAGING_PROFILE_ID,
      label: "Staging",
      baseUrl: STAGING_BASE_URL,
    },
    {
      id: PRODUCTION_PROFILE_ID,
      label: "Production",
      baseUrl: PRODUCTION_BASE_URL,
    },
  ];
  const legacyMatchesSeed = seeded.some(
    (profile) =>
      profile.baseUrl.replace(/\/+$/, "").toLowerCase() ===
      legacyBase.replace(/\/+$/, "").toLowerCase(),
  );
  if (legacyBase && !legacyMatchesSeed) {
    seeded.push({
      id: DEFAULT_PROFILE_ID,
      label: "Legacy",
      baseUrl: legacyBase,
    });
  }
  return {
    profiles: seeded,
    activeProfileId: STAGING_PROFILE_ID,
  };
}

function persistProfiles(envelope: ProfilesEnvelope) {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // quota / serialization — drop silently
  }
}

function randomProfileId(): string {
  // No need for crypto strength — this is just a stable client-local key.
  return `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function SiteAdminProvider({ children }: { children: ReactNode }) {
  // Load profiles once, eagerly, and use the result to seed both the
  // profiles state and the connection's initial baseUrl. This guarantees
  // the two slots start in sync even if the legacy connection storage
  // points at a different URL than the user's last active profile.
  const [profilesState, setProfilesEnvelope] = useState<ProfilesEnvelope>(
    () => loadProfiles(),
  );
  const { profiles, activeProfileId } = profilesState;
  const [connection, setConnection] = useState<ConnectionState>(() => {
    const persisted = loadPersistedConnection();
    const initialActive = profilesState.profiles.find(
      (p) => p.id === profilesState.activeProfileId,
    );
    return {
      baseUrl: initialActive?.baseUrl || persisted.baseUrl,
      authToken: "",
      authLogin: persisted.authLogin,
      authExpiresAt: persisted.authExpiresAt,
      authLoading: false,
      cfAccessClientId: "",
      cfAccessClientSecret: "",
    };
  });
  const [message, setMessageState] = useState<MessageState>({ kind: "", text: "" });
  const [debugResponse, setDebugResponse] = useState<DebugResponseState>({
    title: "",
    body: "",
  });
  const [drawerOpen, setDrawerOpenState] = useState(false);
  const [postsIndex, setPostsIndexState] = useState<PostListRow[]>([]);
  const [pagesIndex, setPagesIndexState] = useState<PageListRow[]>([]);
  const [contentRevision, setContentRevisionState] = useState(0);
  const [postsGrouping, setPostsGroupingState] = useState<PostsGrouping>(() =>
    loadPostsGrouping(),
  );

  const bumpContentRevision = useCallback(() => {
    setContentRevisionState((prev) => prev + 1);
  }, []);

  const setPostsGrouping = useCallback((mode: PostsGrouping) => {
    setPostsGroupingState(mode);
    persistPostsGrouping(mode);
  }, []);

  const toggleDrawer = useCallback(() => {
    setDrawerOpenState((prev) => !prev);
  }, []);

  const setDrawerOpen = useCallback((open: boolean) => {
    setDrawerOpenState(open);
  }, []);

  const setPostsIndex = useCallback((rows: PostListRow[]) => {
    setPostsIndexState(rows);
  }, []);

  const setPagesIndex = useCallback((rows: PageListRow[]) => {
    setPagesIndexState(rows);
  }, []);

  // Auto-dismiss timer for `success` / `info` messages. Errors + warnings
  // stay pinned until the user acts on them or another message overwrites.
  const autoDismissRef = useRef<number | null>(null);
  const cancelAutoDismiss = useCallback(() => {
    if (autoDismissRef.current !== null) {
      window.clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
  }, []);

  const setMessage = useCallback(
    (kind: MessageKind, text: string) => {
      const safe = normalizeString(text);
      cancelAutoDismiss();
      if (!safe) {
        setMessageState({ kind: "", text: "" });
        return;
      }
      setMessageState({ kind, text: safe });
      if (kind === "success" || kind === "info") {
        autoDismissRef.current = window.setTimeout(() => {
          setMessageState({ kind: "", text: "" });
          autoDismissRef.current = null;
        }, 5000);
      }
    },
    [cancelAutoDismiss],
  );

  const clearMessage = useCallback(() => {
    cancelAutoDismiss();
    setMessageState({ kind: "", text: "" });
  }, [cancelAutoDismiss]);

  // Clean up any pending timer on unmount. (Provider typically lives for
  // the whole session, but the test harness + hot-reload do tear it down.)
  useEffect(() => {
    return cancelAutoDismiss;
  }, [cancelAutoDismiss]);

  const writeDebugResponse = useCallback((title: string, payload: unknown) => {
    const body = typeof payload === "string" ? payload : serializeJson(payload);
    setDebugResponse({ title, body });
  }, []);

  // Keep the active profile's baseUrl in sync with the connection input
  // so switching profiles later picks up whatever the user typed.
  const setBaseUrl = useCallback(
    (next: string) => {
      setConnection((prev) => ({ ...prev, baseUrl: next }));
      setProfilesEnvelope((prev) => {
        const nextProfiles = prev.profiles.map((p) =>
          p.id === prev.activeProfileId ? { ...p, baseUrl: next } : p,
        );
        const envelope = {
          profiles: nextProfiles,
          activeProfileId: prev.activeProfileId,
        };
        persistProfiles(envelope);
        return envelope;
      });
    },
    [],
  );

  const switchProfile = useCallback(
    (id: string) => {
      setProfilesEnvelope((prev) => {
        const target = prev.profiles.find((p) => p.id === id);
        if (!target) return prev;
        // Point the connection at the new profile's baseUrl — the keyring-
        // reload effect keyed on baseUrl will pick up the matching token.
        setConnection((c) => ({ ...c, baseUrl: target.baseUrl }));
        const envelope = {
          profiles: prev.profiles,
          activeProfileId: id,
        };
        persistProfiles(envelope);
        return envelope;
      });
    },
    [],
  );

  const addProfile = useCallback((label: string, baseUrl: string): string => {
    const id = randomProfileId();
    const safeLabel = normalizeString(label) || "Untitled";
    const safeBase = normalizeString(baseUrl) || DEFAULT_BASE_URL;
    setProfilesEnvelope((prev) => {
      const envelope = {
        profiles: [...prev.profiles, { id, label: safeLabel, baseUrl: safeBase }],
        activeProfileId: prev.activeProfileId,
      };
      persistProfiles(envelope);
      return envelope;
    });
    return id;
  }, []);

  const renameProfile = useCallback((id: string, label: string) => {
    const safeLabel = normalizeString(label);
    if (!safeLabel) return;
    setProfilesEnvelope((prev) => {
      const envelope = {
        profiles: prev.profiles.map((p) =>
          p.id === id ? { ...p, label: safeLabel } : p,
        ),
        activeProfileId: prev.activeProfileId,
      };
      persistProfiles(envelope);
      return envelope;
    });
  }, []);

  const removeProfile = useCallback((id: string) => {
    setProfilesEnvelope((prev) => {
      if (prev.profiles.length <= 1) return prev; // never leave zero profiles
      const nextProfiles = prev.profiles.filter((p) => p.id !== id);
      let nextActive = prev.activeProfileId;
      if (nextActive === id) {
        nextActive = nextProfiles[0].id;
        // Move connection to the new active profile's baseUrl.
        setConnection((c) => ({ ...c, baseUrl: nextProfiles[0].baseUrl }));
      }
      const envelope = { profiles: nextProfiles, activeProfileId: nextActive };
      persistProfiles(envelope);
      return envelope;
    });
  }, []);

  const saveConnectionLocally = useCallback(() => {
    setConnection((prev) => {
      persistConnection(prev);
      return prev;
    });
    setMessage("success", "Connection saved locally.");
  }, [setMessage]);

  const updateAuth = useCallback(
    (token: string, meta: ConnectionMeta = { login: "", expiresAt: "" }) => {
      setConnection((prev) => {
        const normalizedToken = normalizeString(token);
        if (!normalizedToken) {
          const next: ConnectionState = {
            ...prev,
            authToken: "",
            authLogin: "",
            authExpiresAt: "",
          };
          persistConnection(next);
          return next;
        }
        const jwt = decodeJwtPayload(normalizedToken);
        const login =
          normalizeString(meta.login) ||
          normalizeString(jwt?.sub as unknown) ||
          prev.authLogin;
        const expiresAt =
          normalizeString(meta.expiresAt) ||
          toIsoFromEpochSeconds(jwt?.exp) ||
          prev.authExpiresAt;
        const next: ConnectionState = {
          ...prev,
          authToken: normalizedToken,
          authLogin: login,
          authExpiresAt: expiresAt,
        };
        persistConnection(next);
        return next;
      });
    },
    [],
  );

  // On first mount (and whenever baseUrl changes) try to read previously
  // stored credentials from the keyring: the legacy bearer app token AND
  // the Cloudflare Access service-token pair. Silent on miss because the
  // user may be about to sign in fresh.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const tokenKey = tokenStoreKeyForBase(connection.baseUrl);
      const cfIdKey = cfAccessIdStoreKeyForBase(connection.baseUrl);
      const cfSecretKey = cfAccessSecretStoreKeyForBase(connection.baseUrl);
      setConnection((prev) => ({ ...prev, authLoading: true }));
      try {
        const [token, cfId, cfSecret] = await Promise.all([
          secureStorage.get(tokenKey),
          secureStorage.get(cfIdKey),
          secureStorage.get(cfSecretKey),
        ]);
        if (cancelled) return;
        updateAuth(normalizeString(token ?? ""));
        setConnection((prev) => ({
          ...prev,
          cfAccessClientId: normalizeString(cfId ?? ""),
          cfAccessClientSecret: normalizeString(cfSecret ?? ""),
        }));
      } catch (err) {
        if (cancelled) return;
        updateAuth("");
        // Outside the Tauri webview (browser dev / Vite preview / tests) the
        // `invoke` global isn't injected, so the secure-storage call always
        // throws a TypeError. That's not a real failure — there's just no
        // keyring to read. Suppress the noise and rely on the connection
        // pill's "Not connected" tone instead. Real Tauri keyring errors
        // (file lock, permission denied, etc.) still surface as before.
        const message = err instanceof Error ? err.message : String(err);
        const isMissingTauriBridge =
          /Cannot read properties of undefined \(reading 'invoke'\)|window\.__TAURI__|undefined is not an object/i.test(
            message,
          );
        if (!isMissingTauriBridge) {
          setMessage(
            "error",
            "Couldn't read saved credentials from the keyring. Reconnect from the connection menu to retry.",
          );
        }
      } finally {
        if (!cancelled) {
          setConnection((prev) => ({ ...prev, authLoading: false }));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [connection.baseUrl, updateAuth, setMessage]);

  const signInWithBrowser = useCallback(async (): Promise<string> => {
    const baseUrl = normalizeString(connection.baseUrl);
    if (!baseUrl) {
      setMessage("error", "Missing API base URL.");
      return "";
    }
    setConnection((prev) => ({ ...prev, authLoading: true }));
    try {
      const result = await siteAdminBrowserLogin(baseUrl);
      const token = normalizeString(result?.token);
      const login = normalizeString(result?.login);
      const expiresAt = normalizeString(result?.expires_at);
      if (!token) {
        setMessage("error", "Browser login did not return an app token.");
        return "";
      }
      const key = tokenStoreKeyForBase(baseUrl);
      await secureStorage.set(key, token);
      updateAuth(token, { login, expiresAt });
      setMessage("success", "Browser sign-in completed. App token stored securely.");
      return token;
    } catch (err) {
      setMessage("error", `Browser sign-in failed: ${String(err)}`);
      return "";
    } finally {
      setConnection((prev) => ({ ...prev, authLoading: false }));
    }
  }, [connection.baseUrl, setMessage, updateAuth]);

  const setCfAccessServiceToken = useCallback(
    async (clientId: string, clientSecret: string) => {
      const idTrimmed = normalizeString(clientId);
      const secretTrimmed = normalizeString(clientSecret);
      const idKey = cfAccessIdStoreKeyForBase(connection.baseUrl);
      const secretKey = cfAccessSecretStoreKeyForBase(connection.baseUrl);
      try {
        if (idTrimmed && secretTrimmed) {
          await secureStorage.set(idKey, idTrimmed);
          await secureStorage.set(secretKey, secretTrimmed);
          setConnection((prev) => ({
            ...prev,
            cfAccessClientId: idTrimmed,
            cfAccessClientSecret: secretTrimmed,
          }));
          setMessage("success", "Cloudflare Access service token stored.");
          return;
        }
        setMessage("warn", "Both Client ID and Client Secret are required.");
      } catch (err) {
        setMessage("error", `Failed to store CF Access token: ${String(err)}`);
      }
    },
    [connection.baseUrl, setMessage],
  );

  const clearCfAccessServiceToken = useCallback(async () => {
    const idKey = cfAccessIdStoreKeyForBase(connection.baseUrl);
    const secretKey = cfAccessSecretStoreKeyForBase(connection.baseUrl);
    try {
      await secureStorage.delete(idKey);
      await secureStorage.delete(secretKey);
      setConnection((prev) => ({
        ...prev,
        cfAccessClientId: "",
        cfAccessClientSecret: "",
      }));
      setMessage("success", "Cloudflare Access service token cleared.");
    } catch (err) {
      setMessage("error", `Failed to clear CF Access token: ${String(err)}`);
    }
  }, [connection.baseUrl, setMessage]);

  const clearAuth = useCallback(async () => {
    const key = tokenStoreKeyForBase(connection.baseUrl);
    setConnection((prev) => ({ ...prev, authLoading: true }));
    try {
      await secureStorage.delete(key);
      updateAuth("");
      setMessage("success", "App token cleared.");
    } catch (err) {
      setMessage("error", `Failed to clear app token: ${String(err)}`);
    } finally {
      setConnection((prev) => ({ ...prev, authLoading: false }));
    }
  }, [connection.baseUrl, setMessage, updateAuth]);

  // Single-flight reauth promise. When multiple requests fan out and all
  // come back 401, only the first triggers signInWithBrowser; the rest
  // await the same promise and reuse the freshly-issued token. Cleared
  // once the in-flight reauth resolves (success or failure).
  const reauthPromiseRef = useRef<Promise<string> | null>(null);

  const requestOnce = useCallback(
    async (
      path: string,
      method: string,
      body: unknown,
      authToken: string,
    ): Promise<{ result: SiteAdminRequestResult }> => {
      const result = await siteAdminRequest({
        baseUrl: connection.baseUrl,
        authToken,
        path,
        method,
        body,
        cfAccessClientId: connection.cfAccessClientId,
        cfAccessClientSecret: connection.cfAccessClientSecret,
      });
      return { result };
    },
    [
      connection.baseUrl,
      connection.cfAccessClientId,
      connection.cfAccessClientSecret,
    ],
  );

  const request = useCallback(
    async (
      path: string,
      method = "GET",
      body: unknown = null,
    ): Promise<NormalizedApiResponse> => {
      if (
        isProductionSiteAdminConnection(connection.baseUrl) &&
        isMutatingHttpMethod(method) &&
        !path.startsWith("/api/site-admin/app-auth/")
      ) {
        const normalizedMethod = normalizeString(method || "GET").toUpperCase();
        const err: NormalizedApiResponse = {
          ok: false,
          status: 0,
          code: "PRODUCTION_READ_ONLY",
          error:
            "Production profile is read-only. Switch to Staging to save content/settings, then promote to production.",
          raw: null,
        };
        writeDebugResponse(`${normalizedMethod} ${path} (blocked)`, err);
        return err;
      }
      const first = await requestOnce(path, method, body, connection.authToken);
      const firstResp = first.result.response;
      const wasUnauthorized =
        firstResp.status === 401 ||
        (!firstResp.ok && firstResp.code === "UNAUTHORIZED");
      // Skip auto-retry for the actual sign-in / token-issue endpoints to
      // avoid a recursive loop if the auth flow itself returns 401. Also
      // skip when there's no baseUrl (would hit the same MISSING_BASE_URL
      // short-circuit) or when the user never had a token in the first
      // place (initial load — the disconnected notice handles that path).
      const skipRetry =
        !wasUnauthorized ||
        !connection.baseUrl ||
        !connection.authToken ||
        path.startsWith("/api/site-admin/app-auth/");
      if (skipRetry) {
        writeDebugResponse(first.result.debugTitle, first.result.debugBody);
        return first.result.response;
      }
      // Single-flight: if a reauth is already in flight, await it; else
      // start one. The promise resolves to the new token (empty string
      // if the user cancelled or sign-in failed).
      if (!reauthPromiseRef.current) {
        reauthPromiseRef.current = signInWithBrowser().finally(() => {
          reauthPromiseRef.current = null;
        });
      }
      const newToken = await reauthPromiseRef.current;
      if (!newToken) {
        // Reauth failed or user cancelled — surface the original 401.
        writeDebugResponse(first.result.debugTitle, first.result.debugBody);
        return first.result.response;
      }
      // Retry exactly once with the freshly-issued token.
      const second = await requestOnce(path, method, body, newToken);
      writeDebugResponse(second.result.debugTitle, second.result.debugBody);
      return second.result.response;
    },
    [
      connection.authToken,
      connection.baseUrl,
      requestOnce,
      signInWithBrowser,
      writeDebugResponse,
    ],
  );

  const value = useMemo<SiteAdminContextValue>(
    () => ({
      connection,
      setBaseUrl,
      saveConnectionLocally,
      signInWithBrowser,
      clearAuth,
      setCfAccessServiceToken,
      clearCfAccessServiceToken,
      message,
      setMessage,
      clearMessage,
      debugResponse,
      writeDebugResponse,
      drawerOpen,
      toggleDrawer,
      setDrawerOpen,
      postsIndex,
      pagesIndex,
      setPostsIndex,
      setPagesIndex,
      contentRevision,
      bumpContentRevision,
      postsGrouping,
      setPostsGrouping,
      profiles,
      activeProfileId,
      switchProfile,
      addProfile,
      renameProfile,
      removeProfile,
      request,
    }),
    [
      connection,
      setBaseUrl,
      saveConnectionLocally,
      signInWithBrowser,
      clearAuth,
      setCfAccessServiceToken,
      clearCfAccessServiceToken,
      message,
      setMessage,
      clearMessage,
      debugResponse,
      writeDebugResponse,
      drawerOpen,
      toggleDrawer,
      setDrawerOpen,
      postsIndex,
      pagesIndex,
      setPostsIndex,
      setPagesIndex,
      contentRevision,
      bumpContentRevision,
      postsGrouping,
      setPostsGrouping,
      profiles,
      activeProfileId,
      switchProfile,
      addProfile,
      renameProfile,
      removeProfile,
      request,
    ],
  );

  return (
    <SiteAdminContext.Provider value={value}>{children}</SiteAdminContext.Provider>
  );
}
