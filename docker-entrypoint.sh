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
  fail "DATABASE_URL is not set. The image defaults it to file:/data/saiber.db, so an
       empty value means the host is overriding it with a blank one. Set it in your
       host's environment, or remove the empty override."
fi

case "${DATABASE_URL}" in
  file:*)
    DB_PATH=$(printf '%s' "${DATABASE_URL}" | sed 's|^file:||')
    case "${DB_PATH}" in
      /*) DB_DIR=$(dirname "${DB_PATH}") ;;
      *)  DB_DIR="/app/prisma" ;;
    esac
    mkdir -p "${DB_DIR}" 2>/dev/null || true
    if ! touch "${DB_DIR}/.write-test" 2>/dev/null; then
      fail "Cannot write to ${DB_DIR}, where the SQLite database lives.
       This container runs as the non-root user 'node'. A disk mounted there by the
       host is usually owned by root, which makes it read-only to this process.
       Either set the mount's owner to uid 1000, or point DATABASE_URL at a
       PostgreSQL server instead (see DEPLOYMENT.md)."
    fi
    rm -f "${DB_DIR}/.write-test"
    echo "[entrypoint] database directory ${DB_DIR} is writable"
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
    npx prisma db seed
  else
    echo "[entrypoint] database already has $USERS user(s), skipping seed"
  fi
fi

echo "[entrypoint] starting server on port ${PORT:-3000}"
exec "$@"
