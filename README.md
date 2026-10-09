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
  - Game cards usually have no launch date. The bot checks a rotating sample of actual project pages, where Magic Square sometimes displays an **estimated launch date** such as `31 Mar '26`.
- **PlayToEarn:** parse listing table rows with an explicit **Development / Alpha / Beta / Presale** status, not Live.
- **DappRadar:** game rankings usually show *live* games; announce **only** listings explicitly marked upcoming/pre-release. Zero may be correct.
- **Strict dates only:** every accepted game must contain an **explicit dated launch, playtest, beta or similar scheduled event**, with a four-digit year or an explicit Magic Square-style apostrophe year (e.g. `31 Dec '26`). Valid ISO (`YYYY-MM-DD`) and month-name dates are accepted only from **today through 90 days ahead** (`UPCOMING_WINDOW_DAYS`, `UPCOMING_TIMEZONE=Asia/Manila`). Past, invalid, undated and too-distant events are **discarded before Redis or Discord**. A directory badge reading Upcoming alone does not qualify.
- **First run:** `FIRST_RUN_MODE=baseline` records existing qualifying listings and posts nothing, preventing a flood. Later scans post only newly found qualifying listings, max 5 per scan (configurable). The **five nearest upcoming events across all three sites** take priority regardless of source order.
- **Redis:** a seven-day detail-page cache preserves extracted dates across scans even when the directory card never shows a date. Seen-post keys include the directory URL **and event date**, allowing a newly announced playtest date for an existing game. Seen markers have 90-day expiry, refreshed for eligible dated events still in the directory; games that disappear are cleaned up after 90 days. That avoids old still-upcoming listings reappearing every 90 days. Discord messages are never deleted by cleanup.
- **Security:** CRON_SECRET bearer header and Redis scan lock; Discord mentions disabled; feed errors are explicitly reported instead of silently returning zero.

## Setup (Vercel)

1. Install Firecrawl from Vercel Marketplace and confirm `FIRECRAWL_API_KEY` is available in your **Production** environment variables. If you configured it after deployment, redeploy.
2. Create `#upcoming-p2e` Discord channel → Edit Channel → Integrations → Webhooks. Set `DISCORD_WEBHOOK_URL` in Vercel.
3. Create Upstash Redis and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into Vercel.
4. Set `CRON_SECRET` to a private random token, `FIRST_RUN_MODE=baseline`, `UPCOMING_WINDOW_DAYS=90`, `MAX_POSTS_PER_RUN=5`, `SEEN_RETENTION_DAYS=90`, `MAX_DETAIL_PAGES_PER_RUN=2`.
5. **Redeploy** to apply environment variables. Make sure your publisher collection permissions are in order before enabling the recurring schedule.
6. Preview (no writes / Discord posts):

   ```powershell
   $secret = Read-Host "CRON_SECRET"
   Invoke-RestMethod 'https://YOUR-PROJECT.vercel.app/api/scan?preview=1' -Headers @{ Authorization = "Bearer $secret" } | ConvertTo-Json -Depth 10
   ```

7. On cron-job.org schedule an HTTP GET request to `https://YOUR-PROJECT.vercel.app/api/scan` every **six hours**, with the custom header `Authorization: Bearer YOUR_CRON_SECRET`. Firecrawl's free-tier usage depends on current pricing; four directory/news pages plus up to two game detail pages x 4 runs/day x 30 days is **up to 720 basic page scrapes/month**, before previews, retries, premium features, or any provider changes. Each preview also consumes Firecrawl credits; free quotas can change.
8. Run one normal scan. It will baseline existing games without posting. New eligible games discovered on later runs are sent to Discord.

`?preview=1` checks up to 2 extra detail pages without Redis access or Discord posting. `?preview=1&detailOffset=10` samples different detail pages; changing this offset is read-only but consumes Firecrawl credits. Preview includes `detailChecks`, `detailPoolSize`, and `detailOffset`, so you can see individual game dates and expired dates. `?preview=1` also reports `topCandidates` ranked nearest-first **across all sources**, plus `discardedUndated`, `discardedOutOfWindow`, and `discardedOther` counts per source. When preview is used, each source reports `diagnostics` (link counts, table rows, a short URL-redacted public sample) so a layout change can be diagnosed without leaking any API credentials.

### Common troubleshooting

- `401 Unauthorized`: wrong `Authorization: Bearer` header or CRON_SECRET.
- `Firecrawl HTTP 401`: missing/invalid Firecrawl API key (separate from CRON_SECRET).
- `sources[].error`: publisher blocked extraction, response changed, or parser failed. Do not bypass restrictions.
- `extracted: N, eligible: 0`: listings were found, but none had an eligible future launch/playtest date. Check `detailChecks`: `matchedDates > 0` with `outOfWindow > 0` means the page contained a dated event that is already past or too distant; `matchedDates: 0` means no explicit event date matched. Magic Square lists projects as Upcoming even after an estimated launch date has passed.
- `extracted: 0` for DappRadar: expected if no explicit upcoming listings are shown; never post live games as upcoming.
- `200` with `posted: 0`: valid scan, no newly discovered listings or first-run baseline.
- Keep publisher-facing data checks low-frequency and source-linked. Game status is unverified; no earning promises.

Run `npm run check` for syntax checks. `npm test` runs local parser and deduplication checks. A production API call requires configured Firecrawl, Upstash and Discord credentials; this repo has no credentials.


### Event dates versus article dates

The bot now reads **PlayToEarn News** in addition to its new-game directory, Magic Square and DappRadar. Directory listings often contain a status but **no event date**; the PlayToEarn News index includes dated game announcements. The event date is parsed solely from the article **headline or its teaser**, not the surrounding news byline, publish date, modified date, or date of the listing. The publication date is used **only** as a year-reference when a recent article explicitly states a month/day for a launch or game event (e.g. "RavenQuest launches on October 16" published September 21, 2026). Those matches carry `yearInferred: true` and must be manually verified against the original announcement before treating them as confirmed.

Preview and Discord messages include `evidence`, `eventType`, `publishedAt`, `estimated`, and `yearInferred` as applicable. Magic Square often displays a stale **estimated** launch date such as March 31, 2026. Past estimates remain excluded even when a page still says Upcoming. Events outside 90 days or without explicit dates are excluded. An empty list can be a correct result; no dates are fabricated.

At every scan: four directory/news pages and up to two extra game detail pages consume **up to 6 basic Firecrawl page scrapes**. At 4-hour intervals that's about 1,080 scrapes over 30 days, potentially exceeding a 1,000-credit allowance. **Use a 6-hour schedule** (about 720 basic page scrapes/month, excluding previews and retries) or a paid Firecrawl tier, subject to the current plan's actual usage rules. No GitHub Actions.

## Production posting limit

The example default is now `MAX_POSTS_PER_RUN=5`. If Vercel already has a Production environment variable set to `3`, it overrides the default; change it to `5` in Vercel and redeploy for five announcements per scan. Lower values still use nearest-date-first priority.

**Discovery limitation:** this bot checks only Magic Square's Upcoming directory, PlayToEarn's New Blockchain Games directory and DappRadar's Games rankings, plus a limited rotating sample of their game detail pages. Dated announcements published solely as gaming *news* or on official X accounts are not included. An eligible upcoming date must actually appear in scraped text, or the bot correctly rejects the listing. Automated access is subject to each publisher's rules.
