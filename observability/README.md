# Observability

CloudWatch-native monitoring and alerting for the backend running on EC2 via `docker
compose` (see the root README's "Split deployment" section). Everything here is
infrastructure-as-code — nothing is deployed automatically; you run these steps yourself
against your own AWS account. See [`docs/SRE.md`](../docs/SRE.md) for the SLIs/SLOs these
alarms are built around and the runbooks to follow when one fires.

## What this sets up

- **Metrics**: each service (`gateway`, `team-service`, `ai-service`, `auth-service`) emits
  `RequestCount`, `Latency`, `ServerErrorCount`, and `ClientErrorCount` (namespace `2kScout`,
  dimensioned by `Service`) using [CloudWatch Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html) —
  see `services/*/metrics.js`. No AWS SDK calls or credentials inside the app; it just writes
  a structured JSON line to stdout on every response.
- **Log shipping**: `docker-compose.yml` ships each service's stdout to CloudWatch Logs via
  Docker's built-in `awslogs` logging driver, which is what turns those EMF log lines into
  real, queryable, alarmable CloudWatch metrics.
- **Host metrics**: the CloudWatch Agent (installed directly on the EC2 host, not in a
  container) publishes CPU/memory/disk to the `2kScout/Host` namespace — EC2 doesn't report
  memory or disk by default.
- **Alarms + dashboard + Discord alerts**: `alerting-stack.yaml` is a single CloudFormation
  stack — an SNS topic, a Lambda that forwards alarm state changes to a Discord webhook, 12
  alarms across the four services' error rate/latency and the EC2 instance's CPU/memory/
  disk/status checks, and one summary dashboard.

## 1. IAM role for the EC2 instance

The `awslogs` Docker logging driver and the CloudWatch Agent both need permission to write
to CloudWatch, sourced from the EC2 instance's own IAM role (not credentials baked into the
box). If the instance doesn't already have a role attached, create one with this trust policy
and attach the `CloudWatchAgentServerPolicy` managed policy (it covers both metrics and logs):

```bash
aws iam create-role --role-name 2k-scout-ec2-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name 2k-scout-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
aws iam create-instance-profile --instance-profile-name 2k-scout-ec2-profile
aws iam add-role-to-instance-profile --instance-profile-name 2k-scout-ec2-profile --role-name 2k-scout-ec2-role
aws ec2 associate-iam-instance-profile --instance-id <your-instance-id> \
  --iam-instance-profile Name=2k-scout-ec2-profile
```

## 2. Install the CloudWatch Agent (host CPU/mem/disk)

On the EC2 box:

```bash
sudo dnf install -y amazon-cloudwatch-agent   # Amazon Linux 2023
sudo cp observability/cloudwatch-agent-config.json /opt/aws/amazon-cloudwatch-agent/etc/config.json
sudo systemctl enable amazon-cloudwatch-agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json
```

## 3. Set `AWS_REGION` for docker compose

Add to `.env` (see `.env.example`):

```
AWS_REGION=us-east-1
```

Then `docker compose up -d --force-recreate` so the services pick up `AWS_EMF_ENVIRONMENT`
and the new logging driver. Confirm logs are arriving:

```bash
aws logs tail /2k-scout/gateway --since 5m
```

## 4. Set up the Discord webhook

In Discord: channel settings → Integrations → Webhooks → New Webhook → copy the URL. Keep it
secret — anyone with the URL can post into that channel.

## 5. Package and upload the notifier Lambda

```bash
cd observability/discord-notifier
zip -r ../discord-notifier.zip .
cd ..
aws s3 mb s3://<a-bucket-you-own>   # skip if you already have one to use
aws s3 cp discord-notifier.zip s3://<a-bucket-you-own>/discord-notifier.zip
```

## 6. Deploy the stack

```bash
aws cloudformation deploy \
  --template-file observability/alerting-stack.yaml \
  --stack-name 2k-scout-observability \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    DiscordWebhookUrl='https://discord.com/api/webhooks/...' \
    LambdaCodeS3Bucket=<a-bucket-you-own> \
    LambdaCodeS3Key=discord-notifier.zip \
    EC2InstanceId=<your-instance-id>
```

`aws cloudformation deploy` is idempotent — re-run it after changing the template or any
parameter (e.g. adjusting `AlarmErrorRateThreshold`) and it updates the existing stack in
place.

**Verify**: trigger a test alarm state change —

```bash
aws cloudwatch set-alarm-state --alarm-name 2k-scout-gateway-latency-p99 \
  --state-value ALARM --state-reason "manual test"
```

You should see it land in Discord within a few seconds. Set it back with `--state-value OK`.

**Dashboard**: the deploy output includes `DashboardUrl`, or go to CloudWatch → Dashboards →
`2k-scout` in the AWS Console you already use for this EC2 instance.

## Turning it off (cost control)

This ties back to the "can I turn CloudWatch off when I'm not using it" question — see
`docs/SRE.md` for the full cost breakdown. Short version:

- **Stopping the EC2 instance** (or just the docker compose stack) already stops the bulk of
  the cost — no new metric data points, no new log ingestion. Existing alarms will sit in
  `INSUFFICIENT_DATA`/`OK` (not `ALARM`, thanks to `TreatMissingData: notBreaching`), so you
  won't get paged just for being idle.
- **To also stop the flat per-alarm fee**, tear down the whole stack in one command:
  ```bash
  aws cloudformation delete-stack --stack-name 2k-scout-observability
  ```
  Re-deploy later with the same `aws cloudformation deploy` command from step 6 — the
  dashboard and every alarm come back exactly as defined in the template.
