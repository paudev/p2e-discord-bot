export async function sendDiscord(item) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channel = process.env.DISCORD_CHANNEL_ID;
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook && (!token || !/^\d{15,25}$/.test(channel || ''))) {
    throw new Error('Set DISCORD_WEBHOOK_URL, or both DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID.');
  }
  const safe = (value, limit) => String(value || '').replaceAll('@', '@\u200b').slice(0, limit);
  const payload = {
    embeds: [{
      title: safe(item.title, 230),
      url: item.url,
      description: safe(item.description, 900),
      color: 0x4f7cff,
      fields: [
        { name: 'Event date', value: safe(item.eventDate || 'Not announced', 40), inline: true },
        { name: 'Status', value: safe(item.status, 150), inline: false },
        { name: 'Source', value: safe(item.sourceName, 100), inline: true },
        ...(item.evidence ? [{ name: 'Event date evidence', value: safe(item.evidence, 240), inline: false }] : []),
        { name: 'Date basis', value: item.yearInferred
          ? 'Month/day stated; year inferred from recent article publication'
          : (item.estimated ? 'Estimated by listing publisher' : 'Date explicitly stated in source'),
          inline: false },
        ...(item.publishedAt ? [{ name: 'Article published', value: safe(item.publishedAt, 40), inline: true }] : [])
      ],
      footer: { text: 'CryptoPH Discovery • Not an endorsement or earning guarantee' },
      timestamp: new Date(item.date).toISOString()
    }],
    allowed_mentions: { parse: [] }
  };
  let endpoint = `https://discord.com/api/v10/channels/${channel}/messages`;
  if (webhook) {
    const parsed = new URL(webhook);
    if (parsed.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(parsed.hostname) ||
        !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+$/.test(parsed.pathname)) {
      throw new Error('DISCORD_WEBHOOK_URL must be a Discord HTTPS webhook URL.');
    }
    parsed.searchParams.set('wait', 'true');
    endpoint = parsed.href;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: webhook ? { 'Content-Type': 'application/json' } : { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000)
    });
    if (response.ok) return (await response.json()).id;
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const wait = Math.min(4500, Math.max(600, Number(body.retry_after || 1) * 1000));
      await new Promise(resolve => setTimeout(resolve, wait));
      continue;
    }
    throw new Error(`Discord HTTP ${response.status}: ${(await response.text()).slice(0, 150)}`);
  }
  throw new Error('Discord rate limited this scan.');
}
