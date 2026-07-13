#!/usr/bin/env bash
# Boots one app-tier instance: installs Docker, pulls the four backend
# service images from GHCR, fetches secrets it never bakes into the AMI or
# launch template, and brings the stack up. Runs once per instance launch —
# re-running this (e.g. via an ASG instance refresh) is how a redeploy works,
# since it always pulls "${image_tag}" fresh.
set -euxo pipefail
exec > >(tee -a /var/log/user-data.log) 2>&1

dnf install -y docker jq
systemctl enable --now docker

# AL2023's dnf repos don't carry the Compose v2 CLI plugin — install the
# binary directly, the method Docker's own docs recommend for this case.
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/2k-scout
cd /opt/2k-scout

# --- Secrets: fetched at boot, never written into the launch template ------
DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "${db_secret_arn}" --region "${aws_region}" \
  --query SecretString --output text | jq -r .password)

ssm_get() {
  aws ssm get-parameter --name "${ssm_prefix}/$1" --with-decryption \
    --region "${aws_region}" --query Parameter.Value --output text
}

JWT_SECRET=$(ssm_get JWT_SECRET)
ANTHROPIC_API_KEY=$(ssm_get ANTHROPIC_API_KEY)
NBA2K_API_KEY=$(ssm_get NBA2K_API_KEY)
DEMO_PASSWORD=$(ssm_get DEMO_PASSWORD)
SPLUNK_HEC_TOKEN=$(ssm_get SPLUNK_HEC_TOKEN)

cat > /opt/2k-scout/.env <<ENV
DATABASE_URL=postgresql://${db_username}:$${DB_PASSWORD}@${db_endpoint}:${db_port}/${db_name}
JWT_SECRET=$${JWT_SECRET}
ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY}
NBA2K_API_KEY=$${NBA2K_API_KEY}
DEMO_EMAIL=${demo_email}
DEMO_PASSWORD=$${DEMO_PASSWORD}
SPLUNK_HEC_TOKEN=$${SPLUNK_HEC_TOKEN}
ENV
chmod 600 /opt/2k-scout/.env

# No Postgres/Redis containers here — Postgres is RDS (see rds.tf), and
# Redis was dropped from this architecture (see terraform/README.md). Every
# service already tolerates a missing REDIS_URL by falling back to
# always-cache-miss behavior, so nothing here needs to change to add
# ElastiCache back later if that tradeoff stops being worth it.
cat > /opt/2k-scout/docker-compose.yml <<'COMPOSE'
# splunk-verify-connection: "false" is deliberate — without it, Docker
# checks HEC connectivity when a container *starts* and refuses to start
# the container at all if Splunk isn't reachable yet. Logging should never
# be a hard dependency that can take down the app tier; with this off, a
# container starts regardless and Docker buffers/retries log delivery in
# the background. splunk-insecureskipverify is needed because Splunk's HEC
# uses a self-signed cert by default (same one the web UI warns about).
x-splunk-logging: &splunk-logging
  driver: splunk
  options:
    splunk-url: "${splunk_hec_url}"
    splunk-token: "$${SPLUNK_HEC_TOKEN}"
    splunk-index: "main"
    splunk-insecureskipverify: "true"
    splunk-verify-connection: "false"
    tag: "{{.Name}}"

services:
  team-service:
    image: ghcr.io/${ghcr_owner}/2k-scout-team-service:${image_tag}
    restart: unless-stopped
    logging: *splunk-logging
    environment:
      NBA2K_API_KEY: $${NBA2K_API_KEY}

  ai-service:
    image: ghcr.io/${ghcr_owner}/2k-scout-ai-service:${image_tag}
    restart: unless-stopped
    logging: *splunk-logging
    environment:
      ANTHROPIC_API_KEY: $${ANTHROPIC_API_KEY}
      JWT_SECRET: $${JWT_SECRET}
      DATABASE_URL: $${DATABASE_URL}

  auth-service:
    image: ghcr.io/${ghcr_owner}/2k-scout-auth-service:${image_tag}
    restart: unless-stopped
    logging: *splunk-logging
    environment:
      JWT_SECRET: $${JWT_SECRET}
      DEMO_EMAIL: $${DEMO_EMAIL}
      DEMO_PASSWORD: $${DEMO_PASSWORD}
      DATABASE_URL: $${DATABASE_URL}

  gateway:
    image: ghcr.io/${ghcr_owner}/2k-scout-gateway:${image_tag}
    restart: unless-stopped
    logging: *splunk-logging
    ports:
      - "8080:8080"
    environment:
      AI_SERVICE_URL: http://ai-service:3002
      TEAM_SERVICE_URL: http://team-service:3001
      AUTH_SERVICE_URL: http://auth-service:3003
    depends_on:
      - ai-service
      - team-service
      - auth-service
COMPOSE

cd /opt/2k-scout
docker compose --env-file .env pull
docker compose --env-file .env up -d
