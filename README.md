# 2K Scout

NBA 2K scouting tool that analyzes matchups between two All-Time teams and generates an
AI-powered game plan based purely on 2K attribute ratings. Runs as a traditional 3-tier
AWS application — a static UI layer, an autoscaling app server layer, and a managed
database layer — behind a login, with a light/dark dashboard UI.

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
                    ┌─────────────────────┐
  Browser ────────▶ │  CloudFront (CDN)    │
                    │  ┌────────────────┐  │
                    │  │ default: S3    │──┼──▶ S3 (built React/Vite SPA)      UI layer
                    │  │ /api/*, /auth/*│──┼──▶ ALB ──▶ ASG (EC2, 2-4x)        App server layer
                    │  └────────────────┘  │         gateway/team-service/
                    └─────────────────────┘         ai-service/auth-service
                                                            │           │
                                                            ▼           ▼
                                                     RDS Postgres   Anthropic Claude
                                                     (private)      Database layer
```

Three independently scaling layers instead of a single Kubernetes cluster:

- **UI layer** — the built SPA in a private S3 bucket, served through CloudFront.
  CloudFront also owns routing: `/api/*` and `/auth/*` go to the app tier, everything
  else is the SPA — same job an ingress controller would do, no frontend code changes.
- **App server layer** — `gateway`, `team-service`, `ai-service`, `auth-service` run
  as Docker containers on EC2 instances in a private-subnet Auto Scaling Group, behind
  an ALB, scaling on CPU utilization.
- **Database layer** — RDS Postgres, private subnets only, master password
  generated and rotated by AWS rather than stored anywhere in this repo.

Full infrastructure-as-code and deploy steps: [`terraform/README.md`](terraform/README.md).

| Service | Port | Responsibility |
|---|---|---|
| `gateway` | 8080 | Routes `/api/*` and `/auth/*` to the right service (path-preserving) |
| `team-service` | 3001 | Proxies nba2kapi; injects the API key server-side |
| `ai-service` | 3002 | Generates the AI game plan via the Anthropic SDK; saves history/usage to Postgres |
| `auth-service` | 3003 | Real accounts + JWT login, backed by Postgres |

See [`services/README.md`](services/README.md) for per-service detail and the request flow.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite, CSS-variable theming (light default + dark toggle), inline SVG icons |
| Services | Node.js (ESM) + Express |
| Data | RDS Postgres (accounts, history, usage) |
| AI model | Anthropic Claude (`claude-opus-4-8`) |
| Player data | nba2kapi.com |
| Containers | Docker (one image per service), run via `docker compose` on the app-tier EC2 instances |
| Infrastructure | Terraform — VPC, ALB, Auto Scaling Group, RDS, S3, CloudFront (see `terraform/`) |
| CI/CD | GitHub Actions → GitHub Container Registry (GHCR) |

## Local development

```bash
cp .env.example .env   # add your NBA 2K API key
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `https://api.nba2kapi.com`. The AI game plan uses
`VITE_LAMBDA_URL` when set; otherwise the app posts to `/api/gameplan` (the deployed path,
routed by CloudFront to the app tier). Login works against `/auth/login`, and falls back to
a built-in demo credential when no auth service is reachable:

```
scout@2kscout.app / scout2k
```

## Deployment (AWS)

Provisioned entirely with Terraform — VPC, ALB, Auto Scaling Group, RDS, S3, and
CloudFront. Full steps (creating app secrets, `terraform apply`, building and syncing the
frontend to S3, invalidating CloudFront, redeploying the app tier after a backend change,
debugging an instance via SSM instead of SSH) are in
[`terraform/README.md`](terraform/README.md) — worth reading before running anything,
since a couple of steps (creating SSM parameters, syncing the frontend build) happen
outside `terraform apply` itself.

Build the service images locally the same way CI does, if you want to test one without
waiting on a push:

```bash
docker build -t 2k-scout-gateway       services/gateway
docker build -t 2k-scout-team-service  services/team-service
docker build -t 2k-scout-ai-service    services/ai-service
docker build -t 2k-scout-auth-service  services/auth-service
```

### Observability

Not yet built out for this architecture. `gateway`, `team-service`, `ai-service`, and
`auth-service` still each expose Prometheus-format metrics at `/metrics` via
`prom-client`, but nothing in `terraform/` currently scrapes or visualizes them — that
was cluster-native (`kube-prometheus-stack`) in an earlier, Kubernetes-based version of
this deployment and doesn't carry over to EC2 as-is. The natural equivalents here would
be CloudWatch alarms/dashboards, or a small self-hosted Prometheus + Grafana instance;
worth treating as a deliberate follow-up rather than assuming it's covered.

## CI/CD

`.github/workflows/ci-cd.yml` runs on pushes to `main` and `claude/**`:

1. **lint-build** — installs deps and runs `npm run build` to catch frontend errors.
2. **build-and-push** — a matrix job that builds all five images and pushes them to
   `ghcr.io/<owner>/2k-scout-<service>` tagged with both `latest` and the commit SHA.
