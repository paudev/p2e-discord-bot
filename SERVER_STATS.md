# Discord server stats voice-channel counters

Adds two Discord sidebar counters under **📊 SERVER STATS** with no always-on bot:

- 👥 Members — Discord's approximate member count
- 🟢 Online — Discord's approximate presence count

The first successful run creates the category and two voice channels, denies @everyone CONNECT on new channels, and updates their names. Subsequent runs only rename when counts change.

## Configure GitHub Actions (10-minute schedule)

1. Create or choose a Discord bot in https://discord.com/developers/applications and invite it with **View Channels** and **Manage Channels**.
2. Enable Discord Developer Mode, right-click the server icon and copy **Server ID**.
3. In GitHub repo Settings > Secrets and variables > Actions, set:
   - **Secret** DISCORD_STATS_BOT_TOKEN = bot token.
   - **Variable** DISCORD_STATS_GUILD_ID = Server ID.
   - Optional **variable** DISCORD_STATS_CATEGORY_ID = ID of an existing category you want the counter channels in.
4. Run Actions > Discord server stats > Run workflow. The category/counters will be created if missing.

This job calls Discord directly and does not need Vercel to be publicly accessible. Scheduled GitHub Action runs can be delayed. Discord restricts channel-name update frequency; the bot skips unchanged values and surfaces 429 responses instead of spamming retries.

## Vercel endpoint

The existing project also provides \`POST /api/server-stats\`. Configure Vercel production variables DISCORD_STATS_BOT_TOKEN, DISCORD_STATS_GUILD_ID and (optional) DISCORD_STATS_CATEGORY_ID. The endpoint requires Authorization: Bearer <secret>, where <secret> is DISCORD_STATS_TRIGGER_SECRET or the project's existing CRON_SECRET. The Vercel deployment may additionally require Vercel authentication. The GitHub Action does not call this endpoint.

## Tests

\`node --test tests/server-stats.test.mjs\`
