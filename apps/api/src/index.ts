import { loadConfig } from '@noderail/config';
import { buildServer } from './server.js';
import { disposeContext } from './context.js';
import { logger } from './logger.js';

async function main() {
  const config = loadConfig();
  const { app, ctx } = await buildServer();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down api');
    try {
      await app.close();
      await disposeContext(ctx);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info(`NodeRail API listening on :${config.PORT} (${config.NODE_ENV})`);
}

main().catch((err) => {
  logger.error({ err }, 'failed to start api');
  process.exit(1);
});
