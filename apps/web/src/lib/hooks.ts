'use client';

import useSWR from 'swr';
import type { AppDTO, ProjectDTO } from '@yourstack/shared';
import { api } from './api';

export interface AppWithProject extends AppDTO {
  projectName: string;
  projectSlug: string;
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
