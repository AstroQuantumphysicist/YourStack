'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { OrganizationDTO } from '@yourstack/shared';
import { api, ApiError } from './api';
import { useSession } from './session';

const ORG_STORAGE_KEY = 'yourstack-organization';

interface OrgState {
  organizations: OrganizationDTO[];
  organization: OrganizationDTO | null;
  loading: boolean;
  error: string | null;
  /** True once the initial load has completed (so onboarding can be shown). */
  loaded: boolean;
  setOrganization: (id: string) => void;
  addOrganization: (org: OrganizationDTO) => void;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgState | null>(null);

/**
 * Loads the organizations the signed-in user belongs to and tracks the
 * currently-selected one. Sits alongside the workspace-scoped session context;
 * an org groups workspaces + teams for larger tenants.
 */
export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const [organizations, setOrganizations] = useState<OrganizationDTO[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { organizations: orgs } = await api.organizations();
      setOrganizations(orgs);
      setError(null);
      setCurrentId((prev) => {
        const stored =
          typeof window !== 'undefined' ? localStorage.getItem(ORG_STORAGE_KEY) : null;
        const preferred = prev ?? stored;
        if (preferred && orgs.some((o) => o.id === preferred)) return preferred;
        return orgs[0]?.id ?? null;
      });
    } catch (err) {
      if (!(err instanceof ApiError && err.isAuth)) {
        setError(err instanceof Error ? err.message : 'Failed to load organizations');
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const setOrganization = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(ORG_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const addOrganization = useCallback(
    (org: OrganizationDTO) => {
      setOrganizations((prev) => [...prev, org]);
      setOrganization(org.id);
    },
    [setOrganization],
  );

  const organization = useMemo(
    () => organizations.find((o) => o.id === currentId) ?? null,
    [organizations, currentId],
  );

  const value = useMemo<OrgState>(
    () => ({
      organizations,
      organization,
      loading,
      loaded,
      error,
      setOrganization,
      addOrganization,
      refresh: load,
    }),
    [organizations, organization, loading, loaded, error, setOrganization, addOrganization, load],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgState {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within <OrgProvider>');
  return ctx;
}
