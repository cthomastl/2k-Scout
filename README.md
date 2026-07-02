# 2K Scout

NBA 2K scouting tool that analyzes matchups between two All-Time teams and generates an
AI-powered game plan based purely on 2K attribute ratings. Runs as a set of containerized
microservices on Kubernetes, behind a login, with a light/dark dashboard UI.

## What it does

Sign in, pick any two teams, and 2K Scout computes — for the **starting five only**:

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

## Architecture

```
                          ┌─────────────────────────────┐
                          │   Kubernetes (ns: 2k-scout)  │
                          │                              │
   Browser ──▶ Ingress ──▶│  frontend  (nginx + SPA)     │
              (host:      │     │                         │
              2kscout     │     ▼  /api, /auth            │
              .local)     │  gateway  (reverse proxy)     │
                          │     ├── /api/gameplan ─▶ ai-service ──▶ Anthropic Claude
                          │     ├── /api/*        ─▶ team-service ─▶ nba2kapi.com (cached)
                          │     └── /auth/*       ─▶ auth-service (JWT login)
                          └─────────────────────────────┘
```

Five independently deployable services, each with its own image, health check, and
horizontal scaling:

| Service | Port | Responsibility |
|---|---|---|
| `frontend` | 80 | nginx serving the React/Vite SPA |
| `gateway` | 8080 | Routes `/api/*` and `/auth/*` to the right service (path-preserving) |
| `team-service` | 3001 | Proxies + caches nba2kapi; injects the API key server-side |
| `ai-service` | 3002 | Generates the AI game plan via the Anthropic SDK |
| `auth-service` | 3003 | JWT login backing the dashboard sign-in |

See [`services/README.md`](services/README.md) for per-service detail and the request flow.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite, CSS-variable theming (light default + dark toggle), inline SVG icons |
| Services | Node.js (ESM) + Express |
| AI model | Anthropic Claude (`claude-opus-4-8`) |
| Player data | nba2kapi.com |
| Containers | Docker (one image per service) |
| Orchestration | Kubernetes (Deployments, Services, Ingress, Secret) |
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

## CI/CD

`.github/workflows/ci-cd.yml` runs on pushes to `main` and `claude/**`:

1. **lint-build** — installs deps and runs `npm run build` to catch frontend errors.
2. **build-and-push** — a matrix job that builds all five images and pushes them to
   `ghcr.io/<owner>/2k-scout-<service>` tagged with both `latest` and the commit SHA.
