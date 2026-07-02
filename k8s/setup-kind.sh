#!/usr/bin/env bash
# Spin up a local kind (Kubernetes-in-Docker) cluster wired up for 2K Scout.
#
# kind ships no ingress controller at all, so this script creates the cluster
# with host port 80/443 mapped in (via kind-config.yaml) and installs the
# kind-flavored ingress-nginx manifest, matching k8s/ingress.yaml's
# `ingressClassName: nginx`.
#
# Requires: docker, kind (https://kind.sigs.k8s.io), kubectl.

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-2k-scout}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v kind >/dev/null; then
  echo "kind not found. Install it: https://kind.sigs.k8s.io/#installation" >&2
  exit 1
fi

if ! command -v kubectl >/dev/null; then
  echo "kubectl not found. Install it: https://kubernetes.io/docs/tasks/tools/#kubectl" >&2
  exit 1
fi

if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "Cluster '${CLUSTER_NAME}' already exists, skipping creation."
else
  echo "Creating kind cluster '${CLUSTER_NAME}' (port 80/443 mapped)..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${SCRIPT_DIR}/kind-config.yaml"
fi

kubectl config use-context "kind-${CLUSTER_NAME}"

echo "Installing ingress-nginx (kind provider manifest)..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "Waiting for ingress-nginx controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

cat <<'EOF'

Cluster ready. Next steps:

  kubectl apply -f k8s/namespace.yaml
  cp k8s/secrets.example.yaml k8s/secrets.yaml   # fill in real values
  kubectl apply -f k8s/secrets.yaml
  kubectl apply -f k8s/

Then add this to /etc/hosts:
  127.0.0.1 2kscout.local

And open http://2kscout.local
EOF
