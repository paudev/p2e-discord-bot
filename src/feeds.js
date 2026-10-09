import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: true });
const QUERY = [
  '("play to earn" OR "P2E game" OR "gamefi") ("launches on" OR "launching on" OR "release date" OR "beta starts" OR "playtest begins")',
  '("web3 game" OR "blockchain game" OR "onchain game") ("launch date" OR "launches on" OR "coming on" OR "playtest starts")'
];
export const defaultFeeds = QUERY.map((q, n) => ({
  id: `google-${n + 1}`,
  name: `Google News RSS #${n + 1}`,
  url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=en-US&gl=US&ceid=US:en`
}));

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() :
    value?.['#text'] ? String(value['#text']).trim() : '';
}

function urlOf(value) {
  const raw = typeof value === 'string' ? value : value?.['@_href'] || '';
  try {
    const result = new URL(raw);
    if (!['https:', 'http:'].includes(result.protocol)) return null;
    result.hash = '';
    return result.href;
  } catch { return null; }
}

const normalize = value => text(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 900);
const gameTerms = /\b(p2e|play[- ]to[- ]earn|gamefi|web3 gam(?:e|es|ing)|blockchain gam(?:e|es|ing)|onchain gam(?:e|es|ing)|crypto gam(?:e|es|ing)|nft gam(?:e|es|ing))\b/i;
const futureTerms = /\b(launch(?:es|ing)?|releas(?:e|es|ing)|upcoming|scheduled|slated|coming soon|will launch|set to|beta|alpha|playtest|early access|testnet|pre[- ]registration|begins|starts|opens|arrives|debut(?:s)?)\b/i;
const eventTerms = /\b(launch(?:es|ing)?|releas(?:e|es|ing)|beta|alpha|playtest|early access|testnet|pre[- ]registration|starts?|begins?|opens?|arrives?|debut(?:s)?|scheduled|slated|set to|coming)\b/i;
const finishedTerms = /\b(launched|released|was launched|went live|is now live|already live|recap|postmortem)\b/i;
const excluded = /\b(casino|gambling|sportsbook|betting odds)\b/i;
const months = new Map(['january','february','march','april','may','june','july','august','september','october','november','december'].map((name, i) => [name, i+1]));
const monthPattern = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const futureDatePatterns = [
  /\b(20\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g,
  new RegExp(`\\b${monthPattern}\\.?\\s+([0-2]?\\d|3[01])(?:st|nd|rd|th)?[,]?[ \\t]*(20\\d{2})?\\b`, 'gi'),
  new RegExp(`\\b([0-2]?\\d|3[01])(?:st|nd|rd|th)?\\s+${monthPattern}\\.?[,]?[ \\t]*(20\\d{2})?\\b`, 'gi')
];
const asInt = (raw, fallback, min, max) => {
  const value = Number(raw);
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
};
function localDay(now, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce((acc, part) => ({...acc, [part.type]:part.value}), {});
}
function validDay(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}
function monthNumber(name) {
  const v = name.toLowerCase().replace(/^sept$/, 'sep').slice(0, 3);
  for (const [month, index] of months) if (month.slice(0, 3) === v) return index;
  return 0;
}

// Date is extracted from the event announcement, never from the RSS article's pubDate.
// Requiring a nearby event keyword keeps unrelated dates (funding rounds, old screenshots) out.
export function findUpcomingEventDate(title, description = '', now = new Date()) {
  const tz = process.env.UPCOMING_TIMEZONE || 'Asia/Manila';
  const todayParts = localDay(now, tz);
  const today = Date.UTC(+todayParts.year, +todayParts.month - 1, +todayParts.day);
  const horizon = asInt(process.env.UPCOMING_WINDOW_DAYS, 90, 1, 365);
  const latest = today + horizon * 86400e3;
  const blocks = [title, description].map(t => normalize(t).slice(0, 600));
  const candidates = [];
  for (const block of blocks) {
    if (!block || !eventTerms.test(block)) continue;
    for (const [index, pattern] of futureDatePatterns.entries()) {
      pattern.lastIndex = 0;
      for (const match of block.matchAll(pattern)) {
        const nearby = block.slice(Math.max(0, match.index - 65), Math.min(block.length, match.index + match[0].length + 65));
        if (!eventTerms.test(nearby)) continue;
        let year, month, day;
        if (index === 0) { year = +match[1]; month = +match[2]; day = +match[3]; }
        else if (index === 1) { month = monthNumber(match[1]); day = +match[2]; year = match[3] ? +match[3] : undefined; }
        else { day = +match[1]; month = monthNumber(match[2]); year = match[3] ? +match[3] : undefined; }
        // For dates missing a year, consider the current or following year, never previous years.
        for (const candidateYear of year ? [year] : [+todayParts.year, +todayParts.year + 1]) {
          if (!validDay(candidateYear, month, day)) continue;
          const date = Date.UTC(candidateYear, month - 1, day);
          if (date >= today && date <= latest) candidates.push(date);
          if (year) break;
        }
      }
    }
  }
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates)).toISOString().slice(0, 10);
}

export function getFeedDefinitions() {
  const extras = (process.env.RSS_FEED_URLS || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
  return [...defaultFeeds, ...extras.map((url, index) => {
    let name = `Custom RSS #${index + 1}`;
    try { name = new URL(url).hostname; } catch { /* fetchFeed reports invalid URLs */ }
    return { id: `extra-${index + 1}`, name, url };
  })];
}

export function parseArticles(xml, feed) {
  const data = parser.parse(xml);
  const rss = data?.rss?.channel?.item || data?.feed?.entry || [];
  const entries = Array.isArray(rss) ? rss : [rss];
  const ageDays = asInt(process.env.NEWS_MAX_AGE_DAYS, 7, 1, 30);
  const now = Date.now();
  const cutoff = now - ageDays * 86400e3;
  const items = [];
  for (const entry of entries.slice(0, 80)) {
    if (!entry) continue;
    const rawTitle = normalize(entry.title).slice(0, 220);
    const title = rawTitle.replace(/\s+[-–]\s+[^–-]{2,75}$/, '').trim();
    const description = normalize(entry.description || entry.summary || '');
    const date = Date.parse(text(entry.pubDate || entry.published || entry.updated));
    const link = Array.isArray(entry.link) ? entry.link.find(v => v?.['@_rel'] === 'alternate') || entry.link[0] : entry.link;
    const url = urlOf(link);
    if (!title || !url || !Number.isFinite(date) || date < cutoff || date > now + 600000) continue;
    if (!gameTerms.test(rawTitle) || !futureTerms.test(rawTitle) || finishedTerms.test(rawTitle) || excluded.test(rawTitle)) continue;
    const eventDate = findUpcomingEventDate(title, description, new Date(now));
    // Strict by default: if no explicit future event date within the configured window, skip it.
    if (!eventDate) continue;
    const canonicalTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const id = createHash('sha256').update(canonicalTitle).digest('hex').slice(0, 32);
    items.push({ id, title: title.slice(0, 200), url, date, eventDate,
      sourceName: feed.name, status: `Upcoming event · ${eventDate} · check official source`,
      description: 'Upcoming P2E/Web3 gaming event mentioned in a recent article. Date is extracted from the headline or feed summary, not independently verified. Check the official announcement before participating.' });
  }
  return items;
}

export async function fetchFeed(feed) {
  const url = new URL(feed.url);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('RSS_FEED_URLS must use HTTP(S).');
  const response = await fetch(url, {
    headers: { accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  const xml = await response.text();
  if (xml.length > 1_000_000) throw new Error('Feed exceeds 1 MB safety limit.');
  return parseArticles(xml, feed);
}
