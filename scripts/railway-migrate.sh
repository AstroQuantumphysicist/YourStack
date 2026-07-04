#!/bin/sh
# Pre-deploy migration guard for Railway. Runs `prisma migrate deploy`, but first
# gives a clear, actionable error if DATABASE_URL is missing (instead of Prisma's
# cryptic P1012).
set -e

if [ -z "$DATABASE_URL" ]; then
  echo ""
  echo "=================================================================="
  echo " YourStack pre-deploy: DATABASE_URL is empty."
  echo ""
  echo " Add a PostgreSQL database to this Railway project:"
  echo "   New -> Database -> Add PostgreSQL   (and Add Redis)"
  echo " Then on the 'api' and 'worker' services set (use Add Reference):"
  echo "   DATABASE_URL = \${{Postgres.DATABASE_URL}}"
  echo "   REDIS_URL    = \${{Redis.REDIS_URL}}"
  echo " Then redeploy."
  echo "=================================================================="
  exit 1
fi

pnpm --filter @yourstack/db migrate:deploy

# Seed the platform catalog (plans, regions, marketplace templates). This is
# idempotent and creates NO demo/tenant data — only the catalog the product
# needs so workspace creation (which FKs to Plan) works on a fresh database.
echo "→ Seeding platform catalog…"
exec pnpm --filter @yourstack/db seed
