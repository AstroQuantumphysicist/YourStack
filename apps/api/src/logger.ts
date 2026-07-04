import { pino } from 'pino';
import { loadConfig } from '@yourstack/config';

const config = loadConfig();

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'agentToken',
      '*.ciphertext',
    ],
    censor: '***',
  },
});
