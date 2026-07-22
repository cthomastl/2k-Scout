# 2K Scout — SRE Handbook

SLIs, SLOs, an SLA, alerting philosophy, and runbooks for the backend running on EC2 via
`docker compose` (`gateway`, `team-service`, `ai-service`, `auth-service` — see the root
README's "Split deployment" section and [`services/README.md`](../services/README.md) for
the architecture). Pairs with [`observability/`](../observability/), which is the actual
CloudFormation stack and instrumentation this document's numbers are built around.

This is a single-operator hobby-scale service, not an enterprise on-call rotation — but the
practices below are written the way they'd be written for a real one, because that's the only
version of this document that's actually useful when something breaks at 2am.

## Service map

```
Browser → (Cloudflare Pages, static UI)
Browser → (Cloudflare Tunnel) → EC2 → gateway :8080
                                         ├── /api/gameplan* → ai-service   → Anthropic API
                                         ├── /api/*         → team-service → api.nba2kapi.com
                                         └── /auth/*        → auth-service (JWT, no external dep)
```

Single points of failure worth naming honestly, since they directly shape the SLOs below:
- **One EC2 instance.** No auto-scaling group, no failover host. If it goes down, everything
  goes down until someone (you) notices and restarts it.
- **One Cloudflare Tunnel process.** If `cloudflared` dies, the site is unreachable even if
  every container is healthy — this has already happened once during setup (QUIC egress
  blocked; see git history) and is worth remembering as a real failure mode, not a hypothetical.
- **Two upstream dependencies with no fallback**: `api.nba2kapi.com` (team-service) and the
  Anthropic API (ai-service). Neither has a circuit breaker or cached fallback today — an
  upstream outage becomes *your* error rate.

## SLI / SLO / SLA / error budget — quick definitions

- **SLI (Service Level Indicator)**: a number you actually measure. "% of requests that
  returned non-5xx in the last 5 minutes."
- **SLO (Service Level Objective)**: the internal target for that number. "99.5% of requests
  non-5xx, measured monthly." SLOs are promises to yourself/your team, set *tighter* than the
  SLA so you have room to notice and fix things before you breach a customer-facing promise.
- **SLA (Service Level Agreement)**: the external promise, usually with a consequence attached
  (a refund, a credit, a support-tier obligation). If you have no paying customers, you have no
  real SLA — the "SLA" section below is written as if this were a real product, so the shape
  of one is on record, not because 2K Scout currently owes anyone a refund.
- **Error budget**: `1 − SLO`, converted into a time or request allowance. It's the amount of
  "being broken" you're allowed before you've spent the whole budget for the period. The point
  of an error budget isn't to hit 100% — it's to give you an explicit, pre-agreed answer to
  "can we ship this risky change today?" (Yes, if there's budget left. No, if there isn't.)

## SLIs

All of these are already emitted as CloudWatch metrics by every service (namespace `2kScout`,
dimensioned by `Service`) — see `services/*/metrics.js`.

| SLI | Definition | Metric |
|---|---|---|
| Availability | `1 - (ServerErrorCount / RequestCount)` over the window | `ServerErrorCount`, `RequestCount` (Sum) |
| Latency | p99 request duration | `Latency` (ExtendedStatistic `p99`) |
| Saturation | EC2 CPU / memory / disk utilization | `AWS/EC2:CPUUtilization`, `2kScout/Host:mem_used_percent`, `2kScout/Host:disk_used_percent` |

Health-check traffic (`GET /healthz`) is explicitly excluded from all three — it's synthetic,
not real user demand, and would quietly inflate availability/dilute latency if counted.

## SLOs

| Service | Availability SLO | Latency SLO | Window |
|---|---|---|---|
| `gateway` | 99.5% | p99 < 1000ms | Rolling 30 days |
| `team-service` | 99.0%* | p99 < 1000ms | Rolling 30 days |
| `ai-service` | 99.0%* | p99 < 8000ms** | Rolling 30 days |
| `auth-service` | 99.5% | p99 < 500ms | Rolling 30 days |

\* Lower than `gateway`/`auth-service` on purpose — `team-service` and `ai-service` each
depend on one external API with no fallback, so their achievable ceiling is bounded by
someone else's availability, not just this codebase.
\*\* Claude generation is a genuinely slow operation (multi-second by nature); alarming at
the same 1000ms bar as everything else would either be permanently tripped or force the
threshold so high it's useless. Set the real number from your own p99 history once you have
a few weeks of data — 8000ms is a starting guess, not a measurement.

**Why 99.5%, not 99.9% or 99.99%**: those numbers only mean something with redundancy behind
them. A single EC2 instance with no failover has a hard ceiling on what it can honestly
promise — quoting 99.99% (≈4 minutes/month) on hardware you might personally reboot for a
kernel update would be fiction. 99.5% (~3.6 hours/month) is a number this architecture can
actually hit and that a person can hold themselves to.

**Error budget at 99.5%/month**: `30 days × 24h × 60min × 0.5% ≈ 216 minutes/month`
(~3.6 hours). Track spend informally: if a bad deploy eats 90 of those 216 minutes, you've
used ~42% of the month's budget on one incident — that's a real signal to slow down on risky
changes for the rest of the month, not just a number to log and forget.

**Error budget policy**: if the trailing-30-day budget is exhausted (or negative), treat that
as a hard stop on non-essential changes — no new features, no dependency bumps "while I'm in
there," until the SLI is back under the line for a few consecutive days. Bug fixes and
reliability work are always allowed; they're what's supposed to happen during a budget
freeze.

## SLA (hypothetical — written for the record, not currently owed to anyone)

If 2K Scout had paying users, a defensible SLA sits *below* the SLOs above, since the SLA is
what you're contractually exposed to and the SLO is your own early-warning line:

| Metric | SLA | Consequence on breach |
|---|---|---|
| Monthly availability (gateway) | 99.0% | Service credit, next billing cycle |
| p99 latency (gateway) | < 2000ms | N/A (typically not a refundable SLA term on its own) |
| Scheduled maintenance | Excluded, given ≥ 24h notice | — |

The gap between the 99.5% SLO and the 99.0% SLA is deliberate slack — it's the buffer that
lets you catch and fix a problem before it becomes a broken promise to someone else.

## Alerting philosophy

The alarms in `observability/alerting-stack.yaml` are straightforward threshold alarms (error
rate over X%, p99 over Yms, sustained over 2-of-3 five-minute periods to avoid single-blip
noise) — deliberately simple for a v1 on a single-operator project. The more rigorous version
of this, once there's real traffic history to tune against, is **multi-window multi-burn-rate
alerting** (the pattern from the Google SRE Workbook): page on a *fast* burn (e.g. consuming
2% of the monthly budget in 1 hour) AND a *slow* burn (5% in 6 hours) as two separate
conditions, so a brief spike doesn't page you at 3am but a real sustained degradation does,
faster than waiting for a slow-window average to catch up. Worth migrating to once you have
enough traffic for the math to be meaningful — not before; burn-rate alerting on near-zero
traffic just produces noise from small-sample-size swings.

Every alarm fires on both entering **and leaving** `ALARM` (`AlarmActions` and `OKActions`
both point at the same SNS topic) — recovery is worth knowing about too, not just failure.

Every alarm uses `TreatMissingData: notBreaching`. This matters specifically because you may
deliberately stop the EC2 instance to control cost (see "Cost & turning it off" below) — with
any other setting, a clean, intentional shutdown looks identical to a crash and pages you for
no reason.

## Alarm inventory

| Alarm | Alarms on | Runbook |
|---|---|---|
| `2k-scout-gateway-error-rate` | Gateway 5xx rate | [High Error Rate](#runbook-high-error-rate) |
| `2k-scout-gateway-latency-p99` | Gateway p99 latency | [High Latency](#runbook-high-latency) |
| `2k-scout-team-service-error-rate` | team-service 5xx rate | [High Error Rate](#runbook-high-error-rate) |
| `2k-scout-team-service-latency-p99` | team-service p99 latency | [High Latency](#runbook-high-latency) |
| `2k-scout-ai-service-error-rate` | ai-service 5xx rate | [High Error Rate](#runbook-high-error-rate) |
| `2k-scout-ai-service-latency-p99` | ai-service p99 latency | [High Latency](#runbook-high-latency) |
| `2k-scout-auth-service-error-rate` | auth-service 5xx rate | [High Error Rate](#runbook-high-error-rate) |
| `2k-scout-auth-service-latency-p99` | auth-service p99 latency | [High Latency](#runbook-high-latency) |
| `2k-scout-ec2-cpu-high` | EC2 CPU > 80% | [High Saturation](#runbook-high-saturation) |
| `2k-scout-ec2-memory-high` | EC2 memory > 85% | [High Saturation](#runbook-high-saturation) |
| `2k-scout-ec2-disk-high` | EC2 disk > 85% | [Disk Full](#runbook-disk-full) |
| `2k-scout-ec2-status-check-failed` | EC2 instance/system check | [Instance Down](#runbook-instance-down) |

Not covered by a CloudWatch alarm (real gaps, not oversights — noted so they don't get
mistaken for "handled"): the Cloudflare Tunnel process dying, and TLS/cert issues on any
custom domain in front of it. See their runbooks below for how to actually notice these.

---

## Runbooks

### Runbook: High Error Rate

**Triggered by**: `*-error-rate` alarms (5xx / total > threshold, sustained).

1. Check the Discord alert for which service fired — that narrows it to one of four.
2. `docker compose ps` on the EC2 box — is the container actually `Up (healthy)`, or
   restarting/exited?
   - If restarting/exited: `docker compose logs --tail=200 <service>` for the crash reason,
     jump to [Container Restart Loop](#runbook-container-restart-loop).
3. If the container is healthy but still erroring, check *which* dependency is involved:
   - **`team-service`**: 5xx here is very often `api.nba2kapi.com` being down or rate-limiting.
     `curl -i https://api.nba2kapi.com` directly from the box. If upstream is the problem,
     there is currently no fallback/cache-only mode — this is a known gap (see Service map).
     Post a status update if you have users depending on it; there's nothing to "fix" on your
     side beyond waiting or adding a stale-cache fallback as follow-up work.
   - **`ai-service`**: check for Anthropic API errors/rate limits in
     `docker compose logs ai-service`. A 429 means you're rate-limited — check usage against
     your Anthropic plan's limits.
   - **`auth-service`**: has no external dependency — a 5xx here is almost certainly an actual
     bug (bad JWT_SECRET, unhandled exception). Read the actual stack trace in the logs before
     guessing.
   - **`gateway`**: 5xx directly from the gateway (not proxied through) usually means one of
     the three upstream service URLs (`AI_SERVICE_URL`/`TEAM_SERVICE_URL`/`AUTH_SERVICE_URL`)
     is unreachable — check `docker compose ps` again, and that all four containers are on the
     same compose network.
4. Once root-caused and fixed, confirm the alarm clears (`OK` posted to Discord) rather than
   assuming — a fix that doesn't actually reduce the error rate should re-trigger within one
   evaluation period.

### Runbook: High Latency

**Triggered by**: `*-latency-p99` alarms.

1. Same service-identification step as above from the Discord message.
2. Check EC2 saturation first — a slow *everything* usually means the host itself is
   under CPU/memory pressure, not a code-level slowdown in one service. If saturation alarms
   are also firing, treat this as a symptom and go to
   [High Saturation](#runbook-high-saturation) instead.
3. If saturation is normal and only one service is slow:
   - **`ai-service`**: verify this isn't just normal Claude generation latency before treating
     it as an incident — re-check the SLO table's note on this service's threshold being a
     starting guess. Compare against recent history in the dashboard, not just the one alarm.
   - **`team-service`**: likely `api.nba2kapi.com` itself being slow, not this app — the
     in-memory cache (1h TTL) means only cache-miss requests hit upstream at all; a cold cache
     after a restart will show a temporary latency bump that should self-resolve.
   - **`gateway`**/**`auth-service`**: no external dependency for auth, minimal logic in
     gateway — a sustained latency alarm on either is more likely event-loop blocking or
     resource starvation than a "slow query" style problem; check `docker stats` for the
     container's own CPU.

### Runbook: High Saturation

**Triggered by**: `2k-scout-ec2-cpu-high`, `2k-scout-ec2-memory-high`.

1. `ssh` into the box, run `docker stats` — identify which container is actually consuming the
   resource. Four small Node/Express processes plus the CloudWatch Agent and `cloudflared`
   should not be CPU/memory-heavy under normal load; a spike usually means either a real
   traffic surge or a runaway process (infinite loop, memory leak).
2. If it's a genuine traffic surge and the instance is undersized for it: this architecture
   has no auto-scaling — the only lever is manually resizing the EC2 instance type
   (`aws ec2 modify-instance-attribute`, requires a stop/start), which is a deliberate,
   visible action to take, not an automated response.
3. If it's a runaway single container: `docker compose restart <service>` as the immediate
   mitigation, then read logs from *before* the restart (`docker compose logs` retains recent
   history) to find what triggered it before it happens again.

### Runbook: Disk Full

**Triggered by**: `2k-scout-ec2-disk-high`.

1. `df -h` on the box to confirm and see which mount is actually full.
2. Most likely culprit on this setup: Docker build cache and old images accumulating from
   repeated `docker compose up -d --build` runs. Clean with:
   ```bash
   docker system prune -af --volumes
   ```
   (safe here since there's no persistent application data in Docker volumes — team-service's
   cache is in-memory, not on disk).
3. Second most likely: CloudWatch Logs Agent or Docker's own JSON log driver retaining old
   log data locally before shipping — check `/var/log` and Docker's log directory
   (`/var/lib/docker/containers/*/`) if the above doesn't free enough space.
4. Longer-term fix if this recurs: set a log rotation policy at the Docker daemon level
   (`/etc/docker/daemon.json`, `"log-opts": {"max-size": "10m", "max-file": "3"}`) in addition
   to the `awslogs` driver already shipping logs offbox.

### Runbook: Instance Down

**Triggered by**: `2k-scout-ec2-status-check-failed`.

1. This is a hardware/hypervisor-level failure signal, not an application bug — don't start
   by looking at container logs.
2. Check the AWS Console → EC2 → Instances → Status Checks tab for which check failed
   (`Instance` vs `System`). A `System` check failure is on AWS's side (host-level issue); the
   standard fix is **stop and start the instance** (not reboot — stop/start moves it to new
   underlying hardware, a plain reboot does not).
3. An `Instance` check failure is more likely something on your side (kernel panic, full disk
   preventing boot processes). Check the EC2 System Log (`Actions → Monitor and troubleshoot →
   Get system log` in the console) before doing anything destructive.
4. If you *intentionally* stopped the instance for cost control, this alarm should not have
   fired at all (`TreatMissingData: notBreaching`) — if it did anyway, that's itself worth
   investigating as a monitoring bug, not just dismissing.

### Runbook: Cloudflare Tunnel Down

**Not covered by a CloudWatch alarm** — this is a real gap, worth knowing rather than
assuming it's handled. Symptom: the site is unreachable from outside, but `docker compose ps`
on the box shows every container healthy.

1. `ps aux | grep cloudflared` — is the process even running?
2. `tail -100 ~/cloudflared.log` (or wherever its output is redirected) — look for repeated
   `Retrying connection` / `Failed to dial` errors. If you see QUIC/UDP timeout errors
   specifically, that's the exact failure mode already hit once during initial setup — the
   fix was forcing HTTP/2 transport instead of QUIC:
   ```bash
   cloudflared tunnel --protocol http2 --url http://localhost:8080
   ```
3. If using a Quick Tunnel (ephemeral `trycloudflare.com` URL), remember the hostname changes
   on every restart — after restarting `cloudflared`, you must also update `VITE_API_BASE` in
   the frontend's build settings and redeploy, or the frontend will be calling a dead URL even
   though the tunnel itself is healthy again. This is the single biggest argument for
   migrating to a named tunnel on a real domain before this becomes a recurring fire drill.

### Runbook: Container Restart Loop

**Symptom**: `docker compose ps` shows a service cycling through `Restarting`/`Exited` instead
of settling into `Up (healthy)`.

1. `docker compose logs --tail=200 <service>` — the crash reason is almost always visible in
   the last few lines before each restart.
2. Common causes specific to this codebase:
   - Missing/blank required env var (`NBA2K_API_KEY`, `ANTHROPIC_API_KEY`, `JWT_SECRET`) —
     check `.env` actually has real values and that you ran
     `docker compose up -d --force-recreate` *after* editing it (editing `.env` alone doesn't
     touch already-running containers).
   - A bad image from a broken build — `docker compose build <service>` on its own first to
     isolate a build failure from a runtime failure.
3. Once fixed, confirm with `docker compose ps` that the service reaches `Up (healthy)` and
   stays there for a few HEALTHCHECK intervals (30s each, per each service's Dockerfile)
   before considering it resolved.

---

## On-call & escalation

Realistically: one person, no rotation. Written this way anyway because it's the honest
default a rotation gets built on top of later, not because it's currently needed:

- **Primary**: whoever owns the Discord webhook receives every alert in real time.
- **Escalation**: none configured. If you want a real escalation path later (e.g. "page a
  phone if unacknowledged after 15 minutes"), that requires a tool built for it
  (PagerDuty/Opsgenie) — Discord has no acknowledgment or escalation concept on its own.
- **Business hours vs. off-hours**: no distinction is made today — every alarm pages
  immediately, any time. Worth revisiting once there's a real user base: not every alarm
  (e.g. a slow-burn latency SLO warning) needs to wake someone up at 3am; only fast-burn,
  user-impacting alarms should.

## Postmortem template

Use this for anything that breached an SLO, not just things that paged — a slow-burn issue
that quietly ate half the month's error budget deserves the same rigor as a loud outage.

```markdown
# Postmortem: <short title>

**Date**: <when it happened, not when it was written>
**Duration**: <start> – <end> (<total time>)
**Impact**: <what broke, for whom, measured against which SLO>
**Error budget consumed**: <minutes, and % of the monthly budget>

## Timeline
- HH:MM — <what happened / was noticed / was done>
- ...

## Root cause
<the actual technical cause — "what" and "why," not just "what we did to fix it">

## Resolution
<what actually stopped the bleeding>

## What went well
<detection speed, runbook accuracy, etc — say what worked, not just what didn't>

## What went poorly
<gaps in monitoring, a runbook that was wrong, a slow response — be specific>

## Action items
| Action | Owner | Due |
|---|---|---|
| ... | ... | ... |
```

Blameless by default: the goal is fixing the system that allowed the failure, not identifying
who to blame for it — true even at team-of-one scale, since "past you" and "future you" are
different enough people under deadline pressure that the same discipline applies.

## Cost & turning it off

CloudWatch's cost splits into usage-based (metrics, log ingestion — stops automatically when
nothing is running) and flat-fee (alarms, ~$0.10/alarm/month, billed for existing regardless
of state). Stopping the EC2 instance handles the former automatically. To also stop the
per-alarm fee during a long idle stretch, delete the whole stack in one command —
`aws cloudformation delete-stack --stack-name 2k-scout-observability` — and redeploy later
from the same template. See [`observability/README.md`](../observability/README.md) for the
full deploy/teardown commands.
