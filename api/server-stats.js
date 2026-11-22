import { timingSafeEqual } from 'node:crypto';
import { updateServerStats } from '../src/server-stats.js';

function equalSecrets(received, expected) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = process.env.DISCORD_STATS_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'Trigger secret not configured' });
  if (!equalSecrets(req.headers.authorization || '', `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.DISCORD_STATS_BOT_TOKEN || !process.env.DISCORD_STATS_GUILD_ID) {
    return res.status(503).json({ error: 'Discord stats credentials not configured' });
  }
  try {
    const result = await updateServerStats({
      token: process.env.DISCORD_STATS_BOT_TOKEN,
      guildId: process.env.DISCORD_STATS_GUILD_ID,
      categoryId: process.env.DISCORD_STATS_CATEGORY_ID || undefined,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[server-stats]', error.message);
    return res.status(502).json({ error: 'Discord stats update failed. Check Vercel logs.' });
  }
}
