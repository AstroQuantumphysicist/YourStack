import { basename } from 'node:path';
import { access } from 'node:fs/promises';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ProjectDTO, WorkspaceDTO } from '@noderail/shared';
import { requireClient, type GlobalFlags } from '../lib/context.js';
import { CliError } from '../lib/errors.js';
import { info, success } from '../lib/output.js';
import { buildNoderailConfig, saveProjectLink, writeNoderailYaml } from '../lib/project.js';

function ensure<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new CliError('Cancelled.', 130);
  return value as T;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Link the current directory to a NodeRail project and scaffold noderail.yml')
    .option('--name <name>', 'App/config name (defaults to the directory name)')
    .action(async (opts: { name?: string }, cmd: Command) => {
      const flags = cmd.optsWithGlobals() as GlobalFlags;
      const { client } = await requireClient(flags);

      p.intro(pc.bgCyan(pc.black(' noderail init ')));

      // --- Workspace ---
      const me = await client.me();
      if (me.workspaces.length === 0) {
        throw new CliError('You have no workspaces. Create one in the web dashboard first.');
      }
      const workspace = await pickWorkspace(me.workspaces);

      // --- Project (pick or create) ---
      const { projects } = await client.listProjects(workspace.id);
      const project = await pickOrCreateProject(client, workspace.id, projects);

      // --- App details ---
      const dirName = basename(process.cwd());
      const defaultName = opts.name ?? dirName;
      const appName = ensure(
        await p.text({
          message: 'App name',
          initialValue: defaultName,
          validate: (v) => (v.trim().length >= 2 ? undefined : 'At least 2 characters.'),
        }),
      ).trim();

      const branch = ensure(
        await p.text({ message: 'Deploy branch', initialValue: 'main' }),
      ).trim();

      const portStr = ensure(
        await p.text({
          message: 'Port your app listens on',
          initialValue: '3000',
          validate: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'Must be a number.'),
        }),
      ).trim();
      const port = Number(portStr);

      const repoUrl = ensure(
        await p.text({
          message: 'Git repository URL (optional)',
          placeholder: 'https://github.com/you/repo.git',
        }),
      ).trim();

      const installCommand = ensure(
        await p.text({ message: 'Install command (optional)', placeholder: 'pnpm install' }),
      ).trim();
      const buildCommand = ensure(
        await p.text({ message: 'Build command (optional)', placeholder: 'pnpm build' }),
      ).trim();
      const startCommand = ensure(
        await p.text({ message: 'Start command (optional)', placeholder: 'pnpm start' }),
      ).trim();

      // --- Create the app on the server ---
      const createApp = ensure(
        await p.confirm({ message: `Create app "${appName}" in ${project.name} now?`, initialValue: true }),
      );

      let appId: string | undefined;
      if (createApp) {
        const spinner = p.spinner();
        spinner.start('Creating app');
        try {
          const { app } = await client.createApp(project.id, {
            name: appName,
            branch: branch || 'main',
            port,
            repoUrl: repoUrl || undefined,
            installCommand: installCommand || undefined,
            buildCommand: buildCommand || undefined,
            startCommand: startCommand || undefined,
          });
          appId = app.id;
          spinner.stop(`Created app ${pc.bold(app.name)} (${pc.dim(app.id)})`);
        } catch (err) {
          spinner.stop('App creation failed');
          throw err;
        }
      }

      // --- Scaffold noderail.yml ---
      const config = buildNoderailConfig({
        name: appName,
        branch: branch || 'main',
        install: installCommand || undefined,
        build: buildCommand || undefined,
        start: startCommand || undefined,
        port,
      });

      let wroteYaml = true;
      try {
        await access('noderail.yml');
        const overwrite = ensure(
          await p.confirm({ message: 'noderail.yml already exists. Overwrite?', initialValue: false }),
        );
        wroteYaml = overwrite;
      } catch {
        // File does not exist — safe to write.
      }
      if (wroteYaml) await writeNoderailYaml(config);

      // --- Write the local link ---
      const linkPath = await saveProjectLink({
        workspaceId: workspace.id,
        projectId: project.id,
        appId,
        workspaceSlug: workspace.slug,
        projectName: project.name,
        appName,
      });

      p.outro(pc.green('Project linked.'));
      if (wroteYaml) success(`Wrote ${pc.cyan('noderail.yml')}`);
      success(`Wrote ${pc.cyan('.noderail/project.json')} ${pc.dim(`(${linkPath})`)}`);
      info('');
      info(`Next: ${pc.cyan('noderail deploy')} to ship it.`);
    });
}

async function pickWorkspace(workspaces: WorkspaceDTO[]): Promise<WorkspaceDTO> {
  if (workspaces.length === 1) {
    info(`Workspace: ${pc.cyan(workspaces[0]!.slug)}`);
    return workspaces[0]!;
  }
  const selection = await p.select({
    message: 'Select a workspace',
    options: workspaces.map((w) => ({ value: w.id, label: w.slug, hint: w.role })),
  });
  const id = ensure(selection);
  return workspaces.find((w) => w.id === id)!;
}

async function pickOrCreateProject(
  client: Awaited<ReturnType<typeof requireClient>>['client'],
  workspaceId: string,
  projects: ProjectDTO[],
): Promise<ProjectDTO> {
  const CREATE = '__create__';
  const selection = await p.select({
    message: 'Select a project',
    options: [
      ...projects.map((pr) => ({ value: pr.id, label: pr.name, hint: `${pr.appCount} apps` })),
      { value: CREATE, label: pc.green('+ Create a new project') },
    ],
  });
  const choice = ensure(selection);
  if (choice !== CREATE) return projects.find((pr) => pr.id === choice)!;

  const name = ensure(
    await p.text({
      message: 'New project name',
      validate: (v) => (v.trim().length >= 2 ? undefined : 'At least 2 characters.'),
    }),
  ).trim();
  const { project } = await client.createProject(workspaceId, name);
  success(`Created project ${pc.bold(project.name)}`);
  return project;
}
