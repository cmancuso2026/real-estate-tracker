// Sending to Slack. A channel is reached, in order of preference, by:
//   1. its own incoming webhook (each Slack webhook posts to one channel),
//   2. the Slack bot token (SLACK_BOT_TOKEN, scope chat:write) posting to the
//      channel by name — the bot must be invited to the channel,
//   3. the app's default webhook (SLACK_WEBHOOK_URL), whatever channel that is.

/** Which way a channel would be sent, for the Admin page. */
export function deliveryMethod(channel, env = process.env) {
  if (channel?.webhook_url) return 'webhook';
  if (env.SLACK_BOT_TOKEN) return 'bot';
  if (env.SLACK_WEBHOOK_URL) return 'default_webhook';
  return null;
}

/**
 * Post text to a channel (null = the default). Throws with a readable message.
 * `fetchImpl` / `env` are injectable for tests.
 */
export async function sendSlack(channel, text, { fetchImpl = fetch, env = process.env } = {}) {
  const method = deliveryMethod(channel, env);
  if (!method) throw new Error('No Slack connection: add a webhook URL to this channel, or set SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL.');
  if (method === 'bot') {
    const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
      body: JSON.stringify({ channel: channel.slack_channel || channel.name, text, unfurl_links: false }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      const why = body.error === 'not_in_channel' ? 'the bot isn’t in that channel (invite it with /invite)' : body.error || `HTTP ${res.status}`;
      throw new Error(`Slack: ${why}`);
    }
    return method;
  }
  const url = method === 'webhook' ? channel.webhook_url : env.SLACK_WEBHOOK_URL;
  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return method;
}
