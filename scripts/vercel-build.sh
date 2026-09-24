#!/bin/sh
# Vercel build: apply database migrations for production deployments only, then build.
# Preview deployments (other branches) never migrate, so unmerged schema changes can't
# reach the production database.
set -e
if [ "$VERCEL_ENV" = "production" ]; then
  echo "Production build: applying database migrations"
  npx prisma migrate deploy
else
  echo "Skipping migrations (VERCEL_ENV=${VERCEL_ENV:-local})"
fi
npx next build
