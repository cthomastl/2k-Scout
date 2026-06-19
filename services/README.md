# 2K Scout — Backend Architecture

Backend microservices, Docker, Kubernetes, and CI/CD for the **2K Scout** NBA 2K
scouting web app. The React/Vite frontend lives at the repo root; this directory
holds the server-side services.

## Architecture

```
                          ┌───────────────────────────┐
                          │   Browser (React SPA)     │
                          └─────────────┬─────────────┘
                                        │  http (host: 2kscout.local)
                                        ▼
                          ┌───────────────────────────┐
                          │   Ingress (nginx)         │
                          │   /        → frontend:80   │
                          │   /api     → gateway:8080  │
                          │   /auth    → gateway:8080  │
                          └──────┬───────────────┬─────┘
                                 │               │
                  / (static)     │               │ /api , /auth
                                 ▼               ▼
                   ┌──────────────────┐   ┌──────────────────────────┐
                   │ frontend         │   │ gateway (:8080)          │
                   │ nginx + dist     │   │ http-proxy-middleware    │
                   │ (SPA, port 80)   │   └───────┬─────────┬────────┘
                   └──────────────────┘           │         │
                            /api/gameplan ────────┘         │
                            /api/*  ──────┐    /auth/*  ─────┘
                                          │         │
                  ┌───────────────────────┼─────────┼──────────────────────┐
                  ▼                        ▼         ▼                      
        ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
        │ ai-service       │   │ team-service     │   │ auth-service     │
        │ (:3002)          │   │ (:3001)          │   │ (:3003)          │
        │ Anthropic gameplan│  │ NBA2K proxy+cache│   │ JWT login / me   │
        └────────┬─────────┘   └────────┬─────────┘   └──────────────────┘
                 │                       │
                 ▼                       ▼
        Anthropic API           api.nba2kapi.com
        (claude-opus-4-8)       (X-API-Key injected)
```

Request flow: **Ingress → gateway → service**. The gateway is the single entry
point for `/api` and `/auth`; it reverse-proxies to the right backend. The
frontend is a separate nginx container serving the static SPA build.

## Services

| Service        | Port (default) | Responsibility |
|----------------|----------------|----------------|
| `gateway`      | 8080           | API gateway / reverse proxy. Routes `/api/gameplan` → ai-service, `/api/*` → team-service, `/auth/*` → auth-service. Does not serve static files. |
| `team-service` | 3001           | Proxies `api.nba2kapi.com`, injecting the `X-API-Key` header server-side. In-memory cache with 1-hour TTL keyed by full path + query. |
| `ai-service`   | 3002           | `POST /api/gameplan` — builds the 2K coaching prompt and calls Anthropic (`claude-opus-4-8`, `max_tokens` 2000). Returns `{gamePlan}` or `{error}`. |
| `auth-service` | 3003           | Demo auth. `POST /auth/login` returns a 7-day JWT; `GET /auth/me` verifies the Bearer token. |
| `frontend`     | 80             | nginx serving the Vite `dist/` build with SPA fallback. |

Every service exposes `GET /healthz` → `200 {status:'ok'}` and allows CORS from
all origins.

### Routes

**team-service** (path + query forwarded to `https://api.nba2kapi.com`):
- `GET /api/teams`
- `GET /api/teams/:name/roster`
- `GET /api/players/slug/:slug`
- Implemented generically as `GET /api/*`.

**ai-service**:
- `POST /api/gameplan` — body fields: `myTeam`, `opponentTeam`, `attackTargets`,
  `hideTargets`, `leaveOpen`, `speedAdvantage`, `bestMatchups`, `myKeyPlayers`,
  `oppKeyPlayers`, `opponentStrategy`. `myTeam`/`opponentTeam` required (400 if
  missing).

**auth-service**:
- `POST /auth/login` `{email, password}` → `{token, user:{email, name}}` or 401.
- `GET /auth/me` with `Authorization: Bearer <token>` → `{user:{email, name}}` or 401.

## Environment variables

| Service        | Variable           | Default                  | Purpose |
|----------------|--------------------|--------------------------|---------|
| team-service   | `PORT`             | `3001`                   | Listen port |
| team-service   | `NBA2K_API_KEY`    | _(none)_                 | Injected as `X-API-Key` to upstream |
| ai-service     | `PORT`             | `3002`                   | Listen port |
| ai-service     | `ANTHROPIC_API_KEY`| _(none)_                 | Anthropic SDK auth |
| auth-service   | `PORT`             | `3003`                   | Listen port |
| auth-service   | `DEMO_EMAIL`       | `scout@2kscout.app`      | Valid login email |
| auth-service   | `DEMO_PASSWORD`    | `scout2k`                | Valid login password |
| auth-service   | `JWT_SECRET`       | `dev-secret-change-me`   | JWT signing secret |
| gateway        | `PORT`             | `8080`                   | Listen port |
| gateway        | `AI_SERVICE_URL`   | `http://ai-service:3002` | ai-service base URL |
| gateway        | `TEAM_SERVICE_URL` | `http://team-service:3001`| team-service base URL |
| gateway        | `AUTH_SERVICE_URL` | `http://auth-service:3003`| auth-service base URL |

## Building images locally

Backend services (run from the repo root):

```sh
docker build -t 2k-scout-team-service ./services/team-service
docker build -t 2k-scout-ai-service   ./services/ai-service
docker build -t 2k-scout-auth-service ./services/auth-service
docker build -t 2k-scout-gateway      ./services/gateway
```

Frontend (multi-stage build using the root Dockerfile):

```sh
docker build -t 2k-scout-frontend -f Dockerfile.frontend .
```

## Running a service locally (without Docker)

```sh
cd services/<name>
npm install
PORT=3001 NBA2K_API_KEY=... node index.js
```

## Deploying to Kubernetes

Manifests live in `k8s/` (plain YAML, no Helm). Images are pulled from
`ghcr.io/cthomastl/2k-scout-<name>:latest`, built and pushed by CI.

```sh
# 1. Namespace
kubectl apply -f k8s/namespace.yaml

# 2. Secrets — copy the template, fill in real values, apply out-of-band.
#    Do NOT commit the filled-in file.
cp k8s/secrets.example.yaml k8s/secrets.yaml   # edit values
kubectl apply -f k8s/secrets.yaml

# 3. Everything else (deployments, services, ingress)
kubectl apply -f k8s/
```

`kubectl apply -f k8s/` is idempotent and applies every manifest in the
directory. The ingress routes host `2kscout.local`; add it to `/etc/hosts`
pointing at your ingress controller's external IP for local testing.

## CI/CD

`.github/workflows/ci-cd.yml` runs on push to `main` and `claude/**`, and on
manual dispatch:

1. **lint-build** — `npm ci` + `npm run build` to catch frontend build errors.
2. **build-and-push** (needs lint-build) — matrix over the five images, logs in
   to GHCR with the workflow token, and builds/pushes each with `latest` and the
   commit SHA tags. The frontend uses `Dockerfile.frontend` with the repo root as
   context; the others use `services/<name>` as context.
