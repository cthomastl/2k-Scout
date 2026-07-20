// Backend Prometheus metrics can't see what happens purely in the browser —
// an uncaught render error or a slow-to-load page never touches any
// backend endpoint. This reports both to gateway's /api/client-metrics,
// which exposes them as frontend_js_errors_total and
// frontend_time_to_interactive_seconds.
//
// Fire-and-forget by design: sendBeacon (falling back to a keepalive
// fetch) so a slow or failed report never blocks the UI, and failures here
// are swallowed rather than surfaced — reporting an error should never
// itself become a second error.
function report(body) {
  const payload = JSON.stringify(body)
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      navigator.sendBeacon('/api/client-metrics', blob)
      return
    }
  } catch {
    // fall through to fetch
  }
  fetch('/api/client-metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {})
}

export function initErrorReporting() {
  window.addEventListener('error', event => {
    report({ type: 'js_error', message: event.message })
  })
  window.addEventListener('unhandledrejection', event => {
    report({ type: 'js_error', message: String(event.reason) })
  })
}

// Approximates time-to-interactive as navigation start -> first app render,
// not the strict web-vitals TTI (which accounts for long tasks settling
// after paint). Good enough to catch "the app got a lot slower to show up,"
// which is the thing actually worth alerting on here.
export function reportTimeToInteractive() {
  const value = performance.now() / 1000
  report({ type: 'tti', value })
}
