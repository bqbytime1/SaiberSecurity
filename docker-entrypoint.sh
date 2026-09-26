#!/bin/sh
# Bring the database schema up to date before serving, then hand off to the server.
#
# `migrate deploy` only applies migrations that already exist; it never generates or
# resets anything, which is what you want on a production boot.
set -e

echo "[entrypoint] applying database migrations"
npx prisma migrate deploy

# Seed only when explicitly asked AND the database has no users yet, so a restart
# can never wipe real accounts.
if [ "${SEED_ON_FIRST_BOOT}" = "true" ]; then
  USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);return p.\$disconnect()}).catch(()=>{console.log(-1)})" 2>/dev/null || echo -1)
  if [ "$USERS" = "0" ]; then
    echo "[entrypoint] empty database, seeding demo dataset"
    npx prisma db seed
  else
    echo "[entrypoint] database already has $USERS user(s), skipping seed"
  fi
fi

echo "[entrypoint] starting server"
exec "$@"
