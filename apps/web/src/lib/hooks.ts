'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type {
  AppDTO,
  BucketDTO,
  CronJobDTO,
  DatabaseDTO,
  FunctionDTO,
  LoadBalancerDTO,
  ProjectDTO,
} from '@yourstack/shared';
import { api } from './api';

export interface AppWithProject extends AppDTO {
  projectName: string;
  projectSlug: string;
}

export type WithProject<T> = T & { projectName: string; projectSlug: string };

/**
 * Managed resources (databases/buckets/functions) live under projects. This
 * composes projects + their resources into a single flat list for the
 * workspace-level index pages, mirroring `useWorkspaceApps`.
 */
function makeResourceHook<T>(
  keyPrefix: string,
  fetchForProject: (pid: string) => Promise<T[]>,
) {
  return (wid: string | null | undefined) =>
    useSWR(
      wid ? [keyPrefix, wid] : null,
      async (): Promise<{ items: WithProject<T>[]; projects: ProjectDTO[] }> => {
        const { projects } = await api.projects(wid!);
        const lists = await Promise.all(
          projects.map(async (p) => {
            const items = await fetchForProject(p.id);
            return items.map((item) => ({
              ...item,
              projectName: p.name,
              projectSlug: p.slug,
            }));
          }),
        );
        return { items: lists.flat(), projects };
      },
    );
}

export const useWorkspaceDatabases = makeResourceHook<DatabaseDTO>(
  'ws-databases',
  async (pid) => (await api.databases(pid)).databases,
);

export const useWorkspaceBuckets = makeResourceHook<BucketDTO>(
  'ws-buckets',
  async (pid) => (await api.buckets(pid)).buckets,
);

export const useWorkspaceFunctions = makeResourceHook<FunctionDTO>(
  'ws-functions',
  async (pid) => (await api.functions(pid)).functions,
);

export const useWorkspaceCron = makeResourceHook<CronJobDTO>(
  'ws-cron',
  async (pid) => (await api.projectCron(pid)).cronJobs,
);

export const useWorkspaceLoadBalancers = makeResourceHook<LoadBalancerDTO>(
  'ws-load-balancers',
  async (pid) => (await api.loadBalancers(pid)).loadBalancers,
);

/**
 * When a page is opened via the command palette with `?new=1`, auto-open its
 * create dialog and strip the query param. Avoids `useSearchParams` (which
 * would force a Suspense boundary at build time).
 */
export function useAutoCreate(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') {
      setOpen(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  return [open, setOpen];
}

/**
 * Workspace apps live under projects. This composes projects + their apps into
 * a single flat list so the Apps page can render one table.
 */
export function useWorkspaceApps(wid: string | null | undefined) {
  return useSWR(
    wid ? ['ws-apps', wid] : null,
    async (): Promise<{ apps: AppWithProject[]; projects: ProjectDTO[] }> => {
      const { projects } = await api.projects(wid!);
      const lists = await Promise.all(
        projects.map(async (p) => {
          const { apps } = await api.projectApps(p.id);
          return apps.map<AppWithProject>((a) => ({
            ...a,
            projectName: p.name,
            projectSlug: p.slug,
          }));
        }),
      );
      return { apps: lists.flat(), projects };
    },
  );
}

/** Deployments across the whole workspace (flattened from every app). */
export function useWorkspaceDeployments(wid: string | null | undefined) {
  return useSWR(
    wid ? ['ws-deployments', wid] : null,
    async () => {
      const { projects } = await api.projects(wid!);
      const appLists = await Promise.all(projects.map((p) => api.projectApps(p.id)));
      const apps = appLists.flatMap((l) => l.apps);
      const deployLists = await Promise.all(
        apps.map(async (a) => {
          const { deployments } = await api.appDeployments(a.id);
          return deployments.map((d) => ({ ...d, appName: a.name, appSlug: a.slug }));
        }),
      );
      const deployments = deployLists
        .flat()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { deployments, apps };
    },
  );
}
