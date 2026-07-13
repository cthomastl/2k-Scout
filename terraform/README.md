# 2K Scout — traditional 3-tier AWS deployment

Replaces the Kubernetes deployment with three independently scaling layers:

```
                    ┌─────────────────────┐
  Browser ────────▶ │  CloudFront (CDN)    │
                    │  ┌────────────────┐  │
                    │  │ default: S3    │──┼──▶ S3 (built React/Vite SPA)
                    │  │ /api/*, /auth/*│──┼──▶ ALB ──▶ ASG (EC2, private subnets)
                    │  └────────────────┘  │         gateway/team-service/
                    └─────────────────────┘         ai-service/auth-service
                                                            │        │
                                                            ▼        ▼ (Docker splunk
                                                     RDS Postgres     log driver)
                                                     (private)   Splunk EC2 (private)
```

- **UI layer** — S3 (private, no public access) + CloudFront (Origin Access
  Control). CloudFront also owns routing: `/api/*` and `/auth/*` go to the
  ALB, everything else is the SPA — the frontend keeps using relative
  `fetch('/api/...')` calls exactly as it did behind the Kubernetes ingress,
  no code changes needed.
- **App server layer** — `gateway`, `team-service`, `ai-service`,
  `auth-service` run as Docker containers (via `docker compose`, pulling the
  same GHCR images the CI pipeline already builds) on EC2 instances in a
  private-subnet Auto Scaling Group, behind an internet-facing ALB whose
  security group only accepts traffic from CloudFront's IP ranges. The ASG
  has a CPU target-tracking scaling policy (default target: 50%).
- **Database layer** — RDS Postgres, private subnets, not publicly
  accessible, master password generated and rotated by AWS (never touches
  this repo, tfvars, or Terraform state as plaintext).
- **Logging** — a single self-hosted Splunk EC2 instance (`splunk.tf`), private
  subnet, HEC (HTTP Event Collector) reachable only from the app tier's
  security group. Every app-tier container ships its logs there directly via
  Docker's native `splunk` logging driver — no separate Fluent-Bit-style
  forwarder daemon needed on EC2 the way it was on Kubernetes.

**Redis/ElastiCache was deliberately dropped**, not just left out — every
service already treats Redis as a soft dependency (non-blocking connect,
falls back to "always cache-miss" on any Redis error), so removing it costs
nothing but cache-hit performance, not correctness. Add ElastiCache back
later by pointing `REDIS_URL` at it in `user_data.sh.tpl` — no app code
changes required either way.

**Not included in this pass**: the Prometheus/Grafana/Alertmanager stack and
the SLO/burn-rate alerting that existed in the Kubernetes deployment were
cluster-native (`kube-prometheus-stack`, `ServiceMonitor`, `PrometheusRule`)
and don't carry over to EC2 as-is. Equivalent metrics here would mean
CloudWatch alarms/dashboards, or standing up Prometheus+Grafana on their own
EC2 instance — worth doing as a deliberate follow-up. Logs are covered (see
below); metrics/dashboards/SLOs are not, yet.

## Prerequisites

- Terraform >= 1.5
- AWS CLI, configured with credentials that can create VPC/EC2/RDS/S3/
  CloudFront/IAM resources
- The five service images already published to GHCR (the existing
  `.github/workflows/ci-cd.yml` does this on every push to `main`)

## 1. Create the app secrets

Terraform never sees or stores these — it only grants the app tier IAM
permission to read them at boot. Create them yourself first:

```bash
aws ssm put-parameter --name /2k-scout/JWT_SECRET \
  --type SecureString --value "$(openssl rand -hex 32)"

aws ssm put-parameter --name /2k-scout/ANTHROPIC_API_KEY \
  --type SecureString --value "sk-ant-..."

aws ssm put-parameter --name /2k-scout/NBA2K_API_KEY \
  --type SecureString --value "..."

aws ssm put-parameter --name /2k-scout/DEMO_PASSWORD \
  --type SecureString --value "scout2k"

aws ssm put-parameter --name /2k-scout/SPLUNK_PASSWORD \
  --type SecureString --value "$(openssl rand -base64 24)"

# Any value works — this is the token the Splunk container auto-provisions
# a HEC input with on first boot, and what the app tier's docker-compose
# logging driver authenticates to it with. A random one is fine; nothing
# else needs to guess it.
aws ssm put-parameter --name /2k-scout/SPLUNK_HEC_TOKEN \
  --type SecureString --value "$(uuidgen)"
```

`--type SecureString` encrypts the value with the account's default `aws/ssm`
KMS key at rest — that's what `iam.tf`'s `DecryptWithDefaultSsmKey` statement
is for. If you change `ssm_secrets_prefix` in `terraform.tfvars`, use that
prefix here too.

## 2. Provision the infrastructure

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

Takes a few minutes — RDS and CloudFront are the slow parts. Note the
outputs afterward (`terraform output`), especially `app_url`,
`frontend_bucket_name`, and `cloudfront_distribution_id`.

## 3. Build and deploy the frontend

```bash
npm run build
aws s3 sync dist/ "s3://$(terraform -chdir=terraform output -raw frontend_bucket_name)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=terraform output -raw cloudfront_distribution_id)" \
  --paths "/*"
```

The invalidation is necessary — without it, CloudFront keeps serving the
previously cached `index.html`/JS bundle for up to the cache policy's TTL
even after S3 has the new files.

Open `terraform output -raw app_url`. First load can take a minute or two
past `terraform apply` finishing — the ASG's instances are still running
`user_data.sh.tpl` (installing Docker, pulling images, fetching secrets)
in the background.

## Redeploying after a backend change

Since `user_data.sh.tpl` always pulls `image_tag` (default `latest`) fresh
on boot, a redeploy is just replacing the running instances:

```bash
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name "$(terraform -chdir=terraform output -raw asg_name)"
```

This replaces instances one at a time (50% minimum healthy, per `asg.tf`),
pulling the newest image on each new instance — no downtime if at least 2
instances are running.

## Debugging an instance

No SSH keys, no bastion host — instances have no public IP. Use SSM Session
Manager instead (the instance role already has
`AmazonSSMManagedInstanceCore` attached):

```bash
aws ssm start-session --target <instance-id>
```

Once in: `cat /var/log/user-data.log` for the boot script's output, or
`docker compose -f /opt/2k-scout/docker-compose.yml logs` for the running
containers.

## Viewing logs (Splunk)

Every app-tier container ships its stdout/stderr straight to Splunk via
Docker's native `splunk` logging driver — no forwarder agent, no DaemonSet
equivalent, it's configured per-container in `user_data.sh.tpl`'s
`docker-compose.yml` and starts working the moment a container starts.

The Splunk instance has no public IP and no inbound port open for its web
UI (only HEC, port 8088, and only from the app tier) — reach it the same
SSM way as an app-tier instance, but with port forwarding since you need an
actual browser connection this time, not a shell:

```bash
aws ssm start-session \
  --target "$(terraform -chdir=terraform output -raw splunk_instance_id)" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8000"],"localPortNumber":["8000"]}'
```

Then open `https://localhost:8000` (self-signed cert — click through the
browser warning), log in as `admin` / your `SPLUNK_PASSWORD`, and in
**Search & Reporting** run `index=main` over the last 15 minutes to confirm
logs are arriving. The `tag: "{{.Name}}"` logging option means each
container's own name shows up as a searchable field — e.g.
`index=main source::*ai-service*` isolates one service.

First boot is genuinely slow (a couple of minutes) for the same reason it
was on the Kubernetes deployment — Splunk's own first-run initialization,
not anything specific to EC2. `splunk-verify-connection: "false"` in the
logging driver options means app-tier containers start immediately
regardless — they don't wait on Splunk being ready, they just buffer and
retry log delivery until it is.

## Cost note

Unlike the local `kind`/`k3d` Kubernetes path, this deployment has an
hourly cost even sitting idle — mainly the NAT gateway (~$0.045/hr +
data processing), the ALB (~$0.025/hr + LCU usage), 2+ `t3.small` app
instances, and one `t3.medium` for Splunk. RDS `db.t3.micro` and
CloudFront/S3 are cheap at this traffic level. Run `terraform destroy`
when you're done experimenting with it.

## Tearing down

```bash
terraform destroy
```

`skip_final_snapshot = true` on the RDS instance means this is not
recoverable — there's no snapshot left behind. That's an intentional
tradeoff for a portfolio project (snapshots cost money to retain and this
isn't data you need back); flip it in `rds.tf` before destroying if that
ever stops being true.
