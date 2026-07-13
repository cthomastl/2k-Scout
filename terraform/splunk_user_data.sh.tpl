#!/usr/bin/env bash
# Boots the Splunk log sink: installs Docker, fetches its two secrets from
# SSM, and runs splunk/splunk with HTTP Event Collector (HEC) enabled.
set -euxo pipefail
exec > >(tee -a /var/log/user-data.log) 2>&1

dnf install -y docker
systemctl enable --now docker

mkdir -p /opt/splunk-data
# UID 41812 is the image's built-in "splunk" user — see the --user flag
# below.
chown -R 41812:41812 /opt/splunk-data

ssm_get() {
  aws ssm get-parameter --name "${ssm_prefix}/$1" --with-decryption \
    --region "${aws_region}" --query Parameter.Value --output text
}

SPLUNK_PASSWORD=$(ssm_get SPLUNK_PASSWORD)
SPLUNK_HEC_TOKEN=$(ssm_get SPLUNK_HEC_TOKEN)

# --user 41812:41812 runs as the image's built-in non-root "splunk" user
# instead of root. This is Splunk's own documented Kubernetes guidance
# (also confirmed working when this same image was debugged running under
# Kubernetes/containerd for this project's earlier deployment) — cheap
# insurance against a known sudo/PAM failure some container runtimes hit
# during the image's first-boot internal Ansible setup when run as root.
#
# SPLUNK_HEC_TOKEN being set auto-provisions a HEC input using this exact
# token on first boot — no manual setup in the web UI needed before the app
# tier can start sending logs.
docker run -d --name splunk --restart unless-stopped \
  --user 41812:41812 \
  -p 8000:8000 -p 8088:8088 \
  -e SPLUNK_START_ARGS=--accept-license \
  -e SPLUNK_GENERAL_TERMS=--accept-sgt-current-at-splunk-com \
  -e SPLUNK_PASSWORD="$SPLUNK_PASSWORD" \
  -e SPLUNK_HEC_TOKEN="$SPLUNK_HEC_TOKEN" \
  -v /opt/splunk-data:/opt/splunk/var \
  splunk/splunk:latest
