import test from 'node:test';
import assert from 'node:assert/strict';
import { updateServerStats } from '../src/server-stats.js';
const guildId = '123456789012345678';
const categoryId = '223456789012345678';
function mockFetch({ channels, guild = { approximate_member_count: 2021, approximate_presence_count: 374 } }) {
  const calls = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/api\/v10/, '');
    calls.push({ path, method: init.method, data: init.body ? JSON.parse(init.body) : undefined });
    let response;
    if (path === `/guilds/${guildId}`) response = guild;
    else if (path === `/guilds/${guildId}/channels` && init.method === 'GET') response = channels;
    else if (path === `/guilds/${guildId}/channels` && init.method === 'POST') response = { id: `${223456789012345679n + BigInt(calls.length)}`, ...JSON.parse(init.body) };
    else if (path.startsWith('/channels/') && init.method === 'PATCH') response = { id: path.split('/')[2], ...JSON.parse(init.body) };
    else throw new Error(`Unexpected request: ${path}`);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => response };
  };
  return { fetcher, calls };
}

test('creates a category and two locked voice counters', async () => {
  const { fetcher, calls } = mockFetch({ channels: [] });
  const result = await updateServerStats({ token: 'dummy', guildId, fetcher });
  assert.equal(result.created.length, 2);
  assert.equal(result.members, 2021);
  const posted = calls.filter((c) => c.method === 'POST');
  assert.equal(posted.length, 3);
  assert.equal(posted[0].data.name, '📊 SERVER STATS');
  assert.deepEqual(posted.slice(1).map(c => c.data.name), ['👥 Members: 2,021', '🟢 Online: 374']);
  assert.equal(posted[1].data.permission_overwrites[0].deny, '1048576');
});

test('skips changes when names already match', async () => {
  const { fetcher, calls } = mockFetch({ channels: [
    { id: categoryId, type: 4, name: '📊 SERVER STATS' },
    { id: '323456789012345678', type: 2, parent_id: categoryId, name: '👥 Members: 2,021' },
    { id: '423456789012345678', type: 2, parent_id: categoryId, name: '🟢 Online: 374' },
  ] });
  const result = await updateServerStats({ token: 'dummy', guildId, fetcher });
  assert.deepEqual(result.unchanged, ['members', 'online']);
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
});

test('renames only stale voice counters', async () => {
  const { fetcher, calls } = mockFetch({ channels: [
    { id: categoryId, type: 4, name: '📊 SERVER STATS' },
    { id: '323456789012345678', type: 2, parent_id: categoryId, name: '👥 Members: 2,000' },
    { id: '423456789012345678', type: 2, parent_id: categoryId, name: '🟢 Online: 374' },
  ] });
  const result = await updateServerStats({ token: 'dummy', guildId, fetcher });
  assert.equal(result.updated.length, 1);
  assert.deepEqual(result.unchanged, ['online']);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});

test('refuses to create channels if Discord counts are missing', async () => {
  const { fetcher, calls } = mockFetch({ channels: [], guild: { approximate_member_count: 2021 } });
  await assert.rejects(() => updateServerStats({ token: 'dummy', guildId, fetcher }), /approximate_presence_count/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
