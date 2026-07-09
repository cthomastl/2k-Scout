# SLIs, SLOs, and SLA

## The three terms, and why only two of them apply here

**SLI (Service Level Indicator)** — a metric you actually measure. "What fraction
of requests returned a 5xx" is an SLI. 2K Scout already exposes the raw data
for these via `http_request_duration_seconds` (every app service) and
`anthropic_request_duration_seconds` (ai-service's isolated Claude-call timer).

**SLO (Service Level Objective)** — a target for an SLI, over a time window,
that you've committed to internally. "99.5% of requests succeed, measured over
a rolling 30 days" is an SLO. This is the layer that was missing before this
was added: metrics existed, but nothing said what value they were *supposed*
to have, and nothing alerted when they drifted from it.

**SLA (Service Level Agreement)** — an SLO plus an external, usually
contractual, consequence for missing it (a refund, a credit, a penalty). This
project intentionally does **not** have one: an SLA only makes sense when
there's another party you're making a commitment *to*. There's no paying
customer or contract here, so an SLA would be fake decoration — the honest
answer in an interview is "no SLA, because there's no counterparty to agree
one with," not to invent one for completeness. SLOs are the internal
engineering target; SLAs are what a business builds on top of SLOs, usually
looser than the SLO itself (you want SLO headroom before you're contractually
on the hook).

## The SLOs defined for 2K Scout

Implemented in `k8s/monitoring/slo-rules.yaml` as Prometheus recording +
alerting rules, visualized in the **"2K Scout - SLOs & Error Budget"**
Grafana dashboard.

| SLO | Target | Scope | Why scoped this way |
|---|---|---|---|
| **Availability** | 99.5% non-5xx over 30d | `gateway`, `team-service`, `ai-service`, `auth-service` | A 5xx is a 5xx regardless of which service produced it — one SLO across the whole API surface. |
| **Fast-endpoint latency** | 95% under 500ms over 30d | `gateway`, `team-service`, `auth-service` | Deliberately excludes `ai-service`. Its one real endpoint calls Claude, which routinely takes seconds — folding it into a 500ms target would make the SLO permanently red for reasons that have nothing to do with anything being broken. |
| **AI game plan latency** | 95% of Claude calls under 8s over 30d | `ai-service` (Claude call only, via `anthropic_request_duration_seconds`) | A separate, looser SLO for the one endpoint whose latency is dominated by a third-party dependency (Anthropic) rather than our own code. |

Error budget = `1 - target`. For the 99.5% availability SLO, the budget is
0.5% of requests over 30 days — that's the "spend" available before the SLO
is breached.

### Why `anthropic_request_duration_seconds` and not the whole request for AI latency

`ai-service`'s `http_request_duration_seconds` for `/api/gameplan` includes
DB writes, the Redis cache check, and JSON serialization on top of the Claude
call — mixing "is Claude slow" with "is our own code slow" into one number.
The dedicated Claude-call histogram (already instrumented, buckets up to 32s)
isolates the piece we don't control from the piece we do. That's a real SRE
practice: an SLI should measure one thing precisely, not several things
blended together.

## Multi-window, multi-burn-rate alerting

Naive threshold alerting ("page if error rate > 1% for 5 minutes") has a bad
tradeoff: tight enough to catch real incidents fast, and it also pages on
every minor blip; loose enough to avoid noise, and it misses slow-burning
problems until the budget's already gone.

The fix used here (from Google's SRE Workbook) is to alert on **burn rate** —
how many times faster than sustainable the budget is being consumed — checked
across **two windows at once**: a short one (reacts fast) and a long one
(confirms it's not a blip). Both must be breached simultaneously to fire.

For the availability SLO (4 tiers, all implemented):

| Severity | Windows | Burn rate | Budget consumed if sustained | Meaning |
|---|---|---|---|---|
| page | 5m + 1h | 14.4x | 2% in 1 hour | Exhausts the 30-day budget in ~2 days. Wake someone up. |
| page | 30m + 6h | 6x | 5% in 6 hours | Exhausts it in ~5 days. Still page-worthy. |
| ticket | 2h + 1d | 3x | 10% in 1 day | Real, but not urgent — file it, look tomorrow. |
| ticket | 6h + 3d | 1x | 10% in 3 days | Burning right at the rate that empties the budget exactly at day 30 — the "you'll regret ignoring this" tier. |

The fast-endpoint latency SLO uses an abbreviated 2-tier version (page +
ticket only) — not every SLO earns the full 4-tier treatment; save that
rigor for the SLI that would actually justify waking someone up. The AI
latency SLO uses a single window with a `for:` duration instead of a second
confirmation window — low request volume (one person testing) makes a second
window mostly redundant, and a slow Claude call isn't page-worthy the way a
real outage is. Matching alerting rigor to actual stakes is itself a
judgment call an SRE has to make — not everything gets paged.

## How an SRE actually uses this day to day

- **The error budget is a decision-making tool, not just a dashboard number.**
  If the availability SLO is comfortably within budget, that budget is
  spendable — ship the riskier change, do the maintenance window, take the
  deploy. If the budget's nearly exhausted, the standard SRE move is an
  **error budget freeze**: no new feature launches or risky changes until
  reliability work brings it back into the green. This is what separates SRE
  from "ops with dashboards" — it turns reliability into a number that trades
  off against velocity instead of an abstract goal.
- **Burn-rate severity maps to response urgency, not to raw metric value.**
  A `page` alert means "get paged, now" — multi-window confirms it's real
  before anyone's phone buzzes at 2am. A `ticket` alert means "queue it,
  handle it during business hours." Alerting on the SLI value directly
  (rather than a fixed threshold like "5xx rate > 1%") is what makes this
  scale sanely across services with very different normal traffic levels.
- **SLOs decide what to build observability *for*.** The Service Overview
  and AI Cost & Quality dashboards answer "what is happening." This SLO
  dashboard answers "does it matter, and how urgently" — the natural
  escalation path when a `page` alert fires is: check this dashboard's burn
  rate panel first, then drop into Service Overview / AI Cost & Quality to
  find *which* service and *why*.
- **SLOs are how you'd push back on scope, not just measure yourself against
  it.** If a request came in for a stricter availability target than 99.5%,
  the SLO framework makes the cost of that concrete: a tighter budget means
  faster escalation, less tolerance for risky deploys, and — in a team
  setting — an actual conversation about whether the org is willing to
  invest in the reliability work (redundancy, retries, circuit breakers)
  that a tighter number would require.

## Known caveat

The 30-day windows in the SLO definitions above need Prometheus to actually
retain 30 days of data — `setup-monitoring.sh` sets
`prometheus.prometheusSpec.retention=32d` for exactly this reason (the
chart's default is 10d, which would make a `[30d]` query silently compute
over a shorter, wrong window instead of erroring). The dashboard's
"compliance" panels currently read from the 3-day recording rules rather than
a full 30-day one, both to keep the query cheap and because a freshly
installed cluster won't have 30 days of history yet anyway.
