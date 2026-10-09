import { createHash } from 'node:crypto';

// All three publishers restrict automated extraction in their published terms.
// Review their terms / secure permission before enabling recurring collection.
export const sources = Object.freeze([
  { id: 'magic-square', name: 'Magic Square', url: 'https://magicsquare.io/store/upcoming/validation-starting-soon' },
  { id: 'playtoearn', name: 'PlayToEarn', url: 'https://playtoearn.com/new-blockchaingames' },
  { id: 'dappradar', name: 'DappRadar', url: 'https://dappradar.com/rankings/category/games' },
  { id: 'playtoearn-news', name: 'PlayToEarn Announcements', url: 'https://playtoearn.com/news' }
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

// Date evidence: parse only a dated game event in the same announcement line.
// Publication/updated timestamps and directory-listing dates never count.
const monthIndex=name=>['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  .indexOf(String(name).toLowerCase().slice(0,3))+1;
const monthPattern='(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember|t)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const fullYearPatterns=[
 {re:/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g,parts:m=>[+m[1],+m[2],+m[3]]},
 {re:new RegExp('\\b'+monthPattern+'\\.?\\s+([0-3]?\\d)(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b','gi'),parts:m=>[+m[3],monthIndex(m[1]),+m[2]]},
 {re:new RegExp('\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+'+monthPattern+'\\.?[,]?\\s+(20\\d{2})\\b','gi'),parts:m=>[+m[3],monthIndex(m[2]),+m[1]]},
 {re:new RegExp('\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+'+monthPattern+'\\.?\\s+[\\u0027\\u2019](\\d{2})\\b','gi'),parts:m=>[2000+(+m[3]),monthIndex(m[2]),+m[1]]},
 {re:new RegExp('\\b'+monthPattern+'\\.?\\s+([0-3]?\\d)(?:st|nd|rd|th)?[,]?\\s+[\\u0027\\u2019](\\d{2})\\b','gi'),parts:m=>[2000+(+m[3]),monthIndex(m[1]),+m[2]]}
];
const monthDayPatterns=[
 {re:new RegExp('\\b'+monthPattern+'\\.?\\s+([0-3]?\\d)(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*20\\d{2})','gi'),parts:m=>[monthIndex(m[1]),+m[2]]},
 {re:new RegExp('\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+'+monthPattern+'\\b(?!\\.?\\s*20\\d{2})','gi'),parts:m=>[monthIndex(m[2]),+m[1]]}
];
const eventWords='(?:launch(?:es|ing)?|releas(?:e|es|ing)|beta|alpha|playtest|testnet|early[\\s-]access|presale|pre[\\s-]registration|registration|start(?:s|ing)?|begin(?:s|ning)?|open(?:s|ing)?|scheduled|slated|debut(?:s)?|goes live|go live|season\\s+\\d+|tournament|event|extraction mode)';
const beforeDate=new RegExp('\\b'+eventWords+'\\b[^.!?]{0,92}$','i');
const afterDate=new RegExp('^[^.!?]{0,45}\\b'+eventWords+'\\b','i');
const eventTypePattern=/\b(launch(?:es|ing)?|releas(?:e|es|ing)|playtest|early[\s-]access|beta|alpha|testnet|presale|pre[\s-]registration|tournament|season\s+\d+|event|opens?|starts?|begins?)\b/i;
const publicationOnly=/\b(?:published|posted|updated|last updated|created|listed|written by|copyright)\s*(?:on|at|:)?\s*$/i;
const stale=/\b(?:previously|originally|last year|already launched|already released|postponed|canceled|cancelled|rescheduled|was launched|was released)\b/i;
const normalizeLine=line=>line.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const checkedDate=(y,m,d)=>{
 const parsed=new Date(Date.UTC(y,m-1,d));
 return parsed.getUTCFullYear()===y&&parsed.getUTCMonth()+1===m&&parsed.getUTCDate()===d
  ? parsed.toISOString().slice(0,10):null;
};
export function extractUpcomingEventDate(text,now=new Date(),options={}) {
 const {today,until}=upcomingWindow(now);
 const out=[], matches=[];
 const reference=options.publishedDate?new Date(options.publishedDate):null;
 const reliableReference=reference&&Number.isFinite(reference.getTime()) &&
   reference.getTime()<=now.getTime()+86400e3 &&
   now.getTime()-reference.getTime()<=45*86400e3;
 const referenceYear=reliableReference?reference.getUTCFullYear():null;
 const lines=String(text??'').slice(0,120000).split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const raw=normalizeLine(lines[i]);
  if(!raw||raw.length>1100)continue;
  const prior=i>0?normalizeLine(lines[i-1]):'';
  // A deliberately labeled value may be on the line immediately after its field.
  const labeledPrior=/^(?:#+\s*)?(?:estimated\s+)?(?:launch|release|beta|alpha|playtest|early[\s-]access)\s+date\s*:?\s*$/i.test(prior);
  for(const fmt of [...fullYearPatterns,...(referenceYear?[...monthDayPatterns]:[])]){
   for(const m of raw.matchAll(fmt.re)){
    const left=raw.slice(Math.max(0,m.index-110),m.index);
    const right=raw.slice(m.index+m[0].length,m.index+m[0].length+55);
    if(publicationOnly.test(left))continue;
    const before=beforeDate.test(left),after=afterDate.test(right);
    if(!before&&!after&&!labeledPrior)continue;
    const isMonthOnly=monthDayPatterns.includes(fmt);
    const [year,month,day]=isMonthOnly?[referenceYear,...fmt.parts(m)]:fmt.parts(m);
    const date=checkedDate(year,month,day);
    if(!date)continue;
    // Inferred-year event dates must be later than the *article publication*;
    // the publication date is never itself the event date.
    if(isMonthOnly&&date<reference.toISOString().slice(0,10))continue;
    const snippet=(labeledPrior?prior+' ':'')+raw.slice(Math.max(0,m.index-85),Math.min(raw.length,m.index+m[0].length+50));
    if(stale.test(snippet))continue;
    const eventMatch=(left+' '+right).match(eventTypePattern);
    const eventType=labeledPrior?prior.replace(/[#:]/g,'').trim():(eventMatch?.[1]||'scheduled event');
    const evidence=snippet.trim().slice(0,220);
    matches.push({date,evidence,eventType,yearInferred:isMonthOnly,estimated:/\bestimat/i.test(prior+' '+raw)});
    if(date>=today&&date<=until)out.push(matches.at(-1));
   }
  }
 }
 out.sort((a,b)=>a.date.localeCompare(b.date)||
   Number(a.yearInferred)-Number(b.yearInferred));
 const best=out[0]||null;
 return {date:best?.date||null,evidence:best?.evidence||null,
   eventType:best?.eventType||null,yearInferred:best?.yearInferred||false,
   estimated:best?.estimated||false,
   matchedDates:matches.length,outOfWindow:matches.filter(x=>x.date<today||x.date>until).length};
}
function taggedDate(value,now=new Date()) {
 const info=extractUpcomingEventDate(value,now);
 return {eventDate:info.date||(info.matchedDates?'past-or-outside-window':null),
  evidence:info.evidence,eventType:info.eventType,
  yearInferred:info.yearInferred,estimated:info.estimated};
}
function datedEvent(value,now=new Date()){
 const match=extractUpcomingEventDate(value,now);
 return match.date||(match.matchedDates?'past-or-outside-window':null);
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

export function parseDirectoryMarkdown(source, markdown, now=new Date()) {
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
        ...taggedDate(after,now)});
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
        description:'Pre-release game listing on PlayToEarn',...taggedDate(line,now)});
    }
  } else if (source.id==='playtoearn-news') {
    // Only inspect the HEADLINE and the associated short teaser. Never pass
    // page-level metadata (including publication dates) as event-date evidence.
    const all=listingLinks(markdown,source.url)
      .filter(x=>new URL(x.url).hostname==='playtoearn.com'&&
        /^\/news\/[^/?#]+\/?$/.test(new URL(x.url).pathname)&&
        !/^(?:read more|continue reading|news|share|see more)$/i.test(x.title));
    const visited=new Set();
    for(const a of all.slice(0,220)){
      if(visited.has(a.url))continue;
      visited.add(a.url);
      if(!/\b(?:launch|release|playtest|beta|alpha|early access|opening|opens|starts|scheduled|event|season|tournament|debut|goes live)\b/i.test(a.title))continue;
      // Firecrawl news cards usually put the publication date immediately
      // before the linked headline. It is ONLY used as a year reference.
      const leading=markdown.slice(Math.max(0,a.index-175),a.index);
      const pubDates=[...leading.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember|t)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+([0-3]?\d),?\s+(20\d{2})\b/gi)];
      const stamp=pubDates.at(-1);
      const publishedDate=stamp?new Date(Date.UTC(+stamp[3],monthIndex(stamp[1])-1,+stamp[2])):null;
      const after=markdown.slice(a.index+a.length,a.index+a.length+360);
      const summary=after.split(/\n(?:#{1,4}\s+|\s*(?:News|Video|Press Release|by [A-Z][a-z]+)\s*$)/i)[0].slice(0,300);
      const result=extractUpcomingEventDate(a.title+'\n'+summary,now,{publishedDate});
      if(!result.date)continue;
      remember({
        title:a.title,url:a.url,status:'upcoming',eventDate:result.date,
        description:summary?trim(summary).slice(0,350):'Scheduled game announcement on PlayToEarn.',
        evidence:result.evidence,eventType:result.eventType,
        yearInferred:result.yearInferred,estimated:result.estimated,
        publishedAt:publishedDate?.toISOString().slice(0,10)||null
      });
    }
  } else if (source.id==='dappradar') {
    // Games rankings are typically ACTIVE games. Rank/activity is not evidence of future launch.
    // Only inspect card/row blocks containing an explicit upcoming/pre-release status.
    for (const block of markdown.split(/\n(?=\s*\|)/).slice(0,200)) {
      if (!statusPattern.test(block)||!/\b(?:upcoming|development|alpha|beta|presale|playtest|early access)\b/i.test(block)) continue;
      const a=linkFrom(block,(u)=>u.hostname==='dappradar.com' && /^\/dapp\//.test(u.pathname),source.url);
      if (a) remember({...a,status:block.match(statusPattern)[1].toLowerCase(),description:'Pre-release DappRadar gaming listing',...taggedDate(block,now)});
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
  return { id,title,url,status,eventDate:date,description:trim(entry.description).slice(0,350)||'Newly listed pre-release P2E/Web3 game. Verify status with the developer.',
    evidence:trim(entry.evidence||'').slice(0,220)||null,
    eventType:trim(entry.eventType||'').slice(0,70)||null,
    yearInferred:Boolean(entry.yearInferred),estimated:Boolean(entry.estimated),
    publishedAt:entry.publishedAt||null,
    sourceId,sourceName:source.name,date:now.toISOString() };
}
