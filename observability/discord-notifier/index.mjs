// SNS -> Discord bridge for CloudWatch Alarms. AWS SNS has no native Discord integration,
// so this Lambda subscribes to the alerts topic, reformats the CloudWatch alarm state-change
// payload as a Discord embed, and posts it to a webhook. Deployed by observability/alerting-stack.yaml.
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

const COLOR_BY_STATE = {
  ALARM: 0xed4245, // Discord red
  OK: 0x57f287, // Discord green
  INSUFFICIENT_DATA: 0xfee75c, // Discord yellow
}

const EMOJI_BY_STATE = {
  ALARM: '\u{1F534}',
  OK: '\u{1F7E2}',
  INSUFFICIENT_DATA: '\u{1F7E1}',
}

export const handler = async event => {
  if (!WEBHOOK_URL) {
    console.error('DISCORD_WEBHOOK_URL is not set — cannot forward alert')
    return
  }

  for (const record of event.Records ?? []) {
    let alarm
    try {
      alarm = JSON.parse(record.Sns.Message)
    } catch (err) {
      console.error('Failed to parse SNS message as a CloudWatch alarm payload:', err, record.Sns?.Message)
      continue
    }

    const state = alarm.NewStateValue ?? 'UNKNOWN'
    const embed = {
      title: `${EMOJI_BY_STATE[state] ?? '\u{26AA}'} ${alarm.AlarmName ?? 'Unknown alarm'}`,
      description: alarm.NewStateReason || alarm.AlarmDescription || 'No description provided.',
      color: COLOR_BY_STATE[state] ?? 0x99aab5,
      fields: [
        { name: 'State', value: `${alarm.OldStateValue ?? '?'} → ${state}`, inline: true },
        { name: 'Region', value: alarm.Region ?? 'unknown', inline: true },
      ],
      timestamp: alarm.StateChangeTime || new Date().toISOString(),
    }

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })

    if (!res.ok) {
      console.error(`Discord webhook returned ${res.status}: ${await res.text()}`)
    }
  }
}
