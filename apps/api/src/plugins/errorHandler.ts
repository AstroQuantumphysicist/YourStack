import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/** Maps AppError, ZodError, and unknown errors to a consistent JSON envelope. */
export default fp(async function errorHandlerPlugin(app) {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;

    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details, requestId },
      });
      return;
    }

    if (err instanceof ZodError) {
      reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId,
        },
      });
      return;
    }

    // Fastify built-in validation / rate-limit errors carry statusCode.
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 429) {
      reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many requests', requestId },
      });
      return;
    }
    if (statusCode >= 400 && statusCode < 500) {
      reply.status(statusCode).send({
        error: { code: 'bad_request', message: (err as Error).message, requestId },
      });
      return;
    }

    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error', requestId },
    });
  });
});
