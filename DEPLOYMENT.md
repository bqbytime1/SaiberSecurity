# Deploying SaiberSecurity to saibersecurity.com

This describes a complete, self-contained deployment on a single Linux server: the app in one container, [Caddy](https://caddyserver.com) in another terminating TLS with a certificate it obtains automatically from Let's Encrypt, and PostgreSQL in a third with its data on a Docker volume that survives redeploys.

If you are deploying to a managed host such as Render rather than a server of your own, skip to [Deploying to a managed host](#deploying-to-a-managed-host).

> **The database is not optional and cannot be a file.** The app requires a PostgreSQL connection string. A container's filesystem is rebuilt on every deploy — and, on hosts that sleep when idle, on every wake — so a database file inside it silently loses every account, session and collected event each time. The entrypoint refuses to start against a `file:` URL for that reason.

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
- [Deploying to a managed host](#deploying-to-a-managed-host)
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

Edit `.env.production`. Three values must be set before the first start:

```bash
# A fresh secret, and a database password. Do not reuse the development values.
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

- `SESSION_SECRET` — paste the first value. Changing it later signs everyone out.
- `POSTGRES_PASSWORD` — paste the second. Compose gives it to the database container and builds `DATABASE_URL` from it, so you do not set `DATABASE_URL` yourself here. Changing it after the first start does not change the password already stored in the volume, so pick it now.
- `APP_URL` — `https://saibersecurity.com`, with no trailing slash. Every OAuth callback URL is built from this, so a mismatch here is the most common cause of a failed provider sign-in.

Leave `SEED_ON_FIRST_BOOT="true"` if you want the demo dataset. It runs only when the database contains no users, so a restart can never overwrite real accounts. Set it to `false` once you have your own.

Also edit the email address at the top of [`Caddyfile`](Caddyfile) so certificate-expiry notices reach a real inbox.

---

## 4. Start it

```bash
docker compose --env-file .env.production up -d --build
docker compose logs -f
```

The first build takes a few minutes. In the logs you should see PostgreSQL report itself ready, the entrypoint print `using PostgreSQL` and apply migrations, optionally seed, then the server report it is ready, and Caddy obtain a certificate. The app waits for the database's healthcheck, so the order is deterministic.

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
| Back up the database | `docker compose exec -T db pg_dump -U saiber saiber > saiber-$(date +%F).sql` |
| Restore a backup | `docker compose exec -T db psql -U saiber -d saiber < saiber-2026-09-26.sql` |
| Open a SQL prompt | `docker compose exec db psql -U saiber -d saiber` |

Run that `pg_dump` on a schedule and keep the output off the server. The `saiber-db` volume holds the only copy of your accounts, events and incidents; deleting it — including with `docker compose down -v` — destroys them.

`npm run db:reset` destroys all data and must never be run against this deployment.

---

## Deploying to a managed host

Any managed host works — Render, Fly.io, Railway, a Kubernetes cluster — with one requirement: **provision a PostgreSQL instance and point `DATABASE_URL` at it.** Managed hosts give containers a disposable filesystem, and most free tiers also stop the container when it is idle and rebuild it on the next request. A database living inside the container does not survive either event.

On Render there is nothing to configure by hand; the blueprint below does it.

### Render — use the blueprint

[`render.yaml`](render.yaml) declares the database and the web service together, so there is nothing to fill in by hand and nothing to forget:

1. Dashboard → **New → Blueprint**, and pick this repository.
2. Render shows what it will create — a `saiber-db` PostgreSQL instance and a `saibersecurity` web service. **Apply.**
3. Wait for the first deploy. Then open the URL and sign up.

That is the whole procedure. `DATABASE_URL` is wired from the database Render creates, `SESSION_SECRET` is generated for you, and `APP_URL` is unnecessary because the app falls back to the public URL Render injects.

**The blueprint does not use the Dockerfile.** It runs Render's native Node runtime instead:

```
build: npm ci --include=dev && npx prisma migrate deploy && npm run build
start: npm start
```

That is deliberate. A Docker build put apt packages, an entrypoint script and an image copy into the deploy path, all of which can fail for reasons unrelated to the app. The Node runtime removes them. Migrations run in the build step, so the schema is created on the first deploy and updated on later ones with no manual step. `--include=dev` is required rather than cosmetic: `NODE_ENV` is `production`, and npm skips devDependencies in that case, which would drop TypeScript, Tailwind and the Prisma CLI that the build needs.

The Dockerfile is still correct and still maintained — it is for self-hosting with [`docker-compose.yml`](docker-compose.yml), which brings its own PostgreSQL. It is simply not what Render uses.

Two things to know about the free plan. The service sleeps after inactivity, so the first request after a quiet spell takes about half a minute — nothing is lost, and sessions survive. And **free PostgreSQL instances expire after a fixed period and are then deleted**, so take `pg_dump` backups or move to a paid plan before you have data you care about.

If you would rather keep the existing hand-configured service, the variables it needs are `DATABASE_URL` (the database's **Internal** URL, not the external one), `SESSION_SECRET` (≥ 32 characters), and `NODE_ENV=production`. Add OAuth, Twilio and mail values only for the features you want, and never set `MAIL_DEV_FALLBACK` — on a reachable deployment it returns password-reset links in the HTTP response, which is a way into any account.

Accounts, sessions and collected events now live in the Postgres instance and survive deploys, restarts and idle spin-downs. The free tier still sleeps after inactivity, so the first request after a quiet period takes half a minute — but nothing is lost, and you stay signed in.

Free Postgres instances on Render expire after a fixed period and are then deleted. If that matters, take `pg_dump` backups or move to a paid plan.

### Elsewhere

Set the same four variables, plus the optional ones you need. On Vercel the app deploys as is — `next build` already runs `prisma generate` — with a managed database such as Neon, Supabase or Vercel Postgres; note that migrations are not applied by a build there, so run `npx prisma migrate deploy` against the database yourself when the schema changes.

---

## When something is wrong: `/api/health`

Open `https://your-site/api/health` on any deployment. It answers whether the site can actually work, and names what is wrong when it cannot:

```json
{
  "ok": false,
  "checks": [
    { "name": "sessionSecret", "ok": false, "detail": "SESSION_SECRET is not set" },
    { "name": "database", "ok": false, "detail": "the tables are missing — migrations have not been applied to this database" }
  ],
  "hint": "Set the values named above in this deployment's environment, then redeploy."
}
```

It returns 200 when everything is usable and 503 when it is not, so an uptime check treats a site nobody can sign in to as down rather than healthy.

This exists because a misconfigured deployment otherwise presents as `Internal server error` on sign-in, which is indistinguishable from a bug and sends you reading application code instead of setting a variable. The common causes it separates:

| What it says | What to do |
| --- | --- |
| `SESSION_SECRET is not set` | Set it. Sign-in and sign-up both issue a session, so both fail without it. |
| `SESSION_SECRET is N characters long` | Generate a longer one; the minimum is 32. |
| `DATABASE_URL is not set` | Point it at a PostgreSQL server. |
| `the tables are missing` | Migrations never ran. On Amplify that is what [`amplify.yml`](amplify.yml) does; elsewhere run `npx prisma migrate deploy`. |
| `the database server cannot be reached` | Host, port, or a firewall. On AWS, an RDS instance inside a VPC is not reachable from Amplify's compute. |
| `the database rejected the credentials` | Wrong user or password in `DATABASE_URL`. |

It is deliberately public and unauthenticated, because sign-in is exactly what fails when configuration is wrong — a check you had to sign in to reach would be useless. It reports only whether each thing works and a short description of the fault, never a connection string, a secret, or a raw driver error, since those can carry a host name or credentials. The underlying error goes to the server log instead.

---

## Hardening checklist

Before putting the URL in front of anyone:

- [ ] `SESSION_SECRET` is new, random, and not shared with development.
- [ ] `SEED_ON_FIRST_BOOT` is `false` once real accounts exist.
- [ ] The seeded `demo@saibersecurity.com` account is deleted, or its password changed. Its credentials are public knowledge, since they are in this repository. The sign-in page no longer prints them in production, but the account still works until you remove it.
- [ ] **Sign-up is open to anyone who can reach the URL, and every account gets full analyst access.** There is no invite, approval step, domain allow-list or role system. Put the site behind an allow-list, or add one, before exposing it publicly.
- [ ] A firewall permits only 80, 443 and your SSH port. The database container publishes no port, so it is reachable only from the app.
- [ ] `pg_dump` output is written somewhere off the server on a schedule.
- [ ] Automatic security updates are enabled on the host.

The rate limiter is in-memory and per container, so running more than one app container weakens it. Move it to a shared store before scaling out.
