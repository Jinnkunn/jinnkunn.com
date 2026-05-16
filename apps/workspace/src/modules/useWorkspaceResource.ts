import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  deriveWorkspaceDataHealth,
  type WorkspaceDataHealth,
  type WorkspaceDataSource,
} from "./workspaceDataHealth";

export interface WorkspaceResourceOptions<T> {
  enabled?: boolean;
  getSummary?: (data: T) => string;
  hasData?: (data: T) => boolean;
  ignoreError?: (error: unknown) => boolean;
  initialData: T | (() => T);
  load: () => Promise<T>;
  onError?: (error: unknown) => void;
  onSuccess?: (data: T) => void;
  source?: WorkspaceDataSource;
}

export interface WorkspaceResource<T> {
  data: T;
  error: unknown;
  hasLoaded: boolean;
  health: WorkspaceDataHealth;
  lastLoadedAt: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setData: Dispatch<SetStateAction<T>>;
}

export function useWorkspaceResource<T>({
  enabled = true,
  getSummary,
  hasData,
  ignoreError,
  initialData,
  load,
  onError,
  onSuccess,
  source = "local",
}: WorkspaceResourceOptions<T>): WorkspaceResource<T> {
  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<unknown>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const next = await load();
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setData(next);
      setError(null);
      setHasLoaded(true);
      setLastLoadedAt(Date.now());
      setLoading(false);
      onSuccess?.(next);
    } catch (caught) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      if (ignoreError?.(caught)) {
        setError(null);
        setLoading(false);
        return;
      }
      setError(caught);
      setLoading(false);
      onError?.(caught);
    }
  }, [enabled, ignoreError, load, onError, onSuccess]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const health = deriveWorkspaceDataHealth({
    error,
    hasData: hasLoaded && (hasData ? hasData(data) : true),
    hasLoaded,
    loading,
    source,
    summary: hasLoaded && getSummary ? getSummary(data) : "",
    updatedAt: lastLoadedAt,
  });

  return {
    data,
    error,
    hasLoaded,
    health,
    lastLoadedAt,
    loading,
    refresh,
    setData,
  };
}
