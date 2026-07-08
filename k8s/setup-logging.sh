#!/usr/bin/env bash
# Installs a single-instance Splunk (HEC enabled) and a Fluent Bit DaemonSet
# that tails every 2k-scout pod's stdout logs and ships them in — the
# forwarder pattern most real companies actually use, rather than
# instrumenting every service with a vendor SDK directly.

set -euo pipefail

kubectl apply -f k8s/logging/namespace.yaml

if [ ! -f k8s/logging/secrets.yaml ]; then
  echo "k8s/logging/secrets.yaml not found." >&2
  echo "Run: cp k8s/logging/secrets.example.yaml k8s/logging/secrets.yaml" >&2
  echo "Fill in real values, then re-run this script." >&2
  exit 1
fi

kubectl apply -f k8s/logging/secrets.yaml
kubectl apply -f k8s/logging/fluent-bit-rbac.yaml
kubectl apply -f k8s/logging/fluent-bit-configmap.yaml
kubectl apply -f k8s/logging/splunk.yaml

echo "Waiting for Splunk to become ready — first boot commonly takes a couple of minutes..."
kubectl wait --namespace logging \
  --for=condition=ready pod \
  --selector=app=splunk \
  --timeout=300s

# Applied after Splunk is ready so Fluent Bit isn't retrying against a HEC
# endpoint that doesn't exist yet.
kubectl apply -f k8s/logging/fluent-bit-daemonset.yaml

cat <<'EOF'

Logging stack ready. Next steps:

  # Splunk web UI — log in as admin / <your SPLUNK_PASSWORD>
  kubectl port-forward svc/splunk -n logging 8000:8000
  open https://localhost:8000

In Splunk: Search & Reporting app -> run `index=main` over "Last 15 minutes"
to confirm log events are arriving from the 2k-scout namespace. If nothing
shows up, check the forwarder:

  kubectl logs -n logging daemonset/fluent-bit --tail=50
EOF
