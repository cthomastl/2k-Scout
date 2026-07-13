#!/usr/bin/env bash
# Installs the Dynatrace Operator via Helm and applies a DynaKube CR, which
# the operator uses to roll out OneAgent as a DaemonSet — full-stack host,
# process, and auto-instrumented APM monitoring across every node, reporting
# into an existing Dynatrace SaaS/Managed environment.
#
# Unlike Splunk (k8s/setup-logging.sh), Dynatrace has no self-hostable
# backend, so this only deploys the agent side; you need a real Dynatrace
# environment URL + API token first.
#
# Requires: a cluster already set up (k8s/setup-k3d.sh or k8s/setup-kind.sh),
# helm, kubectl.

set -euo pipefail

if ! command -v helm >/dev/null; then
  echo "helm not found. Install it: https://helm.sh/docs/intro/install/" >&2
  exit 1
fi

kubectl apply -f k8s/dynatrace/namespace.yaml

if [ ! -f k8s/dynatrace/secrets.yaml ]; then
  echo "k8s/dynatrace/secrets.yaml not found." >&2
  echo "Run: cp k8s/dynatrace/secrets.example.yaml k8s/dynatrace/secrets.yaml" >&2
  echo "Fill in your Dynatrace environment's API token(s), then re-run this script." >&2
  exit 1
fi

kubectl apply -f k8s/dynatrace/secrets.yaml

echo "Installing the Dynatrace Operator..."
helm repo add dynatrace https://raw.githubusercontent.com/Dynatrace/dynatrace-operator/main/config/helm/repos/stable --force-update >/dev/null
helm repo update >/dev/null
helm upgrade --install dynatrace-operator dynatrace/dynatrace-operator \
  --namespace dynatrace --create-namespace \
  --set installCRD=true \
  --wait

echo "Applying the DynaKube CR (rolls out OneAgent as a DaemonSet)..."
# apiUrl in k8s/dynatrace/dynakube.yaml still points at the placeholder
# ENVIRONMENTID host until you edit it to match your real Dynatrace tenant.
kubectl apply -f k8s/dynatrace/dynakube.yaml

cat <<'EOF'

Dynatrace agent rollout started. Next steps:

  kubectl -n dynatrace get pods -l app.kubernetes.io/name=oneagent -w

Once OneAgent pods on every node report Running, host, process, and APM
data for the 2k-scout namespace should show up in your Dynatrace
environment within a few minutes (Infrastructure > Hosts, and
Applications & Microservices for auto-instrumented services).
EOF
