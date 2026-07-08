# 2K Scout

NBA 2K scouting tool that analyzes matchups between two All-Time teams and generates an
AI-powered game plan based purely on 2K attribute ratings. Runs as a set of containerized
microservices on Kubernetes, behind a login, with a light/dark dashboard UI.

## What it does

Sign in (or create an account), pick any two teams, and 2K Scout computes — for the
**starting five only**:

- **Attack Offensively** — opponent's weakest starting defenders to ISO
- **Hide Defensively** — your weakest perimeter defenders paired with their worst shooters
- **Leave Open** — opponent perimeter starters safe to sag off (3PT < 80)
- **Speed Advantage** — your players with a real speed edge over their positional matchup
- **Best Matchups** — your best available defender for each of their top 5 (position-aware,
  stretch bigs handled correctly, no defender assigned twice)
- **Clutch Players** — highest Shot IQ + Offensive Consistency
- **Lineups** — Closing, Pace & Space, Sharpshooters (positionally balanced), Lockdown, Twin Towers
- **Team Rankings** — every All-Time team ranked across Speed, Perimeter D, Interior D, 3PT, Rebounding
- **AI Game Plan** — full offensive/defensive scouting report from Claude, reasoning strictly from 2K stats
- **History** — every generated game plan is saved to your account and revisitable later,
  instead of being regenerated (and re-billed) from scratch each time

## Architecture

```
                          ┌───────────────────────────────────────────┐
                          │          Kubernetes (ns: 2k-scout)         │
                          │                                           │
   Browser ──▶ Ingress ──▶│  frontend  (nginx + SPA)                  │
              (host:      │     │                                     │
              2kscout     │     ▼  /api, /auth                        │
              .local)     │  gateway  (reverse proxy)                 │
                          │     ├── /api/gameplan ─▶ ai-service ──────── Anthropic Claude
                          │     ├── /api/*        ─▶ team-service      │
                          │     └── /auth/*       ─▶ auth-service      │
                          │                                           │
                          │   auth-service, ai-service ──▶ Postgres   │
                          │   team-service, ai-service ──▶ Redis      │
                          └───────────────────────────────────────────┘
```

Five independently deployable app services, each with its own image, health check, and
horizontal scaling — plus a Postgres and Redis pod backing the stateful pieces:

| Service | Port | Responsibility |
|---|---|---|
| `frontend` | 80 | nginx serving the React/Vite SPA |
| `gateway` | 8080 | Routes `/api/*` and `/auth/*` to the right service (path-preserving) |
| `team-service` | 3001 | Proxies + caches (Redis) nba2kapi; injects the API key server-side |
| `ai-service` | 3002 | Generates the AI game plan via the Anthropic SDK; caches by matchup (Redis) and saves history/usage (Postgres) |
| `auth-service` | 3003 | Real accounts + JWT login, backed by Postgres |
| `postgres` | 5432 | Accounts, game plan history, usage tracking (see [Data & caching](#data--caching)) |
| `redis` | 6379 | Shared cache for `team-service` and `ai-service` |

See [`services/README.md`](services/README.md) for per-service detail and the request flow.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite, CSS-variable theming (light default + dark toggle), inline SVG icons |
| Services | Node.js (ESM) + Express |
| Data | Postgres (accounts, history, usage) + Redis (nba2kapi/gameplan cache) |
| AI model | Anthropic Claude (`claude-opus-4-8`) |
| Player data | nba2kapi.com |
| Containers | Docker (one image per service) |
| Orchestration | Kubernetes (Deployments, Services, Ingress, Secret) |
| Observability | Prometheus + Grafana + Alertmanager (`kube-prometheus-stack`) |
| CI/CD | GitHub Actions → GitHub Container Registry (GHCR) |

## Local development

```bash
cp .env.example .env   # add your NBA 2K API key
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `https://api.nba2kapi.com`. The AI game plan uses
`VITE_LAMBDA_URL` when set; otherwise the app posts to `/api/gameplan` (the Kubernetes path).
Login works against `/auth/login`, and falls back to a built-in demo credential when no
auth service is reachable:

```
scout@2kscout.app / scout2k
```

## Containers & Kubernetes

Build the service images locally:

```bash
docker build -t 2k-scout-frontend     -f Dockerfile.frontend .
docker build -t 2k-scout-gateway       services/gateway
docker build -t 2k-scout-team-service  services/team-service
docker build -t 2k-scout-ai-service    services/ai-service
docker build -t 2k-scout-auth-service  services/auth-service
```

Deploy to a cluster:

```bash
kubectl apply -f k8s/namespace.yaml
# Fill in real values first — do NOT commit real secrets:
cp k8s/secrets.example.yaml k8s/secrets.yaml && kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/
```

Applying `namespace.yaml` first matters: `kubectl apply -f k8s/` applies files in
alphabetical order, and several service manifests sort before `namespace.yaml` —
skipping this step gets you `namespaces "2k-scout" not found` errors on a brand
new cluster.

### Data & caching

`k8s/postgres.yaml` and `k8s/redis.yaml` deploy a single-replica Postgres and
Redis into the `2k-scout` namespace alongside the app — both are picked up by
the same `kubectl apply -f k8s/` above, nothing extra to run.

- **Postgres** backs real user accounts (`auth-service`), saved game plan
  history and usage tracking (`ai-service`). `auth-service` creates its
  `users` table (and seeds the demo account) on startup; `ai-service` creates
  `gameplans` and `usage_events` the same way — no separate migration step.
- **Redis** caches `team-service`'s nba2kapi.com responses (shared across
  replicas now, instead of each pod keeping its own separate in-memory cache)
  and `ai-service`'s generated game plans (keyed by team matchup, 6h TTL) —
  a repeat matchup returns instantly instead of re-calling Claude.
- `secrets.example.yaml` includes `POSTGRES_PASSWORD`, `DATABASE_URL`, and
  `REDIS_URL`. The defaults point at the in-cluster Postgres/Redis above; swap
  `DATABASE_URL` for an RDS endpoint (or your own local Postgres) later
  without any code changes — both services just read the connection string.

### Local cluster with k3d (k3s)

No cluster handy? `k8s/setup-k3d.sh` spins up a local k3s cluster via
[k3d](https://k3d.io), disables the default Traefik ingress (the manifests
here use `ingressClassName: nginx`), and installs ingress-nginx in its place:

```bash
./k8s/setup-k3d.sh
```

Then follow the printed steps to apply the namespace, secrets, and manifests.
[k9s](https://k9scli.io) is a handy terminal UI for watching pods/logs across
the five services once deployed.

Add `2kscout.local` to your hosts file (pointing at the ingress IP) to reach the app.

### Local cluster with kind

Prefer [kind](https://kind.sigs.k8s.io) (Kubernetes-in-Docker)? `k8s/setup-kind.sh`
creates a cluster from `k8s/kind-config.yaml` (host ports 80/443 mapped in) and
installs the kind-flavored ingress-nginx manifest:

```bash
./k8s/setup-kind.sh
```

Then follow the printed steps, same as the k3d flow above.

## Observability

`gateway`, `team-service`, `ai-service`, and `auth-service` each expose Prometheus
metrics at `/metrics` via `prom-client` (default Node.js process metrics plus an
`http_request_duration_seconds` histogram labeled by method/route/status code).
`frontend` is a static nginx SPA and isn't instrumented.

Install `kube-prometheus-stack` (Prometheus + Grafana + Alertmanager) and the
`ServiceMonitor`s that wire it up to the four services:

```bash
./k8s/setup-monitoring.sh
```

Then:

```bash
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
```

Open `http://localhost:3000` (`admin` / `admin`) and check **Status > Targets**
in Prometheus (`kubectl port-forward svc/kube-prometheus-stack-prometheus -n
monitoring 9090:9090`) to confirm all four services show as `up`.

A starter dashboard ("2K Scout - Service Overview") is auto-provisioned via
`k8s/monitoring/dashboards-configmap.yaml` (Grafana's sidecar picks up any
ConfigMap labeled `grafana_dashboard: "1"`). It covers the four golden
signals for each service: services up, request rate, 5xx error rate, and
p95 latency, plus pod restarts in the `2k-scout` namespace.

A second dashboard ("2K Scout - AI Cost & Quality",
`k8s/monitoring/ai-dashboard-configmap.yaml`) covers what the golden signals
above can't see: `ai-service` returning `200 OK` doesn't mean the Claude call
was cheap, fast, or even complete. It tracks:

- **Estimated spend** — token counts × illustrative per-token pricing
  (`ai_tokens_total`, `ai_estimated_cost_usd_total` — see the pricing
  constants in `services/ai-service/index.js` if the model or its price changes)
- **Cache hit rate** — how often a repeat matchup avoids a Claude call entirely
- **Truncated responses** — `stop_reason=max_tokens` means the user got a cut-off
  answer while the request still returned `200 OK`; a normal error-rate panel
  would never catch this
- **Claude call latency**, isolated from the rest of the request (DB writes,
  cache checks) via a dedicated `anthropic_request_duration_seconds` histogram
- **Errors by category** (`ai_errors_total{type=...}`) — rate-limited vs.
  overloaded vs. an auth problem vs. our own bug all need different responses,
  and a generic 5xx count can't tell them apart

### Centralized logging (Splunk)

Metrics answer "is something wrong"; logs answer "what exactly happened."
`k8s/logging/` deploys a single-instance Splunk (HTTP Event Collector
enabled) plus a Fluent Bit `DaemonSet` that tails every `2k-scout` pod's
stdout and ships it in — the log-forwarder pattern most companies actually
use, rather than instrumenting each service with a vendor SDK directly.

```bash
cp k8s/logging/secrets.example.yaml k8s/logging/secrets.yaml   # fill in real values
./k8s/setup-logging.sh
```

Splunk's first boot is genuinely slow (a couple of minutes) — the script
waits for it before starting the forwarder, so nothing tries to ship logs
to a HEC endpoint that isn't up yet.

```bash
kubectl port-forward svc/splunk -n logging 8000:8000
```

Open `https://localhost:8000` (self-signed cert — click through the browser
warning), log in as `admin` / your `SPLUNK_PASSWORD`, and in **Search &
Reporting** run `index=main` over the last 15 minutes to confirm logs are
arriving. If nothing shows up, `kubectl logs -n logging daemonset/fluent-bit`
is the first place to look.

## CI/CD

`.github/workflows/ci-cd.yml` runs on pushes to `main` and `claude/**`:

1. **lint-build** — installs deps and runs `npm run build` to catch frontend errors.
2. **build-and-push** — a matrix job that builds all five images and pushes them to
   `ghcr.io/<owner>/2k-scout-<service>` tagged with both `latest` and the commit SHA.
