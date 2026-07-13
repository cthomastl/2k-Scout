# 2K Scout — Backend Architecture

Backend microservices and CI/CD for the **2K Scout** NBA 2K scouting web app. The
React/Vite frontend lives at the repo root and is built and deployed as a static SPA
(S3 + CloudFront, not a container) — this directory holds the four server-side services.

## Architecture

```
                          ┌───────────────────────────┐
                          │   Browser (React SPA)     │
                          └─────────────┬─────────────┘
                                        │  https (CloudFront)
                                        ▼
                          ┌───────────────────────────┐
                          │   CloudFront               │
                          │   /            → S3 (SPA)  │
                          │   /api, /auth  → ALB        │
                          └──────┬───────────────┬─────┘
                                 │               │
                  / (static)     │               │ /api , /auth
                                 ▼               ▼
                   ┌──────────────────┐   ┌──────────────────────────┐
                   │ S3               │   │ ALB → gateway (:8080)    │
                   │ built dist/      │   │ http-proxy-middleware    │
                   └──────────────────┘   └───────┬─────────┬────────┘
                                                   │         │
                            /api/gameplan* ────────┘         │
                            /api/*  ──────┐    /auth/*  ──────┘
                                          │         │
                  ┌───────────────────────┼─────────┼──────────────────────┐
                  ▼                        ▼         ▼
        ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
        │ ai-service       │   │ team-service     │   │ auth-service     │
        │ (:3002)          │   │ (:3001)          │   │ (:3003)          │
        │ Anthropic gameplan│  │ NBA2K proxy      │   │ Accounts + JWT   │
        │ (JWT required)*  │  │                  │   │ (Postgres)       │
        └───┬─────────┬────┘   └──────────────────┘   └────────┬─────────┘
            │         │                                          │
            ▼         ▼                                          ▼
     Anthropic    RDS Postgres  ◀─────────────────────────  RDS Postgres
       API      (gameplans,
    (claude-      usage_events)
     opus-4-8)

* /api/gameplan and /api/gameplan/history require `Authorization: Bearer <jwt>`.
```

Request flow: **CloudFront → ALB → gateway → service**, all four backend services
running as Docker containers (via `docker compose`) on the same app-tier EC2 instances,
scaled as a group by an Auto Scaling Group — see the root
[README's Deployment section](../README.md#deployment-aws) and
[`terraform/README.md`](../terraform/README.md) for the actual infrastructure. Postgres
is RDS, shared by `auth-service` and `ai-service` (separate tables, no foreign keys
between them, so neither depends on the other's startup order).

Redis was part of an earlier, Kubernetes-based version of this deployment and isn't
provisioned in the current AWS architecture (see `terraform/README.md` for why). Both
`team-service` and `ai-service` still support `REDIS_URL` in code — it's a soft
dependency (non-blocking connect, falls back to "always cache-miss" on any error) — so
pointing it at an ElastiCache cluster later needs zero code changes, just setting the
env var in `terraform/user_data.sh.tpl`.

## Services

| Service        | Port (default) | Responsibility |
|----------------|----------------|----------------|
| `gateway`      | 8080           | API gateway / reverse proxy. Routes `/api/gameplan` → ai-service, `/api/*` → team-service, `/auth/*` → auth-service. Does not serve static files. |
| `team-service` | 3001           | Proxies `api.nba2kapi.com`, injecting the `X-API-Key` header server-side. |
| `ai-service`   | 3002           | `POST /api/gameplan` (JWT required) — builds the 2K coaching prompt, calls Anthropic, saves the result to Postgres (`gameplans`) and logs a `usage_events` row. `GET /api/gameplan/history` (JWT required) reads a user's saved plans back. |
| `auth-service` | 3003           | Real accounts backed by Postgres (`users` table, bcrypt-hashed passwords). `POST /auth/signup`, `POST /auth/login` return a 7-day JWT (now including a numeric `id`); `GET /auth/me` verifies the Bearer token. The documented demo credential is seeded as a real row on startup, not a hardcoded special case. |

Postgres itself isn't a container here — it's RDS (`terraform/rds.tf`), with AWS
generating and managing the master password rather than this app.

Every app service exposes `GET /healthz` → `200 {status:'ok'}` and allows CORS
from all origins. All four also expose `GET /metrics` (Prometheus, via `prom-client`) —
see the root [README's Observability section](../README.md#observability) for the
current state of that (not yet wired up to anything in this architecture). Logs are a
separate story: stdout/stderr from all four containers ships to a self-hosted Splunk
instance via Docker's own logging driver, no app code involved — see the root
[README's Centralized logging section](../README.md#centralized-logging-splunk).

### Routes

**team-service** (path + query forwarded to `https://api.nba2kapi.com`):
- `GET /api/teams`
- `GET /api/teams/:name/roster`
- `GET /api/players/slug/:slug`
- Implemented generically as `GET /api/*`.

**ai-service** (both require `Authorization: Bearer <jwt>`):
- `POST /api/gameplan` — body fields: `myTeam`, `opponentTeam`, `attackTargets`,
  `hideTargets`, `leaveOpen`, `speedAdvantage`, `bestMatchups`, `myKeyPlayers`,
  `oppKeyPlayers`, `opponentStrategy`. `myTeam`/`opponentTeam` required (400 if
  missing). Returns `{gamePlan, cached}`.
- `GET /api/gameplan/history` — the caller's 20 most recent saved game plans,
  newest first.

**auth-service**:
- `POST /auth/signup` `{email, password}` → `201 {token, user:{id, email, name}}`,
  `409` if the email's taken, `400` if the password's under 6 characters.
- `POST /auth/login` `{email, password}` → `{token, user:{id, email, name}}` or 401.
- `GET /auth/me` with `Authorization: Bearer <token>` → `{user:{id, email, name}}` or 401.

## Environment variables

| Service        | Variable           | Default                  | Purpose |
|----------------|--------------------|--------------------------|---------|
| team-service   | `PORT`             | `3001`                   | Listen port |
| team-service   | `NBA2K_API_KEY`    | _(none)_                 | Injected as `X-API-Key` to upstream |
| team-service   | `REDIS_URL`        | _(unset in this deployment)_ | Optional cache connection — see the Redis note above |
| ai-service     | `PORT`             | `3002`                   | Listen port |
| ai-service     | `ANTHROPIC_API_KEY`| _(none)_                 | Anthropic SDK auth |
| ai-service     | `JWT_SECRET`       | `dev-secret-change-me`   | Verifies the Bearer token on incoming requests |
| ai-service     | `DATABASE_URL`     | _(none)_                 | Postgres (RDS) connection string (gameplans, usage_events) |
| ai-service     | `REDIS_URL`        | _(unset in this deployment)_ | Optional cache connection — see the Redis note above |
| auth-service   | `PORT`             | `3003`                   | Listen port |
| auth-service   | `DEMO_EMAIL`       | `scout@2kscout.app`      | Seeded demo account email |
| auth-service   | `DEMO_PASSWORD`    | `scout2k`                | Seeded demo account password |
| auth-service   | `JWT_SECRET`       | `dev-secret-change-me`   | JWT signing secret |
| auth-service   | `DATABASE_URL`     | _(none)_                 | Postgres (RDS) connection string (users) |
| gateway        | `PORT`             | `8080`                   | Listen port |
| gateway        | `AI_SERVICE_URL`   | `http://ai-service:3002` | ai-service base URL |
| gateway        | `TEAM_SERVICE_URL` | `http://team-service:3001`| team-service base URL |
| gateway        | `AUTH_SERVICE_URL` | `http://auth-service:3003`| auth-service base URL |

`JWT_SECRET` must be identical across `auth-service` and `ai-service` — the
former signs tokens, the latter verifies them; both read it from the same SSM
parameter (`/2k-scout/JWT_SECRET` by default) so this is automatic as long as
you don't override one in isolation. In production, `docker-compose.yml` on the
app-tier instances gets these values written into a local `.env` file at boot by
`terraform/user_data.sh.tpl` — see `terraform/README.md`.

## Building images locally

```sh
docker build -t 2k-scout-team-service ./services/team-service
docker build -t 2k-scout-ai-service   ./services/ai-service
docker build -t 2k-scout-auth-service ./services/auth-service
docker build -t 2k-scout-gateway      ./services/gateway
```

## Running a service locally (without Docker)

```sh
cd services/<name>
npm install
PORT=3001 NBA2K_API_KEY=... node index.js
```

## Deploying

Infrastructure is Terraform, not Kubernetes manifests — see
[`terraform/README.md`](../terraform/README.md) for the full apply/deploy/redeploy
flow (creating app secrets in SSM, `terraform apply`, building and syncing the
frontend to S3, invalidating CloudFront, and triggering an Auto Scaling Group
instance refresh to pick up new backend images).

## CI/CD

`.github/workflows/ci-cd.yml` runs on push to `main` and `claude/**`, and on
manual dispatch:

1. **lint-build** — `npm ci` + `npm run build` to catch frontend build errors.
2. **build-and-push** (needs lint-build) — matrix over the four backend service
   images, logs in to GHCR with the workflow token, and builds/pushes each with
   `services/<name>` as context, tagged `latest` and the commit SHA. The frontend
   build isn't pushed anywhere by this job — deploying it means syncing `dist/`
   to S3 directly (see `terraform/README.md`), not publishing a container image.
