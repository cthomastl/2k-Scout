# 2K Scout
Link: https://steep-breeze-2336.christech556.workers.dev/

NBA 2K scouting tool that analyzes matchups between two All-Time teams and generates an
AI-powered game plan based purely on 2K attribute ratings. Runs as a set of containerized
microservices on Kubernetes, behind a login, with a light/dark dashboard UI.

## What it does

Sign in, pick any two teams, and 2K Scout computes — across each team's **rotation (top 8 by
overall)**, with on-court assignments still scoped to the starting five:

- **Attack Offensively** — opponent's weakest defenders to ISO
- **Hide Defensively** — your weakest perimeter defenders paired with their worst shooters
- **Leave Open** — opponent perimeter players safe to sag off (3PT < 80)
- **Speed Advantage** — your players with a real speed edge over their positional matchup
- **Best Matchups** — your best starting-five defender for each of their top 5 (position-aware,
  stretch bigs handled correctly, no defender assigned twice)
- **Best Defenders** — your best lockdown perimeter defenders and best paint defenders across the
  full roster, including bench specialists
- **Pick-and-Roll Coverage** — Drop / Hedge / Switch recommendations for your bigs against the
  opponent's top ball-handler, reasoned from rim protection, mobility, and pull-up/pass threat
- **Their Game Plan** — the mirror image of your scouting report: who they'll attack on your
  roster, which of their weak defenders to hunt, who they'll leave open on your team, and their
  speed advantages over you
- **Clutch Players** — highest Shot IQ + Offensive Consistency
- **Lineups** — Best Overall, Best Defensive, Best 3PT (all positionally balanced)
- **Team Rankings** — every All-Time team ranked across Speed, Perimeter D, Interior D, 3PT, Rebounding
- **AI Game Plan** — full offensive/defensive scouting report from Claude, incorporating pick-and-roll
  coverage and the opponent's likely game plan against you, reasoning strictly from 2K stats and badges

## Architecture
<img width="3840" height="2160" alt="Architecture Diagram-selection (1)" src="https://github.com/user-attachments/assets/526cce96-c151-4bfa-abde-7b5bd090dd75" />



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

All backend calls (`/api/*`, `/auth/*`, gameplan history) go through a single configurable
base: `VITE_API_BASE` (empty by default, meaning same-origin/relative — matches the Vite proxy
above and the in-cluster ingress). Set it to an absolute URL when the frontend is deployed
separately from the backend — see "Split deployment" below.

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

## Split deployment (static UI + single-host backend)

Kubernetes isn't required — the backend also runs as a plain `docker compose` stack on a
single host (e.g. an EC2 instance), with the static frontend built separately and hosted
anywhere that serves static files (e.g. Cloudflare Pages). This is a two-origin setup: the UI
and the backend are on different hosts, so the UI needs to be told where the backend lives.

```
Browser
  │  HTTPS
  ▼
Static UI host (e.g. Cloudflare Pages)        VITE_API_BASE baked in at build time
  │
  │  fetch(`${VITE_API_BASE}/api/...`)  — cross-origin HTTPS
  ▼
Backend host (e.g. EC2) — docker compose stack
  ┌─────────────────────────────┐
  │ gateway :8080 (published)   │
  │  ├─ /api/gameplan* ─▶ ai-service   (internal only)
  │  ├─ /api/*        ─▶ team-service (internal only)
  │  └─ /auth/*       ─▶ auth-service (internal only)
  └─────────────────────────────┘
```

**Backend — run the four services with `docker-compose.yml`** (repo root; no `frontend`
service is defined, so this never builds the UI):

```bash
cp .env.example .env   # fill in NBA2K_API_KEY, ANTHROPIC_API_KEY, JWT_SECRET
docker compose up -d --build
```

Only `gateway` publishes a port (`8080`) to the host — `team-service`, `ai-service`, and
`auth-service` are reachable only from `gateway`, inside the compose network, the same way
they're ClusterIP-only in the Kubernetes setup.

**Exposing the backend over HTTPS.** A static UI host serves the frontend over HTTPS, so the
backend origin must also be HTTPS or browsers will block the requests as mixed content. If the
backend host isn't already behind TLS, a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
is the fastest way to get one without managing a cert or opening inbound firewall ports —
`cloudflared` makes an outbound-only connection to Cloudflare's edge:

```bash
cloudflared tunnel --protocol http2 --url http://localhost:8080
```

(`--protocol http2` avoids relying on outbound UDP/QUIC, which is blocked by default in some
VPC/security-group setups.) A free "quick tunnel" prints a random `https://*.trycloudflare.com`
URL and needs no Cloudflare account changes, but that URL changes every time `cloudflared`
restarts — fine for testing, not for a stable production setup. A named tunnel on a domain you
control in Cloudflare gives a permanent hostname instead.

**Frontend — point the build at the backend's HTTPS URL.** `VITE_API_BASE` is read at build
time, so set it wherever the static UI is built (e.g. Cloudflare Pages → Settings → Build →
environment variables), then trigger a rebuild:

```
VITE_API_BASE=https://<your-tunnel-or-domain>
```

Two things that trip people up here:
- **`.env` has two lookalike variables** — `NBA2K_API_KEY` (bare, read by `docker-compose.yml`)
  and `VITE_NBA2K_API_KEY` (read by the Vite build). They hold the same underlying key but are
  read by different processes; both need to be filled in if you ever build the frontend on the
  same host that runs the backend.
- **Env vars only take effect on (re)build/(re)create**, not by editing `.env` alone — after
  changing backend secrets, run `docker compose up -d --force-recreate`; after changing
  `VITE_API_BASE`, trigger a new frontend build/deploy.

## CI/CD

`.github/workflows/ci-cd.yml` runs on pushes to `main` and `claude/**`:

1. **lint-build** — installs deps and runs `npm run build` to catch frontend errors.
2. **build-and-push** — a matrix job that builds all five images and pushes them to
   `ghcr.io/<owner>/2k-scout-<service>` tagged with both `latest` and the commit SHA.

## Observability & SRE

Each backend service emits request/error/latency metrics (CloudWatch Embedded Metric
Format) and ships logs to CloudWatch; alarms page a Discord channel on the golden signals
(error rate, latency, saturation) for both the services and the EC2 host. See
[`observability/README.md`](observability/README.md) for the CloudFormation stack and
deploy steps, and [`docs/SRE.md`](docs/SRE.md) for the SLIs/SLOs/SLA these alarms are built
around, plus incident runbooks.
