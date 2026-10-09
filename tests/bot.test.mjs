import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { findUpcomingEventDate } from '../src/feeds.js';
import { seenRetentionSeconds, state } from '../src/store.js';
import { runScan } from '../src/pipeline.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

test('future dates included, past and beyond horizon excluded', () => {
  process.env.UPCOMING_WINDOW_DAYS = '90';
  assert.equal(findUpcomingEventDate('P2E game beta starts October 20, 2026', '', new Date('2026-10-09T12:00:00Z')), '2026-10-20');
  assert.equal(findUpcomingEventDate('P2E game beta starts October 2, 2026', '', new Date('2026-10-09T12:00:00Z')), null);
  assert.equal(findUpcomingEventDate('P2E game launches on February 15, 2027', '', new Date('2026-10-09T12:00:00Z')), null);
  assert.equal(findUpcomingEventDate('P2E game coming soon, release date TBA', '', new Date('2026-10-09T12:00:00Z')), null);
});

test('seen markers get 90-day Redis TTL for single and batch storage', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake';
  process.env.SEEN_RETENTION_DAYS = '90';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return { ok: true, status: 200, json: async () => url.endsWith('/pipeline') ? body.map(() => ({ result: 'OK' })) : { result: 'OK' } };
  };
  await state.markSeen('post1', 'posted:123');
  await state.markSeenMany([{ id: 'post2' }, { id: 'post3' }], 'seeded');
  assert.equal(seenRetentionSeconds(), 90 * 86400);
  assert.deepEqual(calls[0].body.slice(-2), ['EX', 90 * 86400]);
  assert.equal(calls[1].url, 'https://redis.example/pipeline');
  assert.equal(calls[1].body.length, 2);
  for (const op of calls[1].body) assert.deepEqual(op.slice(-2), ['EX', 90 * 86400]);
});

test('preview does not write; baseline and later scan do not duplicate', async () => {
  process.env.UPCOMING_WINDOW_DAYS = '90';
  process.env.FIRST_RUN_MODE = 'baseline';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const item = { id: 'one', title: 'New P2E beta', date: Date.now(), eventDate: today };
  const seen = new Set();
  let initialized = false; let posts = 0;
  const storage = {
    acquireLock: async () => 'lock', releaseLock: async () => {}, recordResult: async () => {},
    initialized: async () => initialized, markInitialized: async () => { initialized = true; },
    seenMany: async items => new Set(items.filter(x => seen.has(x.id)).map(x => x.id)),
    markSeenMany: async items => items.forEach(x => seen.add(x.id)),
    markSeen: async id => seen.add(id)
  };
  const deps = { feeds: [{ id: 'a', name: 'Feed' }], fetchFeed: async () => [item], sendDiscord: async () => { posts++; return '123'; }, state: storage };
  const preview = await runScan({ preview: true, deps });
  assert.equal(preview.sources[0].found, 1);
  assert.equal(initialized, false);
  const baseline = await runScan({ deps });
  assert.equal(baseline.seeded, 1);
  assert.equal(posts, 0);
  const repeat = await runScan({ deps });
  assert.equal(repeat.posted, 0);
  assert.equal(posts, 0);
  const newItem = { ...item, id: 'two' };
  deps.fetchFeed = async () => [item, newItem];
  const next = await runScan({ deps });
  assert.equal(next.posted, 1);
  const last = await runScan({ deps });
  assert.equal(last.posted, 0);
  assert.equal(posts, 1);
});
