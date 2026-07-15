#!/usr/bin/env bash
# Installs Loki (single-process, filesystem storage) and a Fluent Bit
# DaemonSet that tails every 2k-scout pod's stdout logs and ships them in
# — the log-forwarder pattern most companies actually use, rather than
# instrumenting each service with a vendor SDK directly. Logs show up
# inside Grafana's Explore view (same Grafana as k8s/setup-monitoring.sh),
# no separate login or port-forward needed once both are installed.

set -euo pipefail

kubectl apply -f k8s/logging/namespace.yaml
kubectl apply -f k8s/logging/fluent-bit-rbac.yaml
kubectl apply -f k8s/logging/fluent-bit-configmap.yaml
kubectl apply -f k8s/logging/loki.yaml

echo "Waiting for Loki to become ready..."
kubectl wait --namespace logging \
  --for=condition=available deployment/loki \
  --timeout=120s

# Applied after Loki is ready so Fluent Bit isn't retrying against an
# endpoint that doesn't exist yet.
kubectl apply -f k8s/logging/fluent-bit-daemonset.yaml

# Only wired into Grafana if the monitoring stack is already installed —
# this ConfigMap lives in the `logging` namespace, which is fine (the
# sidecar's searchNamespace=ALL finds it either way), but Grafana itself
# has to exist first for the sidecar to be running at all.
if kubectl get deployment -n monitoring kube-prometheus-stack-grafana >/dev/null 2>&1; then
  kubectl apply -f k8s/logging/grafana-loki-datasource.yaml
  echo "Loki datasource applied — Grafana's sidecar will pick it up within ~30s."
else
  echo "Note: monitoring stack not found yet (k8s/setup-monitoring.sh) —" >&2
  echo "run that first, then: kubectl apply -f k8s/logging/grafana-loki-datasource.yaml" >&2
fi

cat <<'EOF'

Logging stack ready. Next steps:

  kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
  open http://localhost:3000

In Grafana: Explore -> select the "Loki" datasource -> run
  {job="fluent-bit"}
over "Last 15 minutes" to confirm log events are arriving (the INPUT
above already only tails 2k-scout containers, so there's no separate
namespace label to filter on). Narrow to one service with:
  {job="fluent-bit"} | json | kubernetes_container_name="gateway"
If nothing shows up, check the forwarder:

  kubectl logs -n logging daemonset/fluent-bit --tail=50
EOF
