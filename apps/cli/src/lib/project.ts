import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stringify as yamlStringify } from 'yaml';
import type { NoderailConfig } from '@noderail/shared';

/**
 * The local link file written by `noderail init`, associating the current
 * directory with a workspace / project / app on the server.
 */
export interface ProjectLink {
  workspaceId: string;
  projectId: string;
  appId?: string;
  /** Human-readable names, cached for nicer CLI output. */
  workspaceSlug?: string;
  projectName?: string;
  appName?: string;
}

const LINK_DIR = '.noderail';
const LINK_FILE = 'project.json';

function linkPath(cwd: string): string {
  return join(cwd, LINK_DIR, LINK_FILE);
}

/** Read the `.noderail/project.json` link for a directory, if present. */
export async function loadProjectLink(cwd = process.cwd()): Promise<ProjectLink | null> {
  try {
    const raw = await readFile(linkPath(cwd), 'utf8');
    return JSON.parse(raw) as ProjectLink;
  } catch {
    return null;
  }
}

/** Write the `.noderail/project.json` link for a directory. */
export async function saveProjectLink(link: ProjectLink, cwd = process.cwd()): Promise<string> {
  const dir = join(cwd, LINK_DIR);
  await mkdir(dir, { recursive: true });
  const path = linkPath(cwd);
  await writeFile(path, JSON.stringify(link, null, 2) + '\n');
  return path;
}

/**
 * Build a `noderail.yml` document that satisfies `noderailConfigSchema`. Only
 * the fields the user chose are emitted; the rest fall back to schema defaults
 * at parse time.
 */
export function buildNoderailConfig(input: {
  name: string;
  branch?: string;
  install?: string;
  build?: string;
  start?: string;
  port: number;
  healthcheckPath?: string;
}): NoderailConfig {
  const config: NoderailConfig = {
    name: input.name,
    on: {
      push: { branches: [input.branch ?? 'main'] },
      pull_request: false,
    },
    build: {
      ...(input.install ? { install: input.install } : {}),
      ...(input.build ? { command: input.build } : {}),
    },
    deploy: {
      ...(input.start ? { start: input.start } : {}),
      port: input.port,
      resources: {},
      ...(input.healthcheckPath ? { healthcheck: { path: input.healthcheckPath } } : {}),
    },
  };
  return config;
}

/** Serialize a config to YAML with a short explanatory header. */
export function renderNoderailYaml(config: NoderailConfig): string {
  const header =
    '# noderail.yml — NodeRail pipeline configuration.\n' +
    '# Committed to your repo; read by the build worker on each deploy.\n' +
    '# Docs: https://noderail.dev/docs/config\n\n';
  return header + yamlStringify(config);
}

/** Write `noderail.yml` into a directory. Returns the absolute path. */
export async function writeNoderailYaml(config: NoderailConfig, cwd = process.cwd()): Promise<string> {
  const path = join(cwd, 'noderail.yml');
  await writeFile(path, renderNoderailYaml(config));
  return path;
}
