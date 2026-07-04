'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { UserDTO, WorkspaceDTO } from '@noderail/shared';
import { api, ApiError } from './api';

const WS_STORAGE_KEY = 'noderail-workspace';

interface SessionState {
  user: UserDTO | null;
  workspaces: WorkspaceDTO[];
  workspace: WorkspaceDTO | null;
  loading: boolean;
  error: string | null;
  setWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
  addWorkspace: (ws: WorkspaceDTO) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Loads the authenticated session (`/auth/me`) client-side and tracks the
 * currently-selected workspace. On 401 the guarded areas redirect to /login.
 */
export function SessionProvider({
  children,
  requireAuth = false,
}: {
  children: React.ReactNode;
  requireAuth?: boolean;
}) {
  const router = useRouter();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { user: u, workspaces: ws } = await api.me();
      setUser(u);
      setWorkspaces(ws);
      setError(null);
      setCurrentId((prev) => {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_STORAGE_KEY) : null;
        const preferred = prev ?? stored;
        if (preferred && ws.some((w) => w.id === preferred)) return preferred;
        return ws[0]?.id ?? null;
      });
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        setUser(null);
        setWorkspaces([]);
        if (requireAuth) {
          const here =
            typeof window !== 'undefined'
              ? window.location.pathname + window.location.search
              : '/dashboard';
          router.replace(`/login?next=${encodeURIComponent(here)}`);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    } finally {
      setLoading(false);
    }
  }, [requireAuth, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const setWorkspace = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(WS_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const addWorkspace = useCallback(
    (ws: WorkspaceDTO) => {
      setWorkspaces((prev) => [...prev, ws]);
      setWorkspace(ws.id);
    },
    [setWorkspace],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setUser(null);
    setWorkspaces([]);
    router.replace('/login');
  }, [router]);

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === currentId) ?? null,
    [workspaces, currentId],
  );

  const value = useMemo<SessionState>(
    () => ({
      user,
      workspaces,
      workspace,
      loading,
      error,
      setWorkspace,
      refresh: load,
      addWorkspace,
      logout,
    }),
    [user, workspaces, workspace, loading, error, setWorkspace, load, addWorkspace, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}

/** Convenience: current workspace id, throwing a friendly hint if unset. */
export function useWorkspaceId(): string | null {
  return useSession().workspace?.id ?? null;
}
