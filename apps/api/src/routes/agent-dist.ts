import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Public agent distribution endpoints (unversioned, no auth):
 *   GET /agent/install.sh      — the Linux/macOS installer script
 *   GET /agent/install.ps1     — the Windows installer script
 *   GET /agent/download/:os/:arch — the prebuilt agent binary for a platform
 *
 * The install scripts live in the image at SCRIPTS_DIR and the binaries are
 * baked in at DIST_DIR by the API Dockerfile's agent build stage. This lets the
 * `curl -fsSL <api>/agent/install.sh | sh` one-liner work fully self-hosted on
 * the control plane with no external download host.
 */
const DIST_DIR = process.env.YOURSTACK_AGENT_DIST_DIR ?? '/app/agent-dist';
const SCRIPTS_DIR = process.env.YOURSTACK_AGENT_SCRIPTS_DIR ?? '/app/apps/agent/scripts';

/** Map a requested os/arch to the baked-in binary filename, or null if none. */
function binaryFile(os: string, arch: string): string | null {
  const a = arch === 'amd64' ? 'x86_64' : arch;
  if (os === 'linux' && a === 'x86_64') return 'yourstack-agent-linux-x86_64';
  return null;
}

export default async function agentDistRoutes(app: FastifyInstance) {
  const serveScript = async (
    reply: import('fastify').FastifyReply,
    file: string,
    contentType: string,
  ) => {
    try {
      const body = await readFile(join(SCRIPTS_DIR, file), 'utf8');
      return reply.type(contentType).send(body);
    } catch {
      return reply.code(404).type('text/plain').send(`installer ${file} not available on this deployment\n`);
    }
  };

  app.get('/agent/install.sh', (_req, reply) =>
    serveScript(reply, 'install.sh', 'text/x-shellscript; charset=utf-8'),
  );
  app.get('/agent/install.ps1', (_req, reply) =>
    serveScript(reply, 'install.ps1', 'text/plain; charset=utf-8'),
  );

  app.get('/agent/download/:os/:arch', async (req, reply) => {
    const { os, arch } = req.params as { os: string; arch: string };
    const name = binaryFile(os.toLowerCase(), arch.toLowerCase());
    if (!name) {
      return reply
        .code(404)
        .type('text/plain')
        .send(
          `no prebuilt agent binary for ${os}/${arch} on this deployment. ` +
            `Set YOURSTACK_BINARY_URL to a binary you host, or build from apps/agent.\n`,
        );
    }
    const path = join(DIST_DIR, name);
    let size = 0;
    try {
      size = (await stat(path)).size;
    } catch {
      return reply
        .code(404)
        .type('text/plain')
        .send(`agent binary ${name} is not bundled in this deployment\n`);
    }
    reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(size))
      .header('content-disposition', `attachment; filename="yourstack-agent"`);
    return reply.send(createReadStream(path));
  });
}
