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
} from "./api";
import type {
  ConnectionState,
  MessageKind,
  MessageState,
  NormalizedApiResponse,
  PageListRow,
  PostListRow,
} from "./types";
import {
  decodeJwtPayload,
  normalizeString,
  serializeJson,
  toIsoFromEpochSeconds,
} from "./utils";

const DEFAULT_BASE_URL = "https://jinkunchen.com";
const LOCAL_STORAGE_KEY = "workspace.site-admin.connection.v1";

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
  signInWithBrowser: () => Promise<void>;
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

export function SiteAdminProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ConnectionState>(() => {
    const persisted = loadPersistedConnection();
    return {
      baseUrl: persisted.baseUrl,
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

  const setBaseUrl = useCallback((next: string) => {
    setConnection((prev) => ({ ...prev, baseUrl: next }));
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
        setMessage("error", `Failed to read secure storage: ${String(err)}`);
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

  const signInWithBrowser = useCallback(async () => {
    const baseUrl = normalizeString(connection.baseUrl);
    if (!baseUrl) {
      setMessage("error", "Missing API base URL.");
      return;
    }
    setConnection((prev) => ({ ...prev, authLoading: true }));
    try {
      const result = await siteAdminBrowserLogin(baseUrl);
      const token = normalizeString(result?.token);
      const login = normalizeString(result?.login);
      const expiresAt = normalizeString(result?.expires_at);
      if (!token) {
        setMessage("error", "Browser login did not return an app token.");
        return;
      }
      const key = tokenStoreKeyForBase(baseUrl);
      await secureStorage.set(key, token);
      updateAuth(token, { login, expiresAt });
      setMessage("success", "Browser sign-in completed. App token stored securely.");
    } catch (err) {
      setMessage("error", `Browser sign-in failed: ${String(err)}`);
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

  const request = useCallback(
    async (
      path: string,
      method = "GET",
      body: unknown = null,
    ): Promise<NormalizedApiResponse> => {
      const result = await siteAdminRequest({
        baseUrl: connection.baseUrl,
        authToken: connection.authToken,
        path,
        method,
        body,
        cfAccessClientId: connection.cfAccessClientId,
        cfAccessClientSecret: connection.cfAccessClientSecret,
      });
      writeDebugResponse(result.debugTitle, result.debugBody);
      return result.response;
    },
    [
      connection.authToken,
      connection.baseUrl,
      connection.cfAccessClientId,
      connection.cfAccessClientSecret,
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
      request,
    ],
  );

  return (
    <SiteAdminContext.Provider value={value}>{children}</SiteAdminContext.Provider>
  );
}
