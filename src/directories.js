import { createHash } from 'node:crypto';

// All three publishers restrict automated extraction in their published terms.
// Review their terms / secure permission before enabling recurring collection.
export const sources = Object.freeze([
  { id: 'magic-square', name: 'Magic Square', url: 'https://magicsquare.io/store/upcoming/validation-starting-soon' },
  { id: 'playtoearn', name: 'PlayToEarn', url: 'https://playtoearn.com/new-blockchaingames' },
  { id: 'dappradar', name: 'DappRadar', url: 'https://dappradar.com/rankings/category/games' }
]);

const statusPattern = /\b(upcoming|development|alpha|beta|presale|playtest|early access)\b/i;
const gameCategory = /\b(games?\s*[•|:-]\s*(?:play\s*to\s*earn|gamefi|nft|pvp|rpg|metaverse|gaming|strategy|mmorpg|mmo|platform)|p2e|play\s*to\s*earn|gamefi)\b/i;
const blocked = /\b(casino|gambling|betting|sportsbook)\b/i;
const trim = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\\([\\*_`])/g, '$1').trim();
const links = /\[([^\]\n]{2,160})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g;
const todayAt = (now, timeZone='Asia/Manila') => {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
  const val = t => parts.find(p=>p.type===t)?.value;
  return `${val('year')}-${val('month')}-${val('day')}`;
};
export function upcomingWindow(now=new Date()) {
  const today=todayAt(now,process.env.UPCOMING_TIMEZONE||'Asia/Manila');
  const requested=Number(process.env.UPCOMING_WINDOW_DAYS||90);
  const days=Number.isInteger(requested)?Math.min(365,Math.max(1,requested)):90;
  return {today,until:new Date(Date.parse(today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)};
}

function datedEvent(value,now=new Date()) {
  const s=trim(value).slice(0,600);
  // Never confuse a publication/listing timestamp with a scheduled event.
  const m = s.match(/\b(?:launch(?:ing|es)?|releas(?:e|ing)|beta|alpha|playtest|early access|presale|starts?|begins?|estimated launch date|scheduled for)\b[^.\n]{0,75}?\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/i);
  if (!m) return null;
  const [y,month,day] = m.slice(1).map(Number);
  const date=new Date(Date.UTC(y,month-1,day));
  if (date.getUTCFullYear()!==y || date.getUTCMonth()+1!==month || date.getUTCDate()!==day) return null;
  const valueDate=date.toISOString().slice(0,10);
  const {today,until}=upcomingWindow(now);
  return valueDate>=today && valueDate<=until ? valueDate : 'past-or-outside-window';
}

function linkFrom(block,predicate,base) {
  links.lastIndex=0;
  for (const match of block.matchAll(links)) {
    const [_,name,path] = match;
    try { const url=new URL(path,base);
      if (url.protocol==='https:' && !/^(upcoming|view|hot offer|details|more)$/i.test(trim(name)) && predicate(url,name)) return {title:trim(name),url:url.href};
    } catch { /* Ignore invalid link */ }
  }
  return null;
}

export function parseDirectoryMarkdown(source, markdown) {
  if (typeof markdown!=='string'||!markdown.trim()) throw new Error('Firecrawl returned empty markdown.');
  if (markdown.length>1_500_000) throw new Error('Source page exceeds 1.5MB markdown safety limit.');
  const entries=[];
  const remember = (candidate) => {
    if (!candidate?.title || !candidate.url || candidate.title.length>145) return;
    if (!entries.some(x=>x.url===candidate.url)) entries.push(candidate);
  };
  if (source.id==='magic-square') {
    // Each upcoming card has a link to /store/projects/<slug>, a Games category, and an Upcoming label.
    // Use the card boundary rather than guessing that any link on the page is a game.
    const blocks=markdown.split(/(?=^\s*(?:[-*]\s*)?(?:\[Upcoming\]\([^)]*\)|Upcoming)\s*$)/gmi);
    for (const block of blocks.slice(0,500)) {
      if (!/^\s*(?:[-*]\s*)?(?:\[Upcoming\]\([^)]*\)|Upcoming)\s*$/im.test(block.slice(0,100))) continue;
      if (!/\bGames\s*[•|]\s*(?:Play To Earn|GameFi|NFTs|PvP|Metaverse|Gaming|RPG|MMORPG)\b/i.test(block)) continue;
      const a=linkFrom(block,(u)=>u.hostname==='magicsquare.io' && /^\/store\/projects\/[^/?#]+/.test(u.pathname),source.url);
      if (!a) continue;
      const lines=block.split('\n').map(trim).filter(Boolean);
      const categoryIndex=lines.findIndex(line=>/^Games\s*[•|]/i.test(line));
      const description=categoryIndex>=0?lines[categoryIndex+1]||'':'';
      remember({ ...a,status:'upcoming',description,eventDate:datedEvent(description) });
    }
  } else if (source.id==='playtoearn') {
    // Parse only game rows that expose an explicitly pre-release status, never the sponsored row.
    for (const line of markdown.split('\n')) {
      if (!/^\s*\|.*\|\s*$/.test(line)||!statusPattern.test(line)) continue;
      const columns=line.split('|').map(trim).filter(Boolean);
      const statusColumn=columns.find(x=>/^(Development|Develop\.|Alpha|Beta|Presale|Upcoming|Playtest|Early Access)$/i.test(x));
      if (!statusColumn) continue;
      if (/\bNo(?:-P2E)?\b/i.test(columns.at(-4)||'') && /\bNo(?:-P2E)?\b/i.test(columns.at(-3)||'')) continue;
      const a=linkFrom(line,(u)=>/^(?:www\.)?playtoearn\.com$/.test(u.hostname) && /\b(blockchaingame|games?)\b/i.test(u.pathname) && !/\/new-blockchaingames/.test(u.pathname),source.url);
      if (a) remember({...a,status:statusColumn.toLowerCase()==='develop.'?'development':statusColumn.toLowerCase(),description:'Pre-release game listing on PlayToEarn',eventDate:datedEvent(line)});
    }
  } else if (source.id==='dappradar') {
    // Games rankings are typically ACTIVE games. Rank/activity is not evidence of future launch.
    // Only inspect card/row blocks containing an explicit upcoming/pre-release status.
    for (const block of markdown.split(/\n(?=\s*\|)/).slice(0,200)) {
      if (!statusPattern.test(block)||!/\b(?:upcoming|development|alpha|beta|presale|playtest|early access)\b/i.test(block)) continue;
      const a=linkFrom(block,(u)=>u.hostname==='dappradar.com' && /^\/dapp\//.test(u.pathname),source.url);
      if (a) remember({...a,status:block.match(statusPattern)[1].toLowerCase(),description:'Pre-release DappRadar gaming listing',eventDate:datedEvent(block)});
    }
  } else throw new Error('Unrecognized directory source.');
  return entries.slice(0,150);
}

export function validateDiscovery(sourceId,entry,now=new Date()) {
  const source=sources.find(s=>s.id===sourceId);
  if(!source||!entry) return null;
  const title=trim(entry.title).slice(0,140);
  const status=trim(entry.status).toLowerCase();
  if (!title||blocked.test(title)||!statusPattern.test(status)||!['upcoming','development','alpha','beta','presale','playtest','early access'].includes(status)) return null;
  let url;
  try { const u=new URL(entry.url);if(u.protocol!=='https:'||u.hostname!==new URL(source.url).hostname)return null; u.hash='';url=u.href; }catch{return null;}
  const date=entry.eventDate;
  if (date==='past-or-outside-window') return null;
  if (date && (typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<upcomingWindow(now).today||date>upcomingWindow(now).until)) return null;
  const id=createHash('sha256').update(`${source.id}:${url}`).digest('hex').slice(0,32);
  return { id,title,url,status,eventDate:date||null,description:trim(entry.description).slice(0,350)||'Newly listed pre-release P2E/Web3 game. Verify status with the developer.',sourceId,sourceName:source.name,date:now.toISOString() };
}
