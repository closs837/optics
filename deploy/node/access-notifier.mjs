const COOLDOWN_MS = 15 * 60 * 1000;

export function validateWebhook(value = '') {
  if (typeof value !== 'string' || (value && !/^https:\/\/hooks\.slack(-gov)?\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value)))
    throw new Error('Configure an HTTPS Slack incoming webhook or leave it empty.');
  return value;
}

// Called only after authenticated HTML access succeeds. Notification delivery
// is best effort; webhook failures must never interrupt the application.
export function createAccessNotifier(config, { post = fetch, now = Date.now, warn = console.warn } = {}) {
  const webhook = validateWebhook(config.slack_webhook_url);
  const allowed = new Set(config.allowed_emails.map((email) => email.toLowerCase()));
  const recent = new Map();
  return async function notify(email) {
    if (!webhook || typeof email !== 'string' || !allowed.has(email.toLowerCase())) return;
    const key = email.toLowerCase(), time = now();
    if (recent.has(key) && time - recent.get(key) < COOLDOWN_MS) return;
    recent.set(key, time);
    try {
      const response = await post(webhook, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Optics: authenticated workspace access',
          blocks: [{ type: 'section', text: { type: 'plain_text', text: `Optics workspace accessed\nAccount: ${email}\nSite: ${config.origin}\nTime: ${new Date(time).toISOString()}` } }],
        }),
      });
      if (!response.ok) throw new Error('Delivery failed.');
    } catch {
      // Never log the URL, response body, cookies, credentials or tokens.
      warn('Slack access notification failed.');
    }
  };
}
