# CryptoPH · P2E Game Discovery (Firecrawl)

Cloud-scheduled Discord announcements for **newly discovered pre-release P2E/Web3 games**. Vercel serverless API, Firecrawl extraction, Upstash Redis, Discord webhooks and cron-job.org. **No Google News; no GitHub Actions or workflows.**

## Important: check source permissions

**Firecrawl is a technical tool, not permission to collect data.** At the time of implementation, Magic Square, PlayToEarn and DappRadar all publish restrictions on automated scraping/extraction in their terms. Review each publisher's latest terms and obtain any required permission **before enabling recurring collection**. Do not attempt to circumvent login, captchas, blocks or rate limits.

- [Magic Square terms](https://docs.magicsquare.io/documents/legal-documents/magic-store-terms-and-conditions)
- [PlayToEarn terms](https://playtoearn.com/terms)
- [DappRadar terms](https://dappradar.com/terms)

This code implements adapters for the three requested public listing pages but their availability and permission to automate are not guaranteed. Use an authorized feed or provider API instead if permission is unavailable.

## What it does

- **Magic Square:** parse cards on the Upcoming Validation Starting Soon page; accept only **Games** categories and **Upcoming** status.
- **PlayToEarn:** parse listing table rows with an explicit **Development / Alpha / Beta / Presale** status, not Live.
- **DappRadar:** game rankings usually show *live* games; announce **only** listings explicitly marked upcoming/pre-release. Zero may be correct.
- **Date constraint:** if a valid event date is provided, only accept it from **today to 90 days ahead** (`UPCOMING_WINDOW_DAYS`). If no actual event date is provided, a newly seen pre-release directory listing can be posted with **"date not announced"**, not a fabricated date.
- **First run:** `FIRST_RUN_MODE=baseline` records existing qualifying listings and posts nothing, preventing a flood. Later scans post only newly found qualifying listings, max 3 per scan.
- **Redis:** seen-game markers have 90-day expiry, refreshed for games still in the directory; games that disappear are cleaned up after 90 days. That avoids old still-upcoming listings reappearing every 90 days. Discord messages are never deleted by cleanup.
- **Security:** CRON_SECRET bearer header and Redis scan lock; Discord mentions disabled; feed errors are explicitly reported instead of silently returning zero.

## Setup (Vercel)

1. Install Firecrawl from Vercel Marketplace and confirm `FIRECRAWL_API_KEY` is available in your **Production** environment variables. If you configured it after deployment, redeploy.
2. Create `#upcoming-p2e` Discord channel → Edit Channel → Integrations → Webhooks. Set `DISCORD_WEBHOOK_URL` in Vercel.
3. Create Upstash Redis and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into Vercel.
4. Set `CRON_SECRET` to a private random token, `FIRST_RUN_MODE=baseline`, `UPCOMING_WINDOW_DAYS=90`, `MAX_POSTS_PER_RUN=3`, `SEEN_RETENTION_DAYS=90`.
5. **Redeploy** to apply environment variables. Make sure your publisher collection permissions are in order before enabling the recurring schedule.
6. Preview (no writes / Discord posts):

   ```powershell
   $secret = Read-Host "CRON_SECRET"
   Invoke-RestMethod 'https://YOUR-PROJECT.vercel.app/api/scan?preview=1' -Headers @{ Authorization = "Bearer $secret" } | ConvertTo-Json -Depth 10
   ```

7. On cron-job.org schedule an HTTP GET request to `https://YOUR-PROJECT.vercel.app/api/scan` every **four hours**, with the custom header `Authorization: Bearer YOUR_CRON_SECRET`. Firecrawl's free-tier usage depends on current pricing; three basic page scrapes x 6 runs/day x 30 days is **540 scrape calls/month**, before premium features or retries.
8. Run one normal scan. It will baseline existing games without posting. New eligible games discovered on later runs are sent to Discord.

When `?preview=1` is used, each source now reports `diagnostics` (link counts, table rows, a short URL-redacted public sample) so a layout change can be diagnosed without leaking any API credentials.

### Common troubleshooting

- `401 Unauthorized`: wrong `Authorization: Bearer` header or CRON_SECRET.
- `Firecrawl HTTP 401`: missing/invalid Firecrawl API key (separate from CRON_SECRET).
- `sources[].error`: publisher blocked extraction, response changed, or parser failed. Do not bypass restrictions.
- `extracted: N, eligible: 0`: games were found, but none met upcoming rules.
- `extracted: 0` for DappRadar: expected if no explicit upcoming listings are shown; never post live games as upcoming.
- `200` with `posted: 0`: valid scan, no newly discovered listings or first-run baseline.
- Keep publisher-facing data checks low-frequency and source-linked. Game status is unverified; no earning promises.

Run `npm run check` for syntax checks. `npm test` runs local parser and deduplication checks. A production API call requires configured Firecrawl, Upstash and Discord credentials; this repo has no credentials.
