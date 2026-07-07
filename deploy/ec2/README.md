# Single-EC2 deployment

An alternative to `k8s/` for running the whole app as a `docker compose` stack
on one EC2 instance instead of a Kubernetes cluster — same five service
images from GHCR, plus Postgres and Redis as containers on the same box.

`frontend`'s nginx config is overridden at runtime (`nginx-edge.conf`) to do
what the ingress controller does in the Kubernetes deployment: route `/api`
and `/auth` to `gateway`, everything else to the built SPA.

## Running it

Needs a `.env` file in this directory (never commit it — same rule as
`k8s/secrets.yaml`) with:

```
NBA2K_API_KEY=...
ANTHROPIC_API_KEY=...
JWT_SECRET=...
DEMO_EMAIL=scout@2kscout.app
DEMO_PASSWORD=scout2k
POSTGRES_PASSWORD=...
```

Then:

```bash
docker compose up -d
```

This is what the EC2 `user_data` script in a Terraform setup would do on
first boot — see the root README or ask for the `user_data` template if
you're provisioning this via `terraform-aws-modules/ec2-instance/aws`.
