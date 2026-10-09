# CryptoPH · Upcoming P2E Discord Bot

Automatically discover **upcoming** Play-to-Earn/Web3 game launches, betas and playtests, and post source-linked Discord announcements. Designed for Vercel Hobby (no always-running process).

**Architecture:** cron-job.org (hourly HTTP schedule) → Vercel `/api/scan` → Google News RSS plus optional RSS/Atom feeds → Upstash Redis (deduplication) → Discord webhook (recommended) or bot HTTP API.

## Strict date filter (enabled by default)

- **Recent announcement:** article published within the past `NEWS_MAX_AGE_DAYS=7` days.
- **Future event:** an explicit launch, beta, or playtest calendar date must be present in the RSS title or summary, **today through `UPCOMING_WINDOW_DAYS=90` days ahead** (inclusive).
- **Timezone:** `UPCOMING_TIMEZONE=Asia/Manila` (CryptoPH).
- **Automatic database cleanup:** seen/discovered item keys expire after `SEEN_RETENTION_DAYS=90` days from when first saved; Redis deletes expired keys automatically. The first-run markers remain so expiration does not cause a new first-run flood.
- **Excluded:** past launch dates, undated announcements, generic crypto news, casino/gambling articles, and duplicate headlines.
- Dates are extracted heuristically from third-party feeds, **not confirmed with developers**. Date-less announcements will be skipped, even if truly upcoming. This is intentional to avoid posting everything.

## 1. Discord channel

In CryptoPH, make `#upcoming-p2e` → **Edit Channel → Integrations → Webhooks → New Webhook**. Name it `CryptoPH Discovery` and copy its URL. The webhook only has access to its configured channel. Alternative: set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` to use your existing bot (requires View Channel, Send Messages, Embed Links).

## 2. Upstash

Create a Redis database at <https://console.upstash.com/>. Copy its **REST URL** and **REST Token**. This stores seen item IDs and prevents repeat announcements after function restarts.

## 3. Vercel

Import this repository <https://github.com/paudev/p2e-discord-bot> at <https://vercel.com/new>. Choose **Other** for the framework, root `./`, production branch `main`. Configure these **Production** environment variables:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-real-url
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-private-token
CRON_SECRET=long-random-secret
NEWS_MAX_AGE_DAYS=7
UPCOMING_WINDOW_DAYS=90
UPCOMING_TIMEZONE=Asia/Manila
FIRST_RUN_MODE=baseline
MAX_POSTS_PER_RUN=3
SEEN_RETENTION_DAYS=90
```

Never add secret values to GitHub. Generate a random secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Optional `RSS_FEED_URLS` accepts up to 5 comma-separated public RSS/Atom URLS (no HTML scraping). **Redeploy** after changing Vercel environment variables.

## 4. Preview and first scan

After deploying, `/api/health` is public and `/api/scan` requires `Authorization: Bearer <CRON_SECRET>`. Preview fetches sources without changing Redis or posting:

```powershell
$secret = Read-Host 'Enter CRON_SECRET'
Invoke-RestMethod 'https://YOUR_PROJECT.vercel.app/api/scan?preview=1' -Headers @{Authorization="Bearer $secret"}
```

The first successful non-preview scan with `FIRST_RUN_MODE=baseline` records any currently eligible announcements **without posting** to prevent flooding. Later scans send only newly found matching announcements (up to `MAX_POSTS_PER_RUN`). Setting `FIRST_RUN_MODE=post` *before* the initial scan allows the first matching posts.

## 5. Hourly cron-job.org trigger

At <https://cron-job.org/>, create a scheduled HTTP GET job:

- **URL:** `https://YOUR_PROJECT.vercel.app/api/scan`
- **Schedule:** hourly
- **HTTP header:** `Authorization: Bearer YOUR_CRON_SECRET`

Run a test in cron-job.org and check the result. Keep the header value private. Vercel Hobby's own Cron is daily, so the external scheduler provides hourly checks.

## 6. Maintenance

- `GET /api/scan?preview=1`: filtered candidates with estimated upcoming event dates.
- `GET /api/health`: verifies only that the deployment is reachable.
- `npm run preview`: local read-only RSS preview (uses `.env` if present).
- `npm run check`: JavaScript syntax checks.
- `npm test`: date, deduplication, and Redis TTL behavior checks (after `npm install`).
- Expired 90-day seen markers will **not delete Discord messages**. They free up Redis storage; old articles are excluded by the 7-day announcement filter, preventing reposts.
- If no candidates appear, that's expected when articles lack an explicit future date. **Do not** treat publication dates as launch dates.
- Upstash and Discord delivery require credentials; GitHub code alone does not start posting.

**Safety:** Google News is a lead source, not a verified game directory; announcements may be inaccurate or malicious. Users should verify official developer links. No automatic `@everyone` ping, no earning guarantees. Vercel Hobby is for eligible non-commercial use; review publisher feed terms and Vercel fair-use policies. No scraping.
