/**
 * YourStack marketplace catalog — one-click deploy of popular self-hostable
 * software onto your own nodes. Each entry declares the container image, exposed
 * port, default env, and user-facing variables. `kind` drives which resource is
 * created (app/service, database, function, or a multi-service stack).
 */
export interface TemplateVariable {
  key: string;
  label: string;
  default?: string;
  required?: boolean;
  secret?: boolean;
  generate?: 'password' | 'token';
}
export interface TemplateSpec {
  port?: number;
  env?: Record<string, string>;
  variables?: TemplateVariable[];
  volumes?: string[];
  cpu?: number;
  memoryMb?: number;
  /** For stack templates: additional services. */
  services?: Array<{ name: string; image: string; port?: number; env?: Record<string, string> }>;
}
export interface TemplateSeed {
  slug: string;
  name: string;
  category: string;
  kind: 'app' | 'database' | 'function' | 'stack';
  description: string;
  icon: string;
  image: string | null;
  tags: string[];
  popularity: number;
  spec: TemplateSpec;
}

const pw = (key: string, label: string): TemplateVariable => ({
  key,
  label,
  secret: true,
  generate: 'password',
});

export const TEMPLATE_CATALOG: TemplateSeed[] = [
  // ---- Databases & caches ----
  { slug: 'postgres', name: 'PostgreSQL', category: 'database', kind: 'database', icon: '🐘', image: 'postgres:16', tags: ['sql', 'relational'], popularity: 100, description: 'The world’s most advanced open-source relational database.', spec: { port: 5432 } },
  { slug: 'mysql', name: 'MySQL', category: 'database', kind: 'database', icon: '🐬', image: 'mysql:8', tags: ['sql'], popularity: 88, description: 'Popular open-source relational database.', spec: { port: 3306 } },
  { slug: 'redis', name: 'Redis', category: 'cache', kind: 'database', icon: '⚡', image: 'redis:7', tags: ['cache', 'kv'], popularity: 95, description: 'In-memory data store, cache and message broker.', spec: { port: 6379 } },
  { slug: 'mongodb', name: 'MongoDB', category: 'database', kind: 'database', icon: '🍃', image: 'mongo:7', tags: ['nosql', 'document'], popularity: 82, description: 'Document-oriented NoSQL database.', spec: { port: 27017 } },
  { slug: 'mariadb', name: 'MariaDB', category: 'database', kind: 'app', icon: '🗄️', image: 'mariadb:11', tags: ['sql'], popularity: 60, description: 'Community-developed fork of MySQL.', spec: { port: 3306, variables: [pw('MARIADB_ROOT_PASSWORD', 'Root password')], env: { MARIADB_DATABASE: 'app' }, volumes: ['/var/lib/mysql'] } },
  { slug: 'clickhouse', name: 'ClickHouse', category: 'analytics', kind: 'app', icon: '📊', image: 'clickhouse/clickhouse-server:24', tags: ['olap', 'analytics'], popularity: 66, description: 'Blazing-fast columnar OLAP database.', spec: { port: 8123, volumes: ['/var/lib/clickhouse'], memoryMb: 2048 } },
  { slug: 'timescaledb', name: 'TimescaleDB', category: 'database', kind: 'app', icon: '⏱️', image: 'timescale/timescaledb:latest-pg16', tags: ['timeseries', 'sql'], popularity: 55, description: 'PostgreSQL for time-series at scale.', spec: { port: 5432, variables: [pw('POSTGRES_PASSWORD', 'Password')], volumes: ['/var/lib/postgresql/data'] } },
  { slug: 'cockroachdb', name: 'CockroachDB', category: 'database', kind: 'app', icon: '🪳', image: 'cockroachdb/cockroach:latest', tags: ['sql', 'distributed'], popularity: 48, description: 'Distributed SQL built for global scale.', spec: { port: 26257 } },

  // ---- Search & queues ----
  { slug: 'meilisearch', name: 'Meilisearch', category: 'search', kind: 'app', icon: '🔍', image: 'getmeili/meilisearch:v1', tags: ['search'], popularity: 78, description: 'Lightning-fast, typo-tolerant search engine.', spec: { port: 7700, variables: [{ key: 'MEILI_MASTER_KEY', label: 'Master key', secret: true, generate: 'token' }], volumes: ['/meili_data'] } },
  { slug: 'typesense', name: 'Typesense', category: 'search', kind: 'app', icon: '🔎', image: 'typesense/typesense:0.25.2', tags: ['search'], popularity: 58, description: 'Open-source instant-search engine.', spec: { port: 8108, variables: [{ key: 'TYPESENSE_API_KEY', label: 'API key', secret: true, generate: 'token' }], env: { TYPESENSE_DATA_DIR: '/data' }, volumes: ['/data'] } },
  { slug: 'rabbitmq', name: 'RabbitMQ', category: 'queue', kind: 'app', icon: '🐰', image: 'rabbitmq:3-management', tags: ['queue', 'amqp'], popularity: 70, description: 'Reliable message broker with a management UI.', spec: { port: 15672, volumes: ['/var/lib/rabbitmq'] } },
  { slug: 'nats', name: 'NATS', category: 'queue', kind: 'app', icon: '📨', image: 'nats:2', tags: ['queue', 'pubsub'], popularity: 52, description: 'High-performance messaging system.', spec: { port: 8222 } },

  // ---- CMS & websites ----
  { slug: 'wordpress', name: 'WordPress', category: 'cms', kind: 'app', icon: '📝', image: 'wordpress:latest', tags: ['blog', 'cms', 'php'], popularity: 92, description: 'The world’s most popular website & blog CMS.', spec: { port: 80, env: { WORDPRESS_DB_HOST: 'db' }, volumes: ['/var/www/html'] } },
  { slug: 'ghost', name: 'Ghost', category: 'cms', kind: 'app', icon: '👻', image: 'ghost:5', tags: ['blog', 'cms'], popularity: 80, description: 'Modern publishing platform for blogs and newsletters.', spec: { port: 2368, variables: [{ key: 'url', label: 'Site URL', default: 'http://localhost:2368', required: true }], volumes: ['/var/lib/ghost/content'] } },
  { slug: 'strapi', name: 'Strapi', category: 'cms', kind: 'app', icon: '🚀', image: 'strapi/strapi:latest', tags: ['headless', 'cms', 'node'], popularity: 72, description: 'Leading open-source headless CMS.', spec: { port: 1337, volumes: ['/srv/app'] } },
  { slug: 'directus', name: 'Directus', category: 'cms', kind: 'app', icon: '🧩', image: 'directus/directus:latest', tags: ['headless', 'cms'], popularity: 62, description: 'Instant REST+GraphQL API for any SQL database.', spec: { port: 8055, variables: [{ key: 'ADMIN_EMAIL', label: 'Admin email', default: 'admin@example.com' }, pw('ADMIN_PASSWORD', 'Admin password'), { key: 'KEY', label: 'App key', secret: true, generate: 'token' }, { key: 'SECRET', label: 'App secret', secret: true, generate: 'token' }] } },

  // ---- Automation & productivity ----
  { slug: 'n8n', name: 'n8n', category: 'automation', kind: 'app', icon: '🔗', image: 'n8nio/n8n:latest', tags: ['automation', 'workflow', 'no-code'], popularity: 90, description: 'Workflow automation you self-host — 400+ integrations.', spec: { port: 5678, volumes: ['/home/node/.n8n'] } },
  { slug: 'nocodb', name: 'NocoDB', category: 'productivity', kind: 'app', icon: '🧮', image: 'nocodb/nocodb:latest', tags: ['airtable', 'no-code', 'database'], popularity: 74, description: 'Turn any database into a smart spreadsheet (Airtable alternative).', spec: { port: 8080, volumes: ['/usr/app/data'] } },
  { slug: 'appsmith', name: 'Appsmith', category: 'devtools', kind: 'app', icon: '🛠️', image: 'appsmith/appsmith-ce:latest', tags: ['internal-tools', 'low-code'], popularity: 56, description: 'Build internal tools and admin panels fast.', spec: { port: 80, volumes: ['/appsmith-stacks'], memoryMb: 2048 } },
  { slug: 'nextcloud', name: 'Nextcloud', category: 'productivity', kind: 'app', icon: '☁️', image: 'nextcloud:latest', tags: ['files', 'collaboration'], popularity: 84, description: 'Self-hosted files, calendar, and collaboration.', spec: { port: 80, volumes: ['/var/www/html'] } },
  { slug: 'gitea', name: 'Gitea', category: 'devtools', kind: 'app', icon: '🍵', image: 'gitea/gitea:1', tags: ['git', 'vcs'], popularity: 68, description: 'Lightweight self-hosted Git service.', spec: { port: 3000, volumes: ['/data'] } },
  { slug: 'vaultwarden', name: 'Vaultwarden', category: 'productivity', kind: 'app', icon: '🔐', image: 'vaultwarden/server:latest', tags: ['passwords', 'security'], popularity: 76, description: 'Bitwarden-compatible password manager server.', spec: { port: 80, volumes: ['/data'] } },

  // ---- Monitoring & analytics ----
  { slug: 'grafana', name: 'Grafana', category: 'monitoring', kind: 'app', icon: '📈', image: 'grafana/grafana:latest', tags: ['dashboards', 'observability'], popularity: 86, description: 'Beautiful dashboards for metrics and logs.', spec: { port: 3000, volumes: ['/var/lib/grafana'] } },
  { slug: 'prometheus', name: 'Prometheus', category: 'monitoring', kind: 'app', icon: '🔥', image: 'prom/prometheus:latest', tags: ['metrics', 'observability'], popularity: 79, description: 'Powerful metrics collection and alerting.', spec: { port: 9090, volumes: ['/prometheus'] } },
  { slug: 'uptime-kuma', name: 'Uptime Kuma', category: 'monitoring', kind: 'app', icon: '📟', image: 'louislam/uptime-kuma:1', tags: ['uptime', 'status'], popularity: 83, description: 'Fancy self-hosted uptime monitoring.', spec: { port: 3001, volumes: ['/app/data'] } },
  { slug: 'plausible', name: 'Plausible Analytics', category: 'analytics', kind: 'app', icon: '📉', image: 'plausible/analytics:latest', tags: ['analytics', 'privacy'], popularity: 71, description: 'Privacy-friendly, lightweight web analytics.', spec: { port: 8000 } },
  { slug: 'umami', name: 'Umami', category: 'analytics', kind: 'app', icon: '🍙', image: 'ghcr.io/umami-software/umami:postgresql-latest', tags: ['analytics', 'privacy'], popularity: 69, description: 'Simple, privacy-focused website analytics.', spec: { port: 3000, variables: [{ key: 'APP_SECRET', label: 'App secret', secret: true, generate: 'token' }] } },
  { slug: 'metabase', name: 'Metabase', category: 'analytics', kind: 'app', icon: '📊', image: 'metabase/metabase:latest', tags: ['bi', 'dashboards'], popularity: 73, description: 'Business intelligence and dashboards for everyone.', spec: { port: 3000, memoryMb: 2048 } },

  // ---- AI ----
  { slug: 'ollama', name: 'Ollama', category: 'ai', kind: 'app', icon: '🦙', image: 'ollama/ollama:latest', tags: ['llm', 'ai', 'gpu'], popularity: 89, description: 'Run open LLMs (Llama, Mistral, …) locally on your node.', spec: { port: 11434, volumes: ['/root/.ollama'], memoryMb: 8192 } },
  { slug: 'open-webui', name: 'Open WebUI', category: 'ai', kind: 'app', icon: '💬', image: 'ghcr.io/open-webui/open-webui:main', tags: ['llm', 'chat', 'ui'], popularity: 77, description: 'ChatGPT-style UI for your local LLMs.', spec: { port: 8080, volumes: ['/app/backend/data'] } },
  { slug: 'qdrant', name: 'Qdrant', category: 'ai', kind: 'app', icon: '🧠', image: 'qdrant/qdrant:latest', tags: ['vector', 'ai', 'search'], popularity: 64, description: 'High-performance vector database for AI/RAG.', spec: { port: 6333, volumes: ['/qdrant/storage'] } },

  // ---- Storage & misc ----
  { slug: 'minio', name: 'MinIO', category: 'storage', kind: 'app', icon: '🪣', image: 'minio/minio:latest', tags: ['s3', 'storage'], popularity: 81, description: 'S3-compatible high-performance object storage.', spec: { port: 9001, variables: [{ key: 'MINIO_ROOT_USER', label: 'Root user', default: 'yourstack' }, pw('MINIO_ROOT_PASSWORD', 'Root password')], volumes: ['/data'] } },
  { slug: 'static-site', name: 'Static Site (Nginx)', category: 'website', kind: 'app', icon: '🌐', image: 'nginx:alpine', tags: ['static', 'website'], popularity: 65, description: 'Serve a static website or SPA behind Nginx.', spec: { port: 80, volumes: ['/usr/share/nginx/html'] } },
  { slug: 'code-server', name: 'code-server', category: 'devtools', kind: 'app', icon: '💻', image: 'codercom/code-server:latest', tags: ['vscode', 'ide'], popularity: 67, description: 'VS Code in the browser, running on your node.', spec: { port: 8080, variables: [pw('PASSWORD', 'Access password')], volumes: ['/home/coder'] } },
];
