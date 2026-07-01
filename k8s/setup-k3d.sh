#!/usr/bin/env bash
# Spin up a local k3d (k3s-in-Docker) cluster wired up for 2K Scout.
#
# k3s ships Traefik as its default ingress controller, but k8s/ingress.yaml
# pins `ingressClassName: nginx`, so this script disables Traefik at cluster
# creation and installs ingress-nginx instead.
#
# Requires: docker, k3d (https://k3d.io), kubectl, helm.
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-2k-scout}"

if ! command -v k3d >/dev/null; then
  echo "k3d not found. Install it: https://k3d.io/#installation" >&2
  exit 1
fi

if k3d cluster list | grep -q "^${CLUSTER_NAME} "; then
  echo "Cluster '${CLUSTER_NAME}' already exists, skipping creation."
else
  echo "Creating k3d cluster '${CLUSTER_NAME}' (Traefik disabled, port 80/443 mapped)..."
  k3d cluster create "${CLUSTER_NAME}" \
    --k3s-arg "--disable=traefik@server:0" \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer"
fi

kubectl config use-context "k3d-${CLUSTER_NAME}"

echo "Installing ingress-nginx..."
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update >/dev/null
helm repo update >/dev/null
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=ClusterIP \
  --wait

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
