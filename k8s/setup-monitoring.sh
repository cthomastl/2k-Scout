#!/usr/bin/env bash
# Installs kube-prometheus-stack (Prometheus + Grafana + Alertmanager) and wires
# it up to scrape the 2K Scout services (gateway, team-service, ai-service,
# auth-service — each exposes /metrics via prom-client).
#
# Requires: a cluster already set up (k8s/setup-k3d.sh or k8s/setup-kind.sh),
# helm, kubectl.

set -euo pipefail

if ! command -v helm >/dev/null; then
  echo "helm not found. Install it: https://helm.sh/docs/intro/install/" >&2
  exit 1
fi

echo "Installing kube-prometheus-stack..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update >/dev/null
helm repo update >/dev/null

# serviceMonitorSelectorNilUsesHelmValues=false: without this, the chart's
# Prometheus only scrapes ServiceMonitors labeled `release: <helm-release>`,
# so our plain ServiceMonitors (labeled just `app: <service>`) would silently
# never get scraped.
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --set grafana.adminPassword=admin \
  --wait

echo "Applying ServiceMonitors for the 2K Scout services..."
kubectl apply -f k8s/monitoring/service-monitors.yaml

cat <<'EOF'

Monitoring stack ready. Next steps:

  # Grafana (dashboards) — admin / admin
  kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
  open http://localhost:3000

  # Prometheus (raw metrics/targets)
  kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090
  open http://localhost:9090

Check Status > Targets in Prometheus to confirm gateway/team-service/ai-service/
auth-service are all "up" before building dashboards.
EOF
