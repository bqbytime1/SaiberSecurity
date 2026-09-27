#!/bin/sh
# Bring the database schema up to date before serving, then hand off to the server.
#
# `migrate deploy` only applies migrations that already exist; it never generates or
# resets anything, which is what you want on a production boot.
set -e

fail() {
  echo ""
  echo "[entrypoint] ERROR: $1"
  echo ""
  exit 1
}

# ── Preflight ───────────────────────────────────────────────────────────────
# Each of these would otherwise surface far from its cause: an unset DATABASE_URL
# as a Prisma schema-validation error, a read-only mount as a failed migration, and
# a missing SESSION_SECRET only when someone first tries to sign in.

if [ -z "${DATABASE_URL}" ]; then
  fail "DATABASE_URL is not set. It must point at a PostgreSQL server, for example
         postgresql://user:password@host:5432/saiber
       On Render, create a PostgreSQL instance and use its Internal Database URL."
fi

case "${DATABASE_URL}" in
  postgres://*|postgresql://*)
    echo "[entrypoint] using PostgreSQL"
    ;;
  file:*)
    fail "DATABASE_URL points at a SQLite file, which this app no longer uses.
       A container's filesystem is rebuilt on every deploy, and on hosts that sleep
       when idle it is rebuilt on every wake, so a file there loses every account and
       session each time. Point DATABASE_URL at a PostgreSQL server instead."
    ;;
  *)
    fail "DATABASE_URL is not a PostgreSQL connection string. It should begin with
       postgresql:// — see DEPLOYMENT.md."
    ;;
esac

if [ -z "${SESSION_SECRET}" ] || [ ${#SESSION_SECRET} -lt 32 ]; then
  fail "SESSION_SECRET must be set and at least 32 characters. Without it the app
       starts but every sign-in fails. Generate one with:
         node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
fi

# ── Schema ──────────────────────────────────────────────────────────────────
echo "[entrypoint] applying database migrations"
npx prisma migrate deploy

# Seed only when explicitly asked AND the database has no users yet, so a restart
# can never wipe real accounts.
if [ "${SEED_ON_FIRST_BOOT}" = "true" ]; then
  USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);return p.\$disconnect()}).catch(()=>{console.log(-1)})" 2>/dev/null || echo -1)
  if [ "$USERS" = "0" ]; then
    echo "[entrypoint] empty database, seeding demo dataset"
    # The built-in account's password is published in the repository, so a container
    # only creates it when given a password of its own. Otherwise the security data
    # is seeded and the operator signs up for their own account.
    if [ -z "${DEMO_USER_PASSWORD}" ]; then
      echo "[entrypoint] no DEMO_USER_PASSWORD set; seeding data only, sign up at /signup"
      export SEED_DEMO_USER=false
    fi
    npx prisma db seed
  else
    echo "[entrypoint] database already has $USERS user(s), skipping seed"
  fi
fi

echo "[entrypoint] starting server on port ${PORT:-3000}"
exec "$@"
