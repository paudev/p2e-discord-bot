import { fetchFeed, getFeedDefinitions } from './feeds.js';
import { state } from './store.js';
import { sendDiscord } from './discord.js';

export async function runScan({ preview = false, deps = {} } = {}) {
  const readFeed = deps.fetchFeed || fetchFeed;
  const storage = deps.state || state;
  const post = deps.sendDiscord || sendDiscord;
  const feeds = deps.feeds || getFeedDefinitions();
  const maxPosts = Math.min(5, Math.max(1, Number(process.env.MAX_POSTS_PER_RUN || 3)));
  const firstRunMode = process.env.FIRST_RUN_MODE === 'post' ? 'post' : 'baseline';

  // GET ?preview=1 never reads/writes Redis and never posts to Discord.
  if (preview) {
    const output = await Promise.all(feeds.map(async feed => {
      try {
        const items = await readFeed(feed);
        return { source: feed.name, found: items.length, candidates: items.slice(0, 8).map(({ title, url, eventDate }) => ({ title, url, eventDate })) };
      } catch (error) { return { source: feed.name, error: error.message }; }
    }));
    return { ok: output.some(s => !s.error), preview: true, sources: output };
  }

  const lock = await storage.acquireLock();
  if (!lock) return { ok: true, busy: true, message: 'Previous scan is still running; skipped.' };
  const summary = { ok: true, preview: false, posted: 0, seeded: 0, candidates: 0, sources: [], errors: [] };
  try {
    // Fetch public feeds in parallel so multiple slow sources stay within Vercel's time limit.
    const results = await Promise.all(feeds.map(async feed => {
      try { return { feed, items: await readFeed(feed) }; }
      catch (error) { return { feed, error }; }
    }));
    for (const result of results) {
      const { feed } = result;
      if (result.error) {
        console.error(feed.id, result.error);
        summary.errors.push({ source: feed.name, error: result.error.message });
        continue;
      }
      // Defend against custom feed implementations returning old or undated stories.
      const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.UPCOMING_TIMEZONE || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const part = kind => todayParts.find(entry => entry.type === kind)?.value;
      const today = `${part('year')}-${part('month')}-${part('day')}`;
      const maxDays = Math.min(365, Math.max(1, Number(process.env.UPCOMING_WINDOW_DAYS || 90)));
      const until = new Date(`${today}T00:00:00Z`).getTime() + maxDays * 86400e3;
      const items = result.items.filter(item => item.eventDate && item.eventDate >= today &&
        new Date(`${item.eventDate}T00:00:00Z`).getTime() <= until);
      summary.candidates += items.length;
      const initialized = await storage.initialized(feed.id);
      if (!initialized && firstRunMode === 'baseline') {
        await storage.markSeenMany(items, 'seeded');
        await storage.markInitialized(feed.id);
        summary.seeded += items.length;
        summary.sources.push({ source: feed.name, seeded: items.length });
        continue;
      }
      // By default, oldest matches first; limit posts to avoid flooding the channel.
      items.sort((a, b) => a.date - b.date);
      const seen = await storage.seenMany(items);
      let alreadySeen = seen.size, posted = 0;
      let discordFailed = false;
      for (const item of items) {
        if (seen.has(item.id)) continue;
        if (summary.posted >= maxPosts) break;
        try {
          const messageId = await post(item);
          await storage.markSeen(item.id, `posted:${messageId}`);
          summary.posted++; posted++;
        } catch (error) {
          summary.errors.push({ source: feed.name, error: `Discord: ${error.message}` });
          discordFailed = true;
          break;
        }
      }
      // If we posted on first run, older unseen items must not flood later runs.
      if (!initialized && firstRunMode === 'post' && !discordFailed) {
        const rest = items.filter(item => !seen.has(item.id));
        await storage.markSeenMany(rest, 'first-run-seen');
      }
      if (!initialized && !discordFailed) await storage.markInitialized(feed.id);
      summary.sources.push({ source: feed.name, found: items.length, alreadySeen, posted });
    }
    summary.ok = summary.errors.length === 0;
    await storage.recordResult(summary);
    return summary;
  } finally {
    await storage.releaseLock(lock).catch(err => console.error('Could not release scan lock:', err));
  }
}
