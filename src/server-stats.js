/** Standalone Discord channel counters; no gateway connection required. */
export const CATEGORY_NAME = '📊 SERVER STATS';
const API = 'https://discord.com/api/v10';
const COUNTERS = [
  { key: 'members', prefix: '👥 Members: ', countKey: 'approximate_member_count' },
  { key: 'online', prefix: '🟢 Online: ', countKey: 'approximate_presence_count' },
];
const CHANNEL_TYPES = { voice: 2, category: 4 };
const CONNECT_PERMISSION = '1048576';

export async function updateServerStats({
  token,
  guildId,
  categoryId,
  fetcher = globalThis.fetch,
}) {
  if (!token || !/^\d{16,22}$/.test(guildId ?? '')) {
    throw new Error('Missing or invalid DISCORD_STATS_BOT_TOKEN / DISCORD_STATS_GUILD_ID');
  }

  async function discord(path, method = 'GET', data) {
    const response = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    let result;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      const retry = response.headers?.get?.('retry-after');
      throw new Error(`Discord ${method} ${path} failed (HTTP ${response.status})${retry ? `; retry after ${retry}s` : ''}`);
    }
    return result;
  }

  const guild = await discord(`/guilds/${guildId}?with_counts=true`);
  for (const counter of COUNTERS) {
    if (!Number.isInteger(guild[counter.countKey]) || guild[counter.countKey] < 0) {
      throw new Error(`Discord did not return ${counter.countKey}`);
    }
  }

  const channels = await discord(`/guilds/${guildId}/channels`);
  if (!Array.isArray(channels)) throw new Error('Discord returned invalid channel list');
  let category = categoryId
    ? channels.find((c) => c.id === categoryId && c.type === CHANNEL_TYPES.category)
    : channels.find((c) => c.type === CHANNEL_TYPES.category && c.name === CATEGORY_NAME);

  if (categoryId && !category) {
    throw new Error('DISCORD_STATS_CATEGORY_ID does not identify a category in this server');
  }
  if (!category) {
    category = await discord(`/guilds/${guildId}/channels`, 'POST', {
      name: CATEGORY_NAME,
      type: CHANNEL_TYPES.category,
    });
  }

  const result = { members: guild.approximate_member_count, online: guild.approximate_presence_count, categoryId: category.id, updated: [], unchanged: [], created: [] };
  for (const counter of COUNTERS) {
    const name = `${counter.prefix}${guild[counter.countKey].toLocaleString('en-US')}`;
    const existing = channels.find((c) =>
      c.type === CHANNEL_TYPES.voice &&
      c.parent_id === category.id &&
      c.name.startsWith(counter.prefix)
    );
    if (!existing) {
      const created = await discord(`/guilds/${guildId}/channels`, 'POST', {
        name,
        type: CHANNEL_TYPES.voice,
        parent_id: category.id,
        // Visible to everyone, but they cannot join these counters.
        permission_overwrites: [{ id: guildId, type: 0, allow: '0', deny: CONNECT_PERMISSION }],
      });
      result.created.push({ counter: counter.key, channelId: created.id });
    } else if (existing.name !== name) {
      await discord(`/channels/${existing.id}`, 'PATCH', { name });
      result.updated.push({ counter: counter.key, channelId: existing.id });
    } else {
      result.unchanged.push(counter.key);
    }
  }
  return result;
}
