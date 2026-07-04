import { pino } from 'pino';
import { loadConfig } from '@yourstack/config';

const config = loadConfig();

export const logger = pino({
  name: 'worker',
  level: config.LOG_LEVEL,
  transport: config.isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
