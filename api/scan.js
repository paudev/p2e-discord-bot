import { timingSafeEqual } from 'node:crypto';
import { runScan } from '../src/pipeline.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }

  const secret = process.env.CRON_SECRET || '';
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const preview = new URL(req.url, 'https://localhost').searchParams.get('preview') === '1';
  try {
    const requestedOffset = new URL(req.url, 'https://localhost').searchParams.get('detailOffset');
    const detailOffset = preview && /^\d{1,6}$/.test(requestedOffset || '')
      ? Math.min(100000, Number(requestedOffset)) : 0;
    const result = await runScan({ preview, detailOffset });
    return res.status(result.busy ? 409 : result.ok ? 200 : 502).json(result);
  } catch (e) {
    console.error('scan:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
