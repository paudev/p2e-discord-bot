import { randomUUID } from 'node:crypto';

const namespace = 'cryptoph:p2e:v2';
const key = part => `${namespace}:${part}`;
// Upstash Redis automatically removes seen-item keys after this TTL. No cleanup cron needed.
export const seenRetentionSeconds = () => {
  const raw = Number(process.env.SEEN_RETENTION_DAYS ?? '90');
  const days = Number.isInteger(raw) ? Math.min(365, Math.max(7, raw)) : 90;
  return days * 24 * 60 * 60;
};

export async function command(...parts) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash environment variables are missing.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(parts),
    signal: AbortSignal.timeout(8000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(`Upstash request failed (${res.status}): ${String(body.error || 'unknown').slice(0, 160)}`);
  }
  return body.result;
}

// Run multiple commands in one Upstash REST request. Every saved item gets its own TTL.
export async function pipeline(commands) {
  if (!commands.length) return [];
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash environment variables are missing.');
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data) || data.length !== commands.length || data.some(v => v.error)) {
    throw new Error(`Upstash pipeline failed (${res.status}): ${JSON.stringify(data).slice(0, 180)}`);
  }
  return data.map(v => v.result);
}

export const state = {
  async initialized(feedId) { return Boolean(await command('GET', key(`init:${feedId}`))); },
  async markInitialized(feedId) { return command('SET', key(`init:${feedId}`), new Date().toISOString()); },
  async seen(id) { return Boolean(await command('GET', key(`seen:${id}`))); },
  async seenMany(items) {
    if (!items.length) return new Set();
    const result = await command('MGET', ...items.map(item => key(`seen:${item.id}`)));
    return new Set(items.filter((_, index) => result[index] !== null).map(item => item.id));
  },
  async markSeen(id, status) { return command('SET', key(`seen:${id}`), `${status}:${new Date().toISOString()}`, 'EX', seenRetentionSeconds()); },
  async markSeenMany(items, status) {
    for (let offset = 0; offset < items.length; offset += 50) {
      const timestamp = new Date().toISOString();
      await pipeline(items.slice(offset, offset + 50).map(item => [
        'SET', key(`seen:${item.id}`), `${status}:${timestamp}`, 'EX', seenRetentionSeconds()
      ]));
    }
  },
  async acquireLock() {
    const token = randomUUID();
    const ok = await command('SET', key('lock'), token, 'NX', 'EX', 150);
    return ok === 'OK' ? token : null;
  },
  async releaseLock(token) {
    return command('EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, key('lock'), token);
  },
  async recordResult(data) {
    return command('SET', key('last-run'), JSON.stringify({ at: new Date().toISOString(), ...data }));
  }
};
