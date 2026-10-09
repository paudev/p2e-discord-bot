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


function plainCell(value) {
  return String(value ?? '').replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\\([\\*_`|])/g, '$1').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
}
function listingLinks(value, base) {
  const output=[];
  for(const match of value.matchAll(/\[([^\]\n]{2,160})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)) {
    try {
      const u=new URL(match[2],base);
      if(u.protocol==='https:') output.push({title:plainCell(match[1]),url:u.href,index:match.index,length:match[0].length});
    } catch { /* invalid link */ }
  }
  return output;
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
    // The whole URL is an Upcoming directory; the badge is not necessarily
    // on a separate line. Look for game categories beside project-name links.
    const all=listingLinks(markdown,source.url)
      .filter(a=>new URL(a.url).hostname==='magicsquare.io' && /\/store\/projects\/[^/?#]+/.test(new URL(a.url).pathname));
    for(const a of all) {
      if(!a.title || /^(upcoming|view|view hot offer|details|image|open app)$/i.test(a.title)) continue;
      const next=all.find(b=>b.index>a.index && b.url!==a.url);
      const after=markdown.slice(a.index+a.length,
        Math.min(a.index+a.length+650,next?.index??markdown.length));
      const gameCategory=/\bGames?\b[\s*•|:/–—-]*(?:Play\s*To\s*Earn|GameFi|NFTs?|PvP|Metaverse|Gaming|RPG|MMORPG|MMO|Platform|Strategy|Action|Adventure)\b/i;
      if(!gameCategory.test(after)) continue;
      const desc=after.split('\n').map(plainCell).find(x=>x && !/^(Games|Upcoming|View|Image)/i.test(x))||'';
      remember({title:a.title,url:a.url,status:'upcoming',
        description:desc.slice(0,350)||'Upcoming game listing on Magic Square',
        eventDate:datedEvent(after)});
    }
  } else if (source.id==='playtoearn') {
    // PlayToEarn wraps status labels in markdown links: [Alpha](...), [Beta](...).
    // Read cells as rendered text, and take the name only from a game-detail URL.
    for(const line of markdown.split('\n')) {
      if(!/^\s*\|.*\|\s*$/.test(line) || /\bSponsored\b/i.test(line)) continue;
      const cells=line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.trim());
      const statusIndex=cells.findIndex(x=>/^(Development|Develop\.|Alpha|Beta|Presale|Upcoming|Playtest|Early Access)$/i.test(plainCell(x)));
      if(statusIndex<0) continue;
      const game=listingLinks(line,source.url).find(a=>{
        const u=new URL(a.url);
        return /^(?:www\.)?playtoearn\.com$/i.test(u.hostname)&&/^\/blockchaingame\/[^/?#]+/i.test(u.pathname);
      });
      if(!game) continue;
      // Page column order is Status | F2P | P2E. Reject explicit No-P2E rows.
      const p2e=plainCell(cells[statusIndex+2]||'');
      if(/^(?:no|no-p2e|none|not available)$/i.test(p2e)) continue;
      const status=plainCell(cells[statusIndex]).toLowerCase().replace('develop.','development');
      remember({title:game.title,url:game.url,status,
        description:'Pre-release game listing on PlayToEarn',eventDate:datedEvent(line)});
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


export function extractionDiagnostics(source, markdown) {
  const lines=markdown.split('\n');
  const count=re=>[...markdown.matchAll(re)].length;
  const example=source.id==='playtoearn'
    ? lines.find(x=>/^\s*\|/.test(x)&&/\b(?:Alpha|Beta|Development)\b/i.test(x))
    : source.id==='magic-square'
      ? lines.find(x=>/\/store\/projects\//.test(x)) : '';
  return {
    markdownLines:lines.length,
    markdownLinks:count(/\]\(https?:\/\/[^)]*\)/g),
    magicProjectLinks:count(/\/store\/projects\//g),
    playToEarnGameLinks:count(/\/blockchaingame\//g),
    tableRows:lines.filter(x=>/^\s*\|.*\|\s*$/.test(x)).length,
    statusLabelMentions:count(/\b(?:upcoming|development|alpha|beta|presale|playtest)\b/gi),
    sample:String(example||'').replace(/https?:\/\/[^)\s]+/g,'[url]').slice(0,340)
  };
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
