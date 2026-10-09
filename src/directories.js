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
const links = /\[([^\]\n]{2,160})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)(?:\s+\"[^\"]*\")?\)/g;
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

// Event dates are extracted only from nearby launch/playtest language,
// never from listing timestamps, copyright years or unspecific "upcoming" tags.
const monthIndex=name=>['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  .indexOf(String(name).toLowerCase().slice(0,3))+1;
const monthPattern='(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember|t)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const dateFormats=[
  {regex:/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g,parts:m=>[+m[1],+m[2],+m[3]]},
  {regex:new RegExp('\\b'+monthPattern+'\\.?\\s+([0-3]?\\d)(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b','gi'),
   parts:m=>[+m[3],monthIndex(m[1]),+m[2]]},
  {regex:new RegExp('\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+'+monthPattern+'\\.?[,]?\\s+(20\\d{2})\\b','gi'),
   parts:m=>[+m[3],monthIndex(m[2]),+m[1]]},
  // Magic Square uses "31 Mar '26" on individual app detail pages.
  {regex:new RegExp('\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+'+monthPattern+'\\.?\\s+[\\u0027\\u2019](\\d{2})\\b','gi'),
   parts:m=>[2000+(+m[3]),monthIndex(m[2]),+m[1]]},
  {regex:new RegExp('\\b'+monthPattern+'\\.?\\s+([0-3]?\\d)(?:st|nd|rd|th)?[,]?\\s+[\\u0027\\u2019](\\d{2})\\b','gi'),
   parts:m=>[2000+(+m[3]),monthIndex(m[1]),+m[2]]}
];
// A year is essential: inferring 2026 for a bare "October 16" could turn
// an old announcement into a false upcoming launch.
const eventWords='(?:launch(?:es|ed|ing)?|releas(?:e|es|ed|ing)|beta|alpha|playtest|testnet|early[\\s-]access|presale|pre[\\s-]registration|registration|start(?:s|ing)?|begin(?:s|ning)?|open(?:s|ing)?|scheduled|slated|debut(?:s)?|goes live|go live)';
const eventBefore=new RegExp('\\b'+eventWords+'\\b[^.!?\\n]{0,100}$','i');
const eventAfter=new RegExp('^.{0,38}\\b'+eventWords+'\\b','i');
const staleEvent=/\b(?:previously|last year|originally|was released|already launched|postponed|cancelled)\b/i;
export function extractUpcomingEventDate(value,now=new Date()) {
  const sourceText=String(value??'').replace(/\r/g,'').slice(0,100000);
  const {today,until}=upcomingWindow(now);
  const upcoming=[];
  let oldDates=0, matchedDates=0;
  for(const fmt of dateFormats) {
    for(const match of sourceText.matchAll(fmt.regex)) {
      const left=sourceText.slice(Math.max(0,match.index-120),match.index).replace(/\s+/g,' ');
      const right=sourceText.slice(match.index+match[0].length,match.index+match[0].length+55).replace(/\s+/g,' ');
      if(!eventBefore.test(left) && !eventAfter.test(right))continue;
      const [year,month,day]=fmt.parts(match);
      const parsed=new Date(Date.UTC(year,month-1,day));
      if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()+1!==month||parsed.getUTCDate()!==day)continue;
      matchedDates++;
      const iso=parsed.toISOString().slice(0,10);
      if(iso<today||iso>until){oldDates++;continue;}
      const context=left.slice(-85)+' '+match[0]+' '+right.slice(0,35);
      if(staleEvent.test(context))continue;
      upcoming.push(iso);
    }
  }
  return {date:upcoming.sort()[0]||null,matchedDates,outOfWindow:oldDates};
}
function datedEvent(value,now=new Date()) {
  const {date,matchedDates}=extractUpcomingEventDate(value,now);
  return date||(matchedDates?'past-or-outside-window':null);
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
  for(const match of value.matchAll(links)) {
    try {
      const u=new URL(match[2],base);
      if(u.protocol==='https:') output.push({title:plainCell(match[1]),url:u.href,index:match.index,length:match[0].length});
    } catch { /* invalid link */ }
  }
  return output;
}


function splitTableCells(row) {
  const cells=[];let current='',square=0,round=0,escaped=false;
  for(const char of row.trim()){
    if(escaped){current+=char;escaped=false;continue;}
    if(char==='\\'){current+=char;escaped=true;continue;}
    if(char==='[')square++;
    else if(char===']')square=Math.max(0,square-1);
    else if(char==='(')round++;
    else if(char===')')round=Math.max(0,round-1);
    if(char==='|'&&square===0&&round===0){cells.push(current.trim());current='';}
    else current+=char;
  }
  cells.push(current.trim());
  if(cells[0]==='')cells.shift();
  if(cells.at(-1)==='')cells.pop();
  return cells;
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
      const cells=splitTableCells(line);
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
  // Reject missing, invalid and past dates even for externally provided entries.
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const timestamp=Date.parse(date+'T00:00:00Z');
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date)return null;
  const {today,until}=upcomingWindow(now);
  if(date<today||date>until)return null;
  const id=createHash('sha256').update(`${source.id}:${url}:${date}`).digest('hex').slice(0,32);
  return { id,title,url,status,eventDate:date,description:trim(entry.description).slice(0,350)||'Newly listed pre-release P2E/Web3 game. Verify status with the developer.',sourceId,sourceName:source.name,date:now.toISOString() };
}
