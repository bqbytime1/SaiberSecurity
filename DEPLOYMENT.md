# Deploying SaiberSecurity to saibersecurity.com

This describes a complete, self-contained deployment on a single Linux server: the app in one container, [Caddy](https://caddyserver.com) in another terminating TLS with a certificate it obtains automatically from Let's Encrypt, and the SQLite database on a Docker volume that survives redeploys.

Everything referenced here ships with the repository: [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml), [`Caddyfile`](Caddyfile), [`docker-entrypoint.sh`](docker-entrypoint.sh) and [`.env.production.example`](.env.production.example).

> **Before you start.** As of the last check, `saibersecurity.com` was already registered, resolving to `185.53.179.128` on the `dyna-ns.net` nameservers, and answering `410 Gone` over HTTP with no HTTPS at all. That is a parking placeholder, not a live site. Confirm the domain is actually yours and that you can edit its DNS before going further. If it is not yours, every step below still works against any domain you do control; substitute it consistently.

---

## Contents

- [What you need](#what-you-need)
- [1. Point DNS at your server](#1-point-dns-at-your-server)
- [2. Put the code on the server](#2-put-the-code-on-the-server)
- [3. Configure the environment](#3-configure-the-environment)
- [4. Start it](#4-start-it)
- [5. Register OAuth redirect URIs](#5-register-oauth-redirect-uris)
- [6. Verify](#6-verify)
- [Operating it](#operating-it)
- [Using PostgreSQL instead of SQLite](#using-postgresql-instead-of-sqlite)
- [Deploying to Vercel instead](#deploying-to-vercel-instead)
- [Hardening checklist](#hardening-checklist)

---

## What you need

| | |
| --- | --- |
| A server | Any Linux host with a public IPv4 address. 1 vCPU and 1 GB RAM is enough; 2 GB makes the build comfortable. |
| Software on it | Docker Engine with the Compose plugin. Nothing else. |
| Open ports | 80 and 443 inbound. Port 80 must stay open permanently, not just once, because it is used for certificate renewal. |
| Control of the domain | Ability to create A records for `saibersecurity.com`. |

Ports 80 and 443 are the only things that should be exposed. The app container has no published port and is reachable only through Caddy.

---

## 1. Point DNS at your server

Create two A records at whoever runs DNS for the domain. If the nameservers are still `ns1.dyna-ns.net` / `ns2.dyna-ns.net` from a parking service, move them to your own DNS provider first, or the records below will not be authoritative.

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | your server's public IPv4 | 300 |
| A | `www` | your server's public IPv4 | 300 |

Delete any existing A, AAAA or CNAME records for `@` and `www` that point at the parking address, or they will conflict.

Wait for propagation before starting the stack. Caddy will ask Let's Encrypt for a certificate immediately, and a failed attempt is rate limited.

```bash
dig +short saibersecurity.com
dig +short www.saibersecurity.com
```

Both must print your server's IP. A short TTL of 300 keeps a mistake cheap to correct.

---

## 2. Put the code on the server

Copy the project across, excluding `node_modules`, `.next`, the local `.env` and the development database. From your machine:

```bash
rsync -av --exclude node_modules --exclude .next --exclude .env --exclude 'prisma/*.db' \
  ./ user@your-server:/opt/saibersecurity/
```

Or unzip `SaiberSecurity.zip` there, which already excludes all of those.

---

## 3. Configure the environment

```bash
cd /opt/saibersecurity
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`. Two values must be set before the first start:

```bash
# A fresh secret. Do not reuse the development one. Changing it later signs everyone out.
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- `SESSION_SECRET` — paste the value from that command.
- `APP_URL` — `https://saibersecurity.com`, with no trailing slash. Every OAuth callback URL is built from this, so a mismatch here is the most common cause of a failed provider sign-in.

Leave `SEED_ON_FIRST_BOOT="true"` if you want the demo dataset. It runs only when the database contains no users, so a restart can never overwrite real accounts. Set it to `false` once you have your own.

Also edit the email address at the top of [`Caddyfile`](Caddyfile) so certificate-expiry notices reach a real inbox.

---

## 4. Start it

```bash
docker compose --env-file .env.production up -d --build
docker compose logs -f
```

The first build takes a few minutes. In the logs you should see the entrypoint apply migrations, optionally seed, then the server report it is ready, and Caddy obtain a certificate.

**These container files have not been run in this environment**, because Docker is not installed on the machine where the project was built. They are written conservatively for that reason. Watch the first `docker compose up` rather than running it detached and assuming success.

---

## 5. Register OAuth redirect URIs

Each provider you enable needs this exact callback URL registered, and the matching pair of variables set in `.env.production`:

| Provider | Redirect URI to register | Where |
| --- | --- | --- |
| Google | `https://saibersecurity.com/api/auth/oauth/google/callback` | <https://console.cloud.google.com/apis/credentials> |
| Microsoft | `https://saibersecurity.com/api/auth/oauth/microsoft/callback` | <https://entra.microsoft.com> → App registrations |
| GitHub | `https://saibersecurity.com/api/auth/oauth/github/callback` | <https://github.com/settings/developers> |

If you also want `www` to work for sign-in, either register the `www` URL as a second redirect URI with each provider, or, more simply, redirect `www` to the apex in the `Caddyfile` so only one origin ever serves the app.

Restart after changing provider variables: `docker compose --env-file .env.production up -d`.

Phone sign-up needs the three `TWILIO_*` values in production. Without them the phone endpoints return 503 rather than falling back to revealing a code, which is deliberate.

---

## 6. Verify

```bash
curl -sI https://saibersecurity.com/login | head -n 1        # expect 200
curl -sI http://saibersecurity.com | grep -i location        # expect a redirect to https
curl -s https://saibersecurity.com/api/metrics | head -c 80  # expect 401, not data
```

Then in a browser:

1. `https://saibersecurity.com/login` loads over a valid certificate with no warning.
2. Creating an account at `/signup` works and lands on the dashboard.
3. Signing out and back in works.
4. Each enabled provider button completes a full round trip.
5. The session cookie shows `Secure`, `HttpOnly` and `SameSite=Lax` in developer tools.

---

## Operating it

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f app` |
| Restart | `docker compose --env-file .env.production restart app` |
| Deploy an update | `git pull && docker compose --env-file .env.production up -d --build` |
| Apply new migrations | Automatic on every container start. |
| Shell in the container | `docker compose exec app sh` |
| Back up the database | `docker compose exec app sh -c 'sqlite3 /data/saiber.db ".backup /data/backup.db"'` then copy it off the volume |

Back up `/data` on a schedule. It holds the only copy of your accounts, events and incidents.

`npm run db:reset` destroys all data and must never be run against this deployment.

---

## Using PostgreSQL instead of SQLite

SQLite on a mounted volume is a sound choice for a single server, and it is what the compose file uses. Move to PostgreSQL when you want more than one app container, or managed backups and failover.

Prisma requires the provider to be a literal in the schema, so it cannot be switched by an environment variable:

1. In [`prisma/schema.prisma`](prisma/schema.prisma), change `provider = "sqlite"` to `provider = "postgresql"`.
2. Delete `prisma/migrations/` and regenerate it against a Postgres database: `npx prisma migrate dev --name init`. The existing migrations contain SQLite-specific SQL and will not apply.
3. Set `DATABASE_URL` to your connection string and drop the volume from `docker-compose.yml`.

No application code changes, because every query goes through Prisma. Doing this after go-live means migrating your data across, so decide before you have real accounts.

---

## Deploying to Vercel instead

Vercel works, with one hard constraint: **its filesystem is ephemeral, so SQLite cannot be used.** Follow the PostgreSQL section first, with a managed database such as Vercel Postgres, Neon or Supabase.

Then set the environment variables from `.env.production.example` in the project settings, add `saibersecurity.com` as a custom domain, and point DNS at the records Vercel provides instead of at your own server. `next build` needs `prisma generate` to have run, which the existing `build` script already does. Nothing else in the project assumes a long-lived server, so it deploys as is.

---

## Hardening checklist

Before putting the URL in front of anyone:

- [ ] `SESSION_SECRET` is new, random, and not shared with development.
- [ ] `SEED_ON_FIRST_BOOT` is `false` once real accounts exist.
- [ ] The seeded `demo@saibersecurity.com` account is deleted, or its password changed. Its credentials are public knowledge, since they are in this repository. The sign-in page no longer prints them in production, but the account still works until you remove it.
- [ ] **Sign-up is open to anyone who can reach the URL, and every account gets full analyst access.** There is no invite, approval step, domain allow-list or role system. Put the site behind an allow-list, or add one, before exposing it publicly.
- [ ] A firewall permits only 80, 443 and your SSH port.
- [ ] `/data` is backed up somewhere off the server.
- [ ] Automatic security updates are enabled on the host.

The rate limiter is in-memory and per container, so running more than one app container weakens it. Move it to a shared store before scaling out.
