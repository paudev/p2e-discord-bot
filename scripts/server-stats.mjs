import { updateServerStats } from '../src/server-stats.js';

try {
  const result = await updateServerStats({
    token: process.env.DISCORD_STATS_BOT_TOKEN,
    guildId: process.env.DISCORD_STATS_GUILD_ID,
    categoryId: process.env.DISCORD_STATS_CATEGORY_ID || undefined,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('[server-stats]', error.message);
  process.exitCode = 1;
}
