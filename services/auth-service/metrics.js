import { metricScope } from 'aws-embedded-metrics'

// Emits CloudWatch Embedded Metric Format (EMF) log lines on every response. Docker's
// `awslogs` logging driver (configured in docker-compose.yml) ships stdout straight to
// CloudWatch Logs, which parses EMF automatically into real, alarmable CloudWatch metrics —
// no AWS SDK calls or credentials needed in-process; only the Docker daemon (via the EC2
// instance's IAM role) needs log-write permission. Health checks are excluded since they're
// synthetic traffic, not real user requests, and would dilute the error-rate/latency SLIs.
export function metricsMiddleware(serviceName) {
  return (req, res, next) => {
    if (req.path === '/healthz') return next()
    const startedAt = process.hrtime.bigint()
    res.on('finish', metricScope(metrics => async () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      metrics.setNamespace('2kScout')
      // useDefault=false: replace the library's default dimension set (LogGroup/ServiceName/
      // ServiceType) entirely — CloudWatch Alarms/dashboards here query on the Service
      // dimension alone, and a metric's dimension set has to match exactly what's published.
      metrics.setDimensions({ Service: serviceName }, false)
      metrics.putMetric('RequestCount', 1, 'Count')
      metrics.putMetric('Latency', durationMs, 'Milliseconds')
      metrics.putMetric('ServerErrorCount', res.statusCode >= 500 ? 1 : 0, 'Count')
      metrics.putMetric('ClientErrorCount', res.statusCode >= 400 && res.statusCode < 500 ? 1 : 0, 'Count')
    }))
    next()
  }
}
