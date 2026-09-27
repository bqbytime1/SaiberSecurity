# SAiberSecurity

**AI-powered security monitoring.**

SAiberSecurity learns what normal looks like across your users, devices, and infrastructure, then identifies the deviations that matter. It ingests security events, scores each one with an explainable behavioural anomaly engine, correlates related suspicious events into incidents, explains those incidents in plain language, and recommends defensive next steps.

This repository contains the MVP: a full-stack Next.js application with a real server-side detection engine, incident correlation, an AI abstraction layer with a deterministic fallback, session authentication, a seeded demo dataset, and a security-operations console.

---

## Contents

- [Product overview](#product-overview)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [Seeding demo data](#seeding-demo-data)
- [Development commands](#development-commands)
- [Production build](#production-build)
- [Running it as a local website](#running-it-as-a-local-website)
- [Deploying to a domain](#deploying-to-a-domain)
- [Demo credentials](#demo-credentials)
- [Sign-up and sign-in methods](#sign-up-and-sign-in-methods)
- [API documentation](#api-documentation)
- [Tenancy](#tenancy)
- [What is real and what is simulated](#what-is-real-and-what-is-simulated)
- [Live host monitoring](#live-host-monitoring)
- [Anomaly detection](#anomaly-detection)
- [Incident correlation](#incident-correlation)
- [AI integration](#ai-integration)
- [Security considerations](#security-considerations)
- [Security testing](#security-testing)
- [Limitations](#limitations)
- [Future roadmap](#future-roadmap)

---

## Product overview

The core flow is:

```
Ingest security events → detect anomalies → calculate risk → correlate into incidents → explain with AI → recommend actions
```

The console provides:

| Page | Purpose |
| --- | --- |
| `/login` | Sign in with email and password, or with a linked identity provider |
| `/signup` | Create an account with email and password, a phone number, or Google, Microsoft or GitHub |
| `/dashboard` | Threat level, KPIs, events/risk over time, severity and type breakdowns, top suspicious IPs and affected users, recent incidents |
| `/live` | Live host monitoring: collector status, sample counter and a continuously updating feed of real outbound connections |
| `/live/[id]` | Full report for one observed connection: the socket, the owning process and where else it connects, the scoring breakdown, and the history of this machine talking to that destination |
| `/incidents` | Filterable, searchable incident queue with inline status management |
| `/incidents/[id]` | Full incident investigation view: scoring factors, evidence, AI analysis, recommended actions, event timeline, related events |
| `/events` | Event explorer with server-side filters and a per-event detail dialog showing every scoring factor |
| `/analytics` | Anomaly rate, average risk, incidents by severity/status, events per hour, top attack types, suspicious IPs, affected users |
| `/settings` | Organization name, detection sensitivity, automatic simulation, AI provider status |

A **Simulate New Events** button (and an optional 30–60 s automatic mode) generates realistic activity, runs it through the full pipeline, and updates every view.

---

## Tenancy

Every security event and incident belongs to an **organization**, and a signed-in user only ever sees their own. Signing up creates a new organization, which is why a new account opens on an empty console rather than inheriting whatever anyone else has collected.

The boundary is enforced by making it impossible to forget. Functions that read security data take the organization as their first parameter, with no default, so a caller that omits it fails to compile rather than quietly returning another tenant's rows. Lookups by id use `findFirst` with the organization rather than `findUnique`, so an id belonging to someone else reads as missing: the API answers 404, identically to an id that never existed.

| Concern | Where |
| --- | --- |
| Schema | `Organization`, with `organizationId` on `User`, `SecurityEvent` and `Incident`. Every read index leads with it. |
| Session | `SessionUser.organizationId`, selected alongside the user on every request |
| Sign-up | [`lib/accounts.ts`](lib/accounts.ts) creates an organization for password, provider and phone sign-ups alike |
| Correlation | Keyed within one organization, so two tenants seeing the same attacker IP never share an incident |
| Settings | Per organization, replacing the former single settings row |
| Collector | Has no signed-in user, so it files events under `HOST_MONITOR_ORG_ID`, or the oldest organization |

**What this does not yet do.** An organization holds exactly one user; there is no way to invite a colleague, and no roles, so every member would be an administrator. Deleting an organization cascades to its data, but nothing in the UI offers that.

---

## What is real and what is simulated

The console mixes two sources of data, and it matters that you can tell them apart.

| | Where it comes from | How to spot it |
| --- | --- | --- |
| **Real** | The host collector reads this machine's own TCP connection table and DNS resolver cache on a timer. Actual processes, actual remote addresses, actual ports. | `source` is `host-agent`, event type is `Network Connection`. The `/live` page shows only these. |
| **Simulated** | The synthetic generator invents plausible logins, scans and malware alerts for 12 fictional personas. This is what seeding creates and what **Simulate New Events** adds. | Any other `source`, such as `okta-sso` or `crowdstrike`. |

The simulated half exists because a demo needs incidents worth investigating, and a laptop's own traffic produces almost none. The detection engine, correlation and AI analysis treat both identically, so what you see happen to synthetic attacks is what would happen to real ones.

**The collector is not packet capture.** It samples the operating system's connection table, so there are no payloads and no byte counts, and it sees only the traffic of the machine running the server rather than a whole network. Monitoring a network segment would need a span port or a tap and a capture library, and monitoring other machines would need an agent on each. Geo-location of remote addresses also needs a database such as MaxMind, so `country` is left empty on real events rather than guessed.

See [Live host monitoring](#live-host-monitoring) for how it runs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Next.js App Router (React 19, Server Components)                         │
│                                                                          │
│  app/(app)/*        Server-rendered console pages (auth-gated layout)    │
│  app/login          Public sign-in                                       │
│  app/api/*          Route handlers (Zod-validated, session-protected)    │
│  components/*       UI (shadcn-style primitives, Recharts charts)        │
└───────────────┬──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────┐
│ Domain layer (lib/)                                                      │
│                                                                          │
│  ingest.ts       Pipeline: build context → score → persist → correlate   │
│  anomaly.ts      Pure, explainable scoring engine (factors + weights)    │
│  correlation.ts  Groups suspicious events into incidents by key/window   │
│  ai.ts           AI abstraction: OpenAI-compatible provider + local      │
│                  deterministic fallback (never throws)                   │
│  synthetic.ts    Seeded generator for normal + attack-scenario events    │
│  metrics.ts      Dashboard / analytics aggregations + threat level       │
│  queries.ts      Paginated list queries shared by pages and API          │
│  auth.ts         bcrypt password hashing, HMAC-signed DB-backed sessions │
│  validations.ts  Zod schemas for every input boundary                    │
│  rate-limit.ts   In-memory fixed-window limiter for sensitive routes     │
│  settings.ts     Per-organization settings, scoped by organizationId     │
└───────────────┬──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────┐
│ Prisma ORM → PostgreSQL (prisma/schema.prisma)                            │
│  Organization · User · Account · Session · SecurityEvent · Incident       │
└──────────────────────────────────────────────────────────────────────────┘
```

Key design decisions:

- **All scoring is server-side.** Clients can submit events, but `anomalyScore`, `riskScore`, `severity` and the scoring factors are always computed by the engine; any client-provided values are rejected by the schema.
- **Scoring is pure and explainable.** `scoreEvent(event, context)` takes precomputed behavioural context and returns a list of `{ label, points, detail }` factors. Those factors are stored on every event and surfaced verbatim in the UI.
- **Pages render from the database.** Server components call the same `lib/` functions the API uses. No dashboard data is hard-coded into React components.
- **AI is an abstraction.** `analyzeIncident()` uses a remote OpenAI-compatible provider when configured and otherwise a deterministic local engine. The app never shows an error because AI is not configured.
- **Integrations are isolated behind `RawSecurityEvent`.** Future connectors (CloudTrail, Okta, CrowdStrike, …) only need to map their payloads into that shape and call `ingestEvents()`.

---

## Tech stack

- **Next.js 16** (App Router, Server Components, Route Handlers) · **React 19** · **TypeScript** (strict)
- **Tailwind CSS v4** with a custom dark security-console theme · **shadcn/ui-style** components on Radix primitives · **lucide-react** icons
- **Recharts 3** for all charts
- **Prisma 6** + **PostgreSQL 17**
- **Zod 4** for validation · **bcryptjs** for password hashing · Node `crypto` for session signing
- OpenAI-compatible chat completions API for optional AI analysis

---

## Setup

Requirements: **Node.js 20+** (tested on Node 24), npm, and a **PostgreSQL 15+** server.

If you do not already have PostgreSQL, the quickest path is a container:

```bash
docker run -d --name saiber-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=saiberlocal -e POSTGRES_DB=saiber postgres:17-alpine
```

On Windows without Docker, `winget install PostgreSQL.PostgreSQL.17` installs a service; create the database with `createdb -U postgres saiber`.

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
# edit .env so DATABASE_URL matches your server, then:
npm run setup                 # applies migrations, then seeds the demo dataset
npm run dev
```

Then open <http://localhost:3000> and sign in with the demo credentials below. Seeding takes about 35 seconds, because every synthetic event is scored and correlated through the real pipeline.

There is no file-based database option. The app stores accounts, sessions and collected events in PostgreSQL because that is the only way they survive a redeploy or a container restart on a hosted deployment — see [`DEPLOYMENT.md`](DEPLOYMENT.md).

`npm install` runs `prisma generate` automatically via `postinstall`. If npm reports that install scripts were blocked (`npm warn allow-scripts`), approve them with `npm approve-scripts prisma @prisma/engines esbuild` and run `npm rebuild`.

> **Note for protected directories (Windows).** Next.js walks up parent directories looking for a `.git` folder. If the project lives under a system-protected path (for example `D:\WpSystem\…`), that walk can hit a directory the OS refuses to `stat` and the dev server exits immediately after "Ready". Running `git init` in the project root (or creating an empty `.git` folder if git is not installed) stops the walk at the project and resolves it.

---

## Environment variables

Copy `.env.example` to `.env`. Only `DATABASE_URL` and `SESSION_SECRET` are required.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string, e.g. `postgresql://postgres:password@127.0.0.1:5432/saiber?schema=public`. There is no default and no file-based fallback. |
| `SESSION_SECRET` | yes | Secret used to HMAC-sign session cookies. Must be ≥ 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `AI_API_KEY` | no | API key for an OpenAI-compatible provider. Leave empty to use the local deterministic analysis engine. |
| `AI_BASE_URL` | no | Base URL of the provider, e.g. `https://api.openai.com/v1`. Any OpenAI-compatible endpoint works (Azure OpenAI, OpenRouter, Ollama, vLLM, …). |
| `AI_MODEL` | no | Model name, e.g. `gpt-4o-mini`. |
| `APP_URL` | no | Public origin used to build OAuth callback URLs. Falls back to the request origin, which is wrong behind a proxy. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Enables the Google button on sign-in and sign-up. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | no | Enables the Microsoft button. `MICROSOFT_TENANT` defaults to `common`. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | no | Enables the GitHub button. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | no | Sends phone verification codes by SMS. Outside production, codes fall back to the server log. |

API keys and client secrets are read only on the server and are never sent to the browser. The Settings page shows *whether* an AI provider is configured, not the key, and the sign-in page reports only which identity providers exist.

---

## Database setup

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma). Models:

- **User** — `id, email?, emailVerified?, phone?, phoneVerified?, passwordHash?, name, image?, signupMethod, createdAt`. Email and password are both optional: an account created by phone has no email, and one created through an identity provider has no password.
- **Account** — a federated identity linked to a user: `provider, providerAccountId, email?`, unique on the provider and its account id
- **VerificationCode** — short-lived phone codes: `channel, target, codeHash, name?, attempts, expiresAt, consumedAt?`
- **Session** — server-side session record (`tokenHash`, `userId`, `expiresAt`)
- **SecurityEvent** — `timestamp, source, eventType, user, sourceIp, destinationIp, country, device, action, status, metadata (JSON), anomalyScore, riskScore, severity, scoreFactors (JSON), incidentId, createdAt`
- **Incident** — `title, description, severity, riskScore, status, category, correlationKey, eventCount, affectedUser, primaryIp, detectionReasons (JSON), aiExplanation (JSON), recommendedActions (JSON), aiProvider, firstEventAt, lastEventAt, createdAt, updatedAt, resolvedAt`
- **Organization** — the tenancy boundary, one per account: `name, detectionSensitivity, autoSimulate, autoSimulateInterval`. Every user, event and incident carries its `organizationId`, and every query in `lib/` takes one as its first argument so a missing scope is a compile error rather than a data leak.

Prisma is configured by [`prisma.config.ts`](prisma.config.ts), which sets the schema path and the seed command. It also loads `.env` explicitly, because the Prisma CLI stops reading `.env` on its own once a config file is present.

Commands:

```bash
npx prisma migrate deploy   # apply migrations to the database in DATABASE_URL
npm run seed                # re-generate the demo dataset (clears events and incidents)
npm run db:reset            # drop, re-migrate and re-seed
npm run db:studio           # browse data in Prisma Studio
```

`npm run db:reset` destroys the database and rebuilds it from the migrations. Prisma refuses to run it non-interactively when it detects an AI coding agent, which is deliberate; run it yourself when you want a clean slate. `npm run seed` is the non-destructive path and is enough for refreshing demo data.

---

## Seeding demo data

```bash
npm run seed
```

The seed (`prisma/seed.ts`) is idempotent: it upserts the demo user, clears events/incidents, then generates **7 days** of realistic activity for 12 personas (engineers, finance, HR, service accounts, …) across multiple time zones. Eleven attack scenarios are injected at realistic times and run through the **same** scoring and correlation pipeline as live traffic — nothing in the seed assigns scores directly.

A run produces about 1,400 events, of which roughly 60 (4–5%) cross the suspicious threshold, correlating into 11 incidents across all four severities and all four workflow states.

The five headline incidents on first login are:

| Incident | Severity |
| --- | --- |
| Impossible Travel Login | CRITICAL |
| Credential Stuffing Attempt | HIGH |
| Port Scan Detected | HIGH |
| Unusual Data Transfer | HIGH |
| Suspicious Privilege Escalation | MEDIUM |

Older scenarios (repeated failed logins, malware, suspicious process, abnormal API volume, unauthorized access, unusual login location) are also present, with a realistic mix of resolved / false-positive statuses.

---

## Development commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server on <http://localhost:3000> |
| `npm run website` | Serve the production build at <http://localhost>, loopback only |
| `npm run setup` | Apply migrations and seed the demo dataset |
| `npm run build` | `prisma generate` + production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Seed the database |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:reset` | Reset database and re-seed |
| `npm run db:studio` | Prisma Studio |

---

## Production build

```bash
npm run build
npm start
```

Before deploying:

1. Set a strong `SESSION_SECRET`.
2. Set `NODE_ENV=production` so session cookies are marked `Secure`; serve over HTTPS.
3. Point `DATABASE_URL` at a PostgreSQL server that lives outside the app container. The bundled entrypoint runs `npx prisma migrate deploy` on every boot, so the schema is applied for you.

---

## Verification

The MVP was checked end to end against both the dev server and a production build:

```bash
npm run lint        # clean
npm run typecheck   # clean
npm run build       # succeeds; 21 routes
```

Beyond that, a headless-browser pass drove the real UI (sign in, chart rendering, the simulate button, incident status changes through the dropdown, the event detail dialog, filters, settings persistence, a 390px mobile layout and sign-out) and an HTTP pass exercised every API route including authentication, validation and rate limiting. Both passed against the dev server and the production build, with no browser console errors or warnings.

A second browser pass covers sign-up: password rules, duplicate addresses, signing in afterwards with the new password, the full phone code round trip including a wrong code and a repeat sign-in that reuses the same account, and the identity-provider routes rejecting an unconfigured provider, an unknown provider, and a callback with no matching state.

One caveat worth knowing if you script against a production instance: session cookies carry the `Secure` flag when `NODE_ENV=production`, so an HTTP client that declines to send Secure cookies over plain `http://localhost` will appear to be signed out after a successful login. Browsers treat `localhost` as a secure context and are unaffected. Serve over HTTPS, or test the flow in a browser.

---

## Running it as a local website

For everyday use on your own machine, run the production build at `http://localhost` instead of the development server.

Double-click **start-website.cmd**, or the *SaiberSecurity Website* shortcut on the Desktop. It installs dependencies, sets up the database and builds the site the first time, then serves it and opens a browser. **stop-website.cmd** stops it. From a terminal the equivalent is `npm run website`.

Three deliberate choices in that launcher:

- **It binds to `127.0.0.1`, not every interface.** The site is reachable from this computer and nothing else. That matters because it records which addresses this machine connects to, and you do not want that browsable from the rest of your network.
- **It runs in production mode**, so pages are faster, there is no development overlay, and the demo credentials are not printed on the sign-in page.
- **It turns host monitoring on explicitly.** Production defaults it off, since on a real server it would report the server's own traffic rather than anything useful.

Port 80 is used so the address is just `http://localhost`. On Windows this needs no administrator rights. If something else already has port 80, change `--port` in the launcher and use `http://localhost:<port>`.

---

## Deploying to a domain

[`DEPLOYMENT.md`](DEPLOYMENT.md) is a complete walkthrough for putting this on a public domain: DNS records, TLS, OAuth redirect URIs, first-boot migration and seeding, backups, and a hardening checklist.

The repository ships everything that deployment needs:

| File | Purpose |
| --- | --- |
| [`Dockerfile`](Dockerfile) | Production image. Conventional single stage, so the Prisma CLI stays available to apply migrations on boot. |
| [`docker-compose.yml`](docker-compose.yml) | App plus Caddy. The app publishes no port; only Caddy is exposed. |
| [`Caddyfile`](Caddyfile) | Terminates TLS with an automatically issued Let's Encrypt certificate. |
| [`docker-entrypoint.sh`](docker-entrypoint.sh) | Runs `prisma migrate deploy`, optionally seeds an empty database, then starts the server. |
| [`.env.production.example`](.env.production.example) | Production environment template. |

```bash
cp .env.production.example .env.production   # fill in SESSION_SECRET, POSTGRES_PASSWORD, APP_URL
docker compose --env-file .env.production up -d --build
```

The stack includes its own PostgreSQL container, whose data sits on a named volume so accounts and sessions survive redeploys. On a managed host such as Render you provision a Postgres instance instead and set `DATABASE_URL` to it; the guide has the exact steps. One caveat: **the container files have not been executed in the environment where this project was built**, because Docker is not installed there, so watch the first build rather than running it detached.

---

## Demo credentials

| Field | Value |
| --- | --- |
| Email | `demo@saibersecurity.com` |
| Password | `SaiberDemo2026!` |

The login page shows these credentials beneath the form. Remove that hint from [`components/auth/login-form.tsx`](components/auth/login-form.tsx) before putting the app in front of anyone outside your team.

---

## Sign-up and sign-in methods

`/signup` offers three ways to create an account. Email and password works out of the box; the other two are enabled by configuration, and any method left unconfigured is shown disabled with an explanation rather than failing after a redirect.

| Method | Works out of the box | Enabled by |
| --- | --- | --- |
| Email and password | yes | nothing to configure |
| Phone, by one-time code | yes, outside production | `TWILIO_*` for real delivery |
| Google, Microsoft, GitHub | no | that provider's client ID and secret |

### Email and password

Passwords must be at least 8 characters, are rejected if they appear in a small list of common choices or contain the local part of the email address, and are stored as bcrypt hashes at cost 12. Sign-up creates the account and its session in one step.

### Forgotten passwords

"Forgot password?" on the sign-in form leads to `/forgot-password`. Entering an address issues a single-use link valid for one hour, which opens `/reset-password` to choose a new one.

The flow is built so it cannot be used to learn things about accounts:

- **The answer never changes.** A known address and an unknown one produce identical wording, so the form cannot confirm who has an account. A delivery failure is logged and still answers the same way.
- **Only a keyed hash of each token is stored**, tokens expire after an hour, work once, and requesting a new one cancels any still outstanding. The lookup compares in constant time.
- **Completing a reset deletes every session for that account.** Recovering an account you may have lost control of should turn out whoever else was signed in.
- **Rate limited twice**, per client address and again per email address, so one mailbox cannot be flooded from rotating clients. The per-address limit is enforced silently, since announcing it would confirm the address.
- **An account with no password** — created through Google, Microsoft, GitHub or a phone number — is told which method it uses instead of being sent a link that would set a password nobody asked for.

Set `MAIL_API_URL`, `MAIL_API_KEY` and `MAIL_FROM` to send real mail. Any HTTP mail API taking a JSON body of from/to/subject/text works, including Resend and Postmark.

**With no provider configured, the message is written to the server log instead**, and that is the default everywhere. Reset therefore works on a fresh deployment rather than presenting a dead form; recovering an account means reading your host's log. The response carries nothing, so this is safe on a public site. Set `MAIL_TRANSPORT="none"` to switch reset off entirely.

One stronger fallback exists for local use only: `MAIL_DEV_FALLBACK=true` also returns the link in the HTTP response and renders it in the form, which is how the personal localhost build runs. **Never set that on a deployment other people can reach** — it hands a working reset link for any address to anyone who asks.

### Phone

Entering a number in international format (`+1 555 010 0199`) sends a six-digit code that expires after ten minutes. Only a keyed hash of the code is stored, each code carries its own attempt counter capped at five, and requesting a new code invalidates the previous one. Codes are rate limited per client address and again per destination number, so one number cannot be flooded from rotating addresses.

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` to send real messages. **Without them, and only outside production, the code is written to the server log and displayed in the form** so the flow can be exercised locally. In production a missing provider makes the endpoint return 503 rather than revealing a code.

A verified number is the account identifier, so signing up and signing in are the same action: a returning number lands back in the account it already created. Accounts created this way have no email address, which is why `email` is nullable on the user model.

### Google, Microsoft and GitHub

Each provider uses the OAuth 2.0 authorization-code flow with PKCE. Create a client with the provider, then set its two environment variables and restart:

| Provider | Where to register | Variables |
| --- | --- | --- |
| Google | <https://console.cloud.google.com/apis/credentials> | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Microsoft | <https://entra.microsoft.com> → App registrations | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optional `MICROSOFT_TENANT` |
| GitHub | <https://github.com/settings/developers> | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

Register the callback URL `{APP_URL}/api/auth/oauth/{provider}/callback`, for example `http://localhost:3000/api/auth/oauth/google/callback`. `APP_URL` should be the public origin; it falls back to the request origin, which is fine locally but wrong behind a proxy.

Adding a fourth provider means appending one entry to `PROVIDERS` in [`lib/oauth.ts`](lib/oauth.ts) with its two endpoints and a function that maps its profile response. Nothing else changes.

**Account linking.** A provider identity is attached to an existing account only when the provider states that the email address is verified. Linking on an unverified address would let anyone who can create a provider account claiming someone else's address take over that account. When the address is already registered and unverified, sign-in is refused with a message asking the user to sign in with their password first.

---

## API documentation

All endpoints return JSON. Errors have the shape `{ "error": "message" }` and never include stack traces. Every endpoint except `POST /api/auth/login` requires a valid session cookie and returns `401` otherwise. Inputs are validated with Zod; invalid input returns `400` with a description of the problem.

### Authentication

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Body `{ email, password }`. Sets the `saiber_session` cookie. Rate limited (10 / 5 min per IP). |
| `POST` | `/api/auth/signup` | Body `{ name, email, password }`. Creates the account and signs it in. `409` when the address is taken. Rate limited (10 / 15 min per IP). |
| `POST` | `/api/auth/forgot-password` | Body `{ email }`. Issues a single-use reset link. Always answers the same way. Returns `devLink` only when the mail fallback is allowed. |
| `POST` | `/api/auth/reset-password` | Body `{ token, password, confirm }`. Sets the new password, consumes the token and revokes every session for the account. |
| `POST` | `/api/auth/phone/start` | Body `{ phone, name? }`. Sends a six-digit code. Returns `devCode` only outside production with no SMS provider. Rate limited per IP and per number. |
| `POST` | `/api/auth/phone/verify` | Body `{ phone, code, name? }`. Signs in, creating the account on first use. |
| `GET` | `/api/auth/oauth/{provider}` | Starts the authorization-code flow for `google`, `microsoft` or `github`. Redirects to the provider. |
| `GET` | `/api/auth/oauth/{provider}/callback` | Provider callback. Verifies state, exchanges the code, signs in, and redirects to `/dashboard`. Failures return to `/login?error=…`. |
| `POST` | `/api/auth/logout` | Destroys the session. |
| `GET` | `/api/auth/me` | Current user. |

### Events

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/events` | Paginated list. Query: `page, pageSize (≤200), severity, eventType, user, sourceIp, from, to, minRisk, incidentId, search, sort (timestamp\|riskScore), order (asc\|desc)`. |
| `GET` | `/api/events/:id` | Single event with scoring factors, metadata and its incident (if any). |
| `POST` | `/api/events` | Ingest one event or `{ events: [...] }` (≤500). Runs anomaly detection, risk scoring and correlation. **Scores are computed server-side; any client-provided `anomalyScore`, `riskScore` or `severity` are rejected.** Rate limited (60 / min). |

Event payload:

```json
{
  "timestamp": "2026-09-08T14:32:00Z",
  "source": "okta-sso",
  "eventType": "failed_login",
  "user": "alice.chen",
  "sourceIp": "185.220.101.34",
  "destinationIp": null,
  "country": "RU",
  "device": "Unknown-Device",
  "action": "user.session.start",
  "status": "failed",
  "metadata": { "reason": "invalid_password" }
}
```

Supported `eventType` values: `failed_login, successful_login, impossible_travel, privilege_escalation, suspicious_process, unusual_api_request, data_download, port_scan, credential_attack, malware_detected, unusual_dns, unauthorized_access, configuration_change`.

### Incidents

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/incidents` | Paginated list. Query: `page, pageSize, severity, status, search`. |
| `GET` | `/api/incidents/:id` | Incident with correlated events, detection reasons, AI analysis and recommended actions. |
| `PATCH` | `/api/incidents/:id` | Body `{ status }` where status ∈ `OPEN, INVESTIGATING, RESOLVED, FALSE_POSITIVE`. Sets/clears `resolvedAt`. Risk scores cannot be edited. |

### Metrics, analytics, simulation, AI, settings

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/metrics` | Dashboard metrics: threat level and reasons, totals, hourly buckets, severity/type breakdowns, top IPs/users, recent incidents. |
| `GET` | `/api/analytics` | Anomaly rate, average risk, incidents by severity/status, events per hour, top attack types, suspicious IPs, affected users, risk distribution, MTTR. |
| `POST` | `/api/simulate` | Body (optional) `{ scenario?, bursts? (1–5) }`. Generates a burst of realistic events (mostly normal, sometimes a scenario) and runs the pipeline. Returns counts and touched incidents. Rate limited (20 / min). |
| `POST` | `/api/ai/analyze` | Body `{ incidentId }`. Re-runs AI analysis for an incident (remote provider if configured, otherwise local). Rate limited (15 / min). |
| `GET` | `/api/settings` | Organization settings plus AI provider status (never the key). |
| `PATCH` | `/api/settings` | Body: any of `organizationName, detectionSensitivity (LOW\|MEDIUM\|HIGH), autoSimulate, autoSimulateInterval (30–60)`. |

Scenario names for `/api/simulate`: `repeated_failed_logins, credential_stuffing, impossible_travel, unusual_location_login, abnormal_api_volume, abnormal_data_transfer, privilege_escalation, port_scan, suspicious_process, malware_detected, unauthorized_access`.

---

## Live host monitoring

A single interval inside the Node process samples the host and feeds what it finds through the same pipeline as everything else. It is started from [`instrumentation.ts`](instrumentation.ts), which Next.js runs once per server process, so **collection continues whether or not anyone has a browser open**. That is the difference from the older auto-simulate toggle, which only ticked while a tab was in the foreground.

Each cycle ([`lib/monitor.ts`](lib/monitor.ts), [`lib/collectors/host-network.ts`](lib/collectors/host-network.ts)):

1. Read established TCP connections with their owning process, and the DNS resolver cache. On Windows this is `Get-NetTCPConnection` and `Get-DnsClientCache`; elsewhere it falls back to `netstat`, which cannot attribute a process without elevation.
2. Drop loopback and private-range destinations, which are the machine talking to itself or the LAN.
3. Skip connections already reported, tracked for ten minutes, so a long-lived socket is not re-emitted every sample.
4. Label each remote address with the name that resolved to it, so `160.79.104.10` reads as `api.anthropic.com`.
5. Score, persist and correlate through `ingestEvents()`, exactly like an ingested event.

Scoring is deliberately quiet. `network_connection` has a base weight of **1**, because a browser opening a socket is the most ordinary thing a machine does and anything higher would bury the console in false positives. Points are added for the shape of the connection, not its existence: a remote-administration port such as 3389 or 445, an uncommon destination port, a scripting host like `powershell` or `mshta` making an outbound connection, or a destination with no matching DNS lookup. In practice ordinary HTTPS browsing lands at risk 7, and something like Steam on port 27018 at 13.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST_MONITOR_ENABLED` | on outside production | Master switch. Off by default in production, where this would report the server's own egress. |
| `HOST_MONITOR_INTERVAL_MS` | `15000` | Sampling interval, minimum 5000. |

`GET /api/monitor` returns collector status plus recent events; `POST /api/monitor` with `{"action":"start"|"stop"|"poll"}` controls it. The `/live` page drives those, and the dashboard carries a one-line strip showing the host, the open-connection count and the age of the last sample.

### Connection reports

Selecting any row on `/live` opens a report for that single connection ([`lib/connections.ts`](lib/connections.ts)). It is assembled from stored events, so it states only what the data supports:

- **The socket** — destination and port, source and local port, protocol, state, direction, and whether the destination is public or on the LAN.
- **The process** — name, PID, how many connections it has made, how many distinct destinations, and the addresses it contacts most.
- **The score** — every factor that contributed, with the reasoning behind a base weight of 1.
- **The destination** — total connections to that address, peak risk, when it was first and last seen, which ports were used, and which processes contacted it.
- **Related activity** — other connections to the same address, each linking to its own report, plus the correlated incident when there is one.

There is deliberately no geo-location or reputation verdict: the collector has neither a geo-IP database nor a threat feed, and inventing one would be worse than leaving it out.

**Privacy.** This records which remote addresses the host talks to and which process did it. On a personal machine that is a log of your own browsing. It is stored in the local database and shown to anyone who can sign in to the console, so turn it off with `HOST_MONITOR_ENABLED=false` if that is not what you want.

Running several app instances against one database would make each collect independently; a lock would be needed first.

---

## Anomaly detection

The engine lives in [`lib/anomaly.ts`](lib/anomaly.ts) and is deliberately **deterministic and explainable**. Every event receives:

- `anomalyScore` (0–100) — how far the event deviates from expected behaviour
- `riskScore` (0–100) — the anomaly score adjusted for the business sensitivity of what was touched
- `severity` — `LOW` (< 30), `MEDIUM` (30–54), `HIGH` (55–79), `CRITICAL` (≥ 80), derived from `riskScore`
- `scoreFactors` — the full list of contributions, e.g. `+32 Authentication frequency abnormal — 24 failed attempts from 185.220.101.34 in 15 min`

### How a score is built

1. **Event-type weighting.** Each type has a base prior (e.g. `successful_login` 2, `failed_login` 8, `credential_attack` 20, `port_scan` 30, `privilege_escalation` 28, `unauthorized_access` 55, `impossible_travel` 62, `malware_detected` 72).
2. **Behavioural context** is fetched from the database for the entities involved ([`lib/ingest.ts`](lib/ingest.ts)):
   - per-user baseline over 30 days — home country, distinct countries, typical active hours, mean/σ of download volume, mean API request volume (only from previously *normal* events so the baseline is not poisoned by attacks);
   - per-IP short-window counts — failed authentications and distinct targeted accounts in 15 min, total and suspicious events in 60 min, port-scan bursts, prior flagged activity (24 h ago → 1 h ago, so a burst does not reinforce itself);
   - per-user recent history — failed auths in 30 min, last authenticated location, recent privilege escalation, recent interactive login.
3. **Factors** are added on top of the base weight:
   - *Frequency analysis* — repeated auth failures from one IP (+6 / +12 / +22 / +32 at 3 / 5 / 10 / 20 attempts), many distinct accounts from one IP (credential stuffing, +12), account under sustained attack, success following repeated failures (+35).
   - *Unusual locations* — login from a country outside the user's baseline (+30 if the user has never been seen elsewhere, +12 otherwise), elevated-risk geography (+8).
   - *Impossible travel* — different country from the previous authentication within 120 minutes (+45, or +20 when the source already labelled it), physically impossible implied speed (+18).
   - *Time-of-day* — activity outside the user's learned active hours (+10) or generic off-hours (+6); not applied to attacker-driven auth failures.
   - *Statistical deviation* — download volume in σ from the user's own mean (+14 / +30 / +45 at 2σ / 3σ / 6σ), or absolute thresholds when no baseline exists; API request volume vs. baseline (up to +45 at 20×).
   - *Port scanning* — number of ports probed, sustained bursts.
   - *Privilege changes* — elevation to admin-class roles, no preceding interactive login, and a compounding factor (+20) for notable activity that follows an escalation within an hour.
   - *Malware / process* — high-impact families, living-off-the-land command lines, credential-dumping indicators; containment by an endpoint control reduces the score.
   - *DNS* — Shannon entropy of the queried label (DGA / tunnelling patterns), query volume.
   - *Suspicious IP behaviour* — external sources previously flagged or generating abnormal volumes (internal RFC1918 addresses are excluded).
4. The **detection sensitivity** setting scales the raw anomaly sum (0.85× / 1× / 1.15×), the result is capped at 100, and a **business-risk adjustment** (+10) is applied when the action touches sensitive resources (production, database, finance, HR, secrets, admin roles, backups) to produce `riskScore`.

Worked examples from the seeded data:

| Situation | Typical outcome |
| --- | --- |
| A single failed login from a user's usual device | 8 → LOW |
| 20 failed logins from one external IP against one account | 8 + 32 + 8 (geo) + 10 (sustained) ≈ 58 → HIGH |
| Credential stuffing across 7 accounts | 20 + 32 + 12 + 8 ≈ 72 → HIGH |
| Login from a country never seen for that user | 2 + 30 (+10 off-hours) ≈ 32–42 → MEDIUM |
| Impossible travel | 62 + 20 + 30 + 18 → 100 → CRITICAL |
| 3 GB download vs. a 10 MB baseline, from a customer database | 10 + 45 + 10 (sensitive) ≈ 65 → HIGH |
| Privilege escalation to AdministratorAccess followed by opening a prod DB security group | 28 + 12 + 10 → 50 → MEDIUM, with the follow-on change folded into the same incident |

Events with `anomalyScore ≥ 30` are considered suspicious and eligible for correlation.

---

## Incident correlation

[`lib/correlation.ts`](lib/correlation.ts) turns suspicious events into incidents:

1. Each suspicious event is assigned an **incident category** from its type and factors (e.g. a `successful_login` with an *Impossible travel* factor becomes `impossible_travel`; a `configuration_change` that *follows a privilege escalation* is folded into `privilege_escalation`; a `data_download` only becomes `data_exfiltration` above 400 MB).
2. A **correlation key** ties the category to the right entity: credential attacks and port scans key on the **source IP**, malware/process/DNS on the **device**, everything else on the **user**.
3. If an `OPEN` or `INVESTIGATING` incident with the same key has activity within a **90-minute window**, the event is attached to it; otherwise a new incident is opened. This is why 36 credential-stuffing attempts become one incident, not 36.
4. On every attachment the incident's risk (peak event risk + a small volume bonus), severity (never downgraded automatically), affected user, primary IP, description and detection reasons are recomputed, and the local analysis is refreshed. Remote AI analysis is refreshed on creation, every 10th event, and on demand.

---

## AI integration

[`lib/ai.ts`](lib/ai.ts) exposes `analyzeIncident(input)` which returns `{ analysis, provider }` and **never throws**.

- **Remote provider** — when `AI_API_KEY` is set, the incident's evidence (title, category, severity, scoring reasons and up to 40 events with metadata) is sent to `${AI_BASE_URL}/chat/completions` using `AI_MODEL`, with `response_format: json_object`, a 25 s timeout, and a system prompt that instructs the model to act as a senior SOC analyst, to hedge appropriately ("likely", "potentially", "consistent with", "may indicate"), and to return exactly: `summary, whySuspicious, evidence[], riskAssessment, potentialImpact, recommendedActions[]`. The response is validated and normalised; any failure (network, non-JSON, missing fields) falls through to the local engine.
- **Local deterministic engine** — builds the same six sections from the incident data: category-specific narrative templates populated with the actual users, IPs, countries, volumes, roles, signatures and timings; the top scoring factors as the "why"; concrete evidence lines; a severity-appropriate risk statement that accounts for whether controls blocked the activity; and practical, defensive recommended actions. Because it is derived from the evidence it is fully reproducible and appropriately uncertain in tone.

The incident detail page indicates which provider produced the analysis, and **Re-run analysis** calls `POST /api/ai/analyze`.

---

## Security considerations

- **Password hashing** — bcrypt with cost 12; login performs a comparison even for unknown emails, and for accounts that have no password because they were created through a provider or by phone, so response timing reveals neither case.
- **OAuth** — authorization-code flow with PKCE (S256). The `state` and the PKCE verifier travel in a signed, httpOnly, ten-minute cookie that is cleared on the first callback, so a state cannot be replayed; `state` is compared in constant time, and a callback that arrives without a matching cookie is refused.
- **Identity linking** — a provider identity joins an existing account only when the provider asserts the email is verified, which blocks takeover by way of an unverified address.
- **One-time codes** — six digits from a cryptographic source, stored only as a keyed hash, valid ten minutes, capped at five attempts per code, superseded when a new code is requested, and rate limited both per client address and per destination number.
- **Enumeration** — registration necessarily reveals that an address is taken, so it says so plainly and is rate limited; login stays deliberately generic so the two together do not become a fast oracle.
- **Sessions** — random 256-bit tokens; only a SHA-256 hash is stored in the database; the cookie value is HMAC-signed with `SESSION_SECRET` and verified with a constant-time comparison; cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, and expire after 7 days; sessions are revoked on logout and expired sessions are pruned.
- **Authentication checks** — every console page is gated by the `(app)` layout; every API route except login is wrapped in `withAuth`, which returns `401` without touching data.
- **Authorization** — the MVP has a single analyst role; all authenticated users have the same permissions (see roadmap for RBAC).
- **Validation** — every request body and query string is parsed with Zod; unknown enum values, malformed IPs, oversized payloads and out-of-range numbers are rejected with `400`.
- **Server-side scoring** — clients cannot set or influence scores, severities, or factors.
- **Database** — all access goes through Prisma's parameterised queries; no raw SQL.
- **Secrets** — read from environment variables only; `.env` is git-ignored; the Settings page and API expose provider status but never the key.
- **Safe errors** — API errors are generic; details are logged server-side only. The client error boundary shows a reference digest, not a stack.
- **Rate limiting** — login, event ingestion, simulation and AI analysis endpoints are rate limited per client IP (in-memory, per instance).
- **Headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` and a restrictive `Permissions-Policy` are set; `X-Powered-By` is disabled.
- **Defensive only** — the product contains no offensive capability. The synthetic generator produces telemetry describing attacks; it does not perform them.

---

## Security testing

The application was tested against itself rather than reviewed by eye. 63 automated checks covering file exposure, unauthenticated access, injection, session handling, error leakage and response headers all pass, plus separate checks in production mode.

What was probed, and what held:

| Area | Probe | Result |
| --- | --- | --- |
| Secret files over HTTP | 26 paths including `/.env`, `/prisma/dev.db`, `/.git/config`, `.next` internals, and traversal forms such as `/_next/static/../../.env` and `/%2e%2e%2f.env` | All 404 or 400 |
| Unauthenticated API | Every route, including `POST /api/monitor` and `PATCH /api/settings` | All 401 |
| Credential fields in responses | `passwordHash`, `tokenHash`, `codeHash`, `SESSION_SECRET` across every endpoint | Never returned |
| AI provider key | `GET /api/settings` | Returns a `configured` boolean only |
| SQL injection | Four payloads through every string filter, then a table-existence check | Parameterised by Prisma; `User` intact |
| Command injection | Crafted `action` values aimed at the PowerShell collector, including `poll; calc.exe` and `$(whoami)` | Rejected 400 by the enum schema |
| Stored XSS | `<script>`, `<img onerror>` and `<svg onload>` ingested, then rendered in the table and detail dialog | Escaped to text, zero injected nodes, no dialog fired |
| Session forgery | Fabricated cookie, and a real token with a rewritten HMAC | Both 401 |
| Error handling | Malformed ids and non-JSON bodies | No stack traces or module paths |

Verified separately with `NODE_ENV=production`: session cookies carry `Secure`, `HttpOnly` and `SameSite=Lax`; HSTS is sent; the host collector stays off; and the phone endpoint returns 503 rather than the one-time code.

**One real issue was found and fixed.** The login page previously contained the demo credentials as a literal inside a client component, so `SaiberDemo2026!` was compiled into a browser chunk and printed on the page for every anonymous visitor. On a public deployment that published a working login. The credentials now come from the server and are omitted entirely unless this is plainly not a real deployment; `SHOW_DEMO_CREDENTIALS` overrides in either direction. A production build no longer contains the string anywhere in client output.

Two things this testing does **not** cover: there is no authorization model to test, because every account is a full analyst, and the rate limiter is per process, so it weakens if you run more than one container.

---

## Limitations

- **Single instance.** Rate limiting is in-memory, so horizontal scaling weakens it until it moves to a shared store. The database itself is PostgreSQL and already supports more than one app container.
- **Heuristic baselines.** Baselines are computed from the last 30 days of normal events per user with simple statistics (mode, mean/σ, activity histogram). There is no ML model and no per-organisation tuning beyond the sensitivity multiplier.
- **Scores are not recomputed retroactively.** Changing sensitivity affects new events only.
- **Correlation is key-based.** Cross-entity chains (e.g. a port scan followed by a login from the same IP) are surfaced through IP-reputation factors but are not merged into a single kill-chain incident.
- **Automatic simulation runs in the browser.** It only generates events while a signed-in console tab is open.
- **AI cost control is basic.** Remote analysis runs on incident creation, every 10th correlated event, and on demand; there is no token budgeting.
- **Synthetic data only.** No real integrations ship in this MVP.
- **Email addresses are not verified on password sign-up.** An account is usable immediately; only addresses asserted by an identity provider are marked verified. There is no confirmation email. Password reset exists, but because the address was never proven, a reset link goes to whatever was typed at sign-up.
- **Every account is a full analyst.** Sign-up is open to anyone who can reach the deployment, and there is no approval step, invite, or domain allow-list. Put it behind your own gate before exposing it, and see the roadmap for role-based access control.
- **One provider identity per account per provider.** There is no screen for linking or unlinking providers after the fact, so a user who signed up by password can only add Google by signing in with a Google account whose verified address matches.
- **One known advisory in the toolchain.** `npm audit` reports a high-severity stack-exhaustion issue in `deepmerge-ts`, reached through `@prisma/config` and the `prisma` CLI. The CLI is a development dependency, but the container image installs it and the entrypoint runs `prisma migrate deploy` on every boot, so the code path does execute there. Its only input is this project's own `prisma.config.ts`, never anything a user supplies, and it is not reachable from an HTTP request. `npm audit fix --force` would downgrade Prisma to 6.12, which predates the config-file support this project uses, so the advisory is accepted rather than patched.
- **A missing incident page answers 200, not 404.** `/incidents/<unknown-id>` displays the correct "Page not found" screen, but the HTTP status is 200 because the shared loading skeleton streams the shell before the lookup finishes, and a status cannot be changed once the response has started. Unknown routes with no loading boundary return a real 404, and `GET /api/incidents/<unknown-id>` returns a real 404 for programmatic clients.

---

## Future roadmap

Architected for, but intentionally not implemented in the MVP:

- **Ingestion connectors** — AWS CloudTrail, Microsoft 365, Google Workspace, Okta, CrowdStrike; endpoint agents and network sensors. Each maps to `RawSecurityEvent` and calls `ingestEvents()`.
- **Threat-intelligence feeds** feeding the IP/domain reputation factors.
- **Alerting** — Slack / Teams and email notifications on incident creation and escalation.
- **SIEM integrations** and event export.
- **Automated remediation / SOAR** playbooks driven by recommended actions.
- **Custom ML models** for baselining and scoring, alongside the explainable rule engine.
- **Multi-tenancy, billing, RBAC, SAML.** The OAuth layer in [`lib/oauth.ts`](lib/oauth.ts) already generalises to more providers; enterprise SSO, invite-only sign-up, domain allow-lists and per-role permissions are the next step.
- **Account self-service** — email verification, changing a password while signed in, linking and unlinking providers, and a second factor for password accounts.
