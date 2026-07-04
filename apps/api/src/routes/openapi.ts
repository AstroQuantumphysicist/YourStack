import fp from 'fastify-plugin';
import { API_VERSION } from '@noderail/shared';

interface RouteInfo {
  method: string;
  url: string;
}

/**
 * Lightweight OpenAPI surface. We collect the real route table via the `onRoute`
 * hook so the spec is always in sync with what's actually mounted, then serve it
 * at /openapi.json with a Swagger UI page at /docs.
 */
export default fp(async function openapiPlugin(app) {
  const routes: RouteInfo[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routes.push({ method, url: route.url });
    }
  });

  app.get('/openapi.json', async () => {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of routes) {
      const tag = r.url.split('/').filter(Boolean)[1] ?? 'root';
      const path = r.url.replace(/:(\w+)/g, '{$1}');
      paths[path] = paths[path] ?? {};
      paths[path][r.method.toLowerCase()] = {
        tags: [tag],
        summary: `${r.method} ${r.url}`,
        responses: { '200': { description: 'Success' }, '4XX': { description: 'Client error' } },
      };
    }
    return {
      openapi: '3.1.0',
      info: {
        title: 'NodeRail API',
        version: '0.1.0',
        description: 'Control-plane API for the NodeRail BYOC platform.',
      },
      servers: [{ url: `/${API_VERSION}` }],
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: 'nr_session' },
          bearerToken: { type: 'http', scheme: 'bearer', description: 'Personal API token (nr_...)' },
        },
      },
      paths,
    };
  });

  app.get('/docs', async (_req, reply) => {
    reply.type('text/html').send(SWAGGER_HTML);
  });
});

const SWAGGER_HTML = `<!doctype html>
<html>
  <head>
    <title>NodeRail API Docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger' });
      };
    </script>
  </body>
</html>`;
