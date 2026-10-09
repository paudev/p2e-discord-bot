import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {sources,parseDirectoryMarkdown,validateDiscovery} from '../src/directories.js';
import {fetchDirectory} from '../src/firecrawl.js';
import {runScan} from '../src/pipeline.js';
import {seenRetentionSeconds} from '../src/store.js';

const old={...process.env};afterEach(()=>{process.env={...old};});
const magic=`# Validation Starting Soon
- [Upcoming](https://magicsquare.io/store/projects/black-snow)
[Black Snow](https://magicsquare.io/store/projects/black-snow)
Games • Play To Earn
A mobile RPG
[View](https://magicsquare.io/store/projects/black-snow)
- [Upcoming](https://magicsquare.io/store/projects/wallet)
[Wallet](https://magicsquare.io/store/projects/wallet)
DeFi • Wallet
A wallet
[View](https://magicsquare.io/store/projects/wallet)
- [Upcoming](https://magicsquare.io/store/projects/new-game)
[New Game](https://magicsquare.io/store/projects/new-game)
Games • GameFi
New 2026 game
`;
const playtoearn=`# New Blockchain Games List
| # | Name | Blockchain | Device | Status | F2P | P2E |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Live Game](https://playtoearn.com/blockchaingame/live-game) | Solana | Web | Live | Yes | Crypto |
| 2 | [New P2E](https://playtoearn.com/blockchaingame/new-p2e) | Solana | Web | Development | Yes | Crypto |
| 3 | [Alpha Game](https://playtoearn.com/blockchaingame/alpha-game) | Solana | Web | Alpha | Yes | NFT |
`;
const radar=`# Games Rankings
| [Bomb Crypto](https://dappradar.com/dapp/bomb-crypto) | $1.1m | +10% |
| [Future Game](https://dappradar.com/dapp/future-game) | Upcoming | 0 |
`;

test('Magic Square: only upcoming game cards',()=>{
 const result=parseDirectoryMarkdown(sources[0],magic);
 assert.deepEqual(result.map(i=>i.title),['Black Snow','New Game']);
});
test('PlayToEarn: development and alpha, never live',()=>{
 const result=parseDirectoryMarkdown(sources[1],playtoearn);
 assert.deepEqual(result.map(i=>i.title),['New P2E','Alpha Game']);
});
test('DappRadar: only explicitly pre-release',()=>{
 const result=parseDirectoryMarkdown(sources[2],radar);
 assert.deepEqual(result.map(i=>i.title),['Future Game']);
});
test('date window: reject already expired and too distant',()=>{
 process.env.UPCOMING_TIMEZONE='Asia/Manila';process.env.UPCOMING_WINDOW_DAYS='90';
 const base={title:'Soon',url:'https://magicsquare.io/store/projects/soon',status:'upcoming'};
 const now=new Date('2026-10-09T02:00:00Z');
 assert.ok(validateDiscovery('magic-square',{...base,eventDate:'2026-10-20'},now));
 assert.equal(validateDiscovery('magic-square',{...base,eventDate:'2025-01-01'},now),null);
 assert.equal(validateDiscovery('magic-square',{...base,eventDate:'2027-06-01'},now),null);
 assert.equal(validateDiscovery('magic-square',base,now),null);
 assert.equal(seenRetentionSeconds(),90*86400);
});
test('Firecrawl API request has expected path and authorization',async()=>{
 process.env.FIRECRAWL_API_KEY='test-key';let details;
 const output=await fetchDirectory(sources[0],{request:async (url,options)=>{
   details={url,options};
   return {ok:true,status:200,json:async()=>({success:true,data:{markdown:magic}})};
 }});
 assert.equal(details.url,'https://api.firecrawl.dev/v2/scrape');
 assert.equal(details.options.headers.Authorization,'Bearer test-key');
 assert.deepEqual(JSON.parse(details.options.body).formats,['markdown']);
 assert.equal(output.listings.length,2);
});
test('first scan baselines, subsequent scan posts newly added game only, preview read-only',async()=>{
 process.env.FIRST_RUN_MODE='baseline';
 let init=false,posts=0,writes=0;
 const seen=new Set();
 const store={
  acquireLock:async()=> 'token',releaseLock:async()=>{},
  initialized:async()=>init,markInitialized:async()=>{init=true;writes++},
  markSeenMany:async items=>{items.forEach(x=>seen.add(x.id));writes++},
  seenMany:async items=>new Set(items.filter(x=>seen.has(x.id)).map(x=>x.id)),
  refreshSeenMany:async()=>{},markSeen:async id=>{seen.add(id);writes++},recordResult:async()=>{}
 };
 const future=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
 let items=parseDirectoryMarkdown(sources[0],magic).slice(0,1).map(item=>({...item,eventDate:future}));
 const deps={sources:[sources[0]],fetchDirectory:async()=>({rawLength:100,listings:items}),state:store,sendDiscord:async()=>{posts++;return 'message-1';}};
 const preview=await runScan({preview:true,deps});assert.equal(preview.candidates,1);assert.equal(writes,0);
 const seeded=await runScan({deps});assert.equal(seeded.seeded,1);assert.equal(posts,0);
 const noDuplicate=await runScan({deps});assert.equal(noDuplicate.posted,0);
 items=parseDirectoryMarkdown(sources[0],magic).map(item=>({...item,eventDate:future}));
 const newScan=await runScan({deps});assert.equal(newScan.posted,1);
 await runScan({deps});assert.equal(posts,1);
});


test('PlayToEarn supports linked Alpha/Beta statuses and excludes Live / No-P2E',()=>{
 const sample='| 1 | [New Hero](https://playtoearn.com/blockchaingame/new-hero) | | | [Alpha](https://playtoearn.com/status/alpha) | Yes | Crypto |\n'
 +'| 2 | [Old Live](https://playtoearn.com/blockchaingame/live) | | | [Live](https://playtoearn.com/status/live) | Yes | Crypto |\n'
 +'| 3 | [Non P2E](https://playtoearn.com/blockchaingame/non-p2e) | | | [Beta](https://playtoearn.com/status/beta) | Yes | No |';
 assert.deepEqual(parseDirectoryMarkdown(sources[1],sample).map(x=>x.title),['New Hero']);
});
test('Magic Square accepts plain Upcoming badge but excludes non-games',()=>{
 const sample='# Validation Starting Soon\nUpcoming\n'
 +'[Black Snow](https://magicsquare.io/store/projects/black-snow)\nGames • Play To Earn\nAR game\n'
 +'[View](https://magicsquare.io/store/projects/black-snow)\nUpcoming\n'
 +'[StakeLayer](https://magicsquare.io/store/projects/stakelayer)\nDeFi • Staking\n'
 +'[View](https://magicsquare.io/store/projects/stakelayer)\nUpcoming\n'
 +'[Greendale](https://magicsquare.io/store/projects/greendale)\nGames • GameFi\nFarm game\n';
 assert.deepEqual(parseDirectoryMarkdown(sources[0],sample).map(x=>x.title),['Black Snow','Greendale']);
});


test('strict dated-only game events: old, missing, invalid or far-away dates are rejected',()=>{
 const now=new Date();
 const near=new Date(now.getTime()+14*86400000).toISOString().slice(0,10);
 const old=new Date(now.getTime()-14*86400000).toISOString().slice(0,10);
 const far=new Date(now.getTime()+200*86400000).toISOString().slice(0,10);
 const src=sources[0];
 const card=text=> '[Test Game](https://magicsquare.io/store/projects/test-game)\nGames • GameFi\n'+text;
 const getDate=text=>parseDirectoryMarkdown(src,card(text))[0]?.eventDate;
 assert.equal(getDate('Beta launches on '+near),near);
 assert.equal(getDate('Beta launches on '+old),'past-or-outside-window');
 assert.equal(getDate('Beta launches on '+far),'past-or-outside-window');
 assert.equal(getDate('Upcoming, no confirmed release date'),null);
 const monthName=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'})
   .format(new Date(near+'T00:00:00Z'));
 assert.equal(getDate('Playtest starts '+monthName),near);
 const base={title:'Test Game',url:'https://magicsquare.io/store/projects/test-game',status:'upcoming'};
 assert.equal(validateDiscovery(src.id,base,now),null);
 assert.equal(validateDiscovery(src.id,{...base,eventDate:old},now),null);
 assert.equal(validateDiscovery(src.id,{...base,eventDate:'2026-02-30'},now),null);
 assert.equal(validateDiscovery(src.id,{...base,eventDate:far},now),null);
 assert.ok(validateDiscovery(src.id,{...base,eventDate:near},now));
 const a=validateDiscovery(src.id,{...base,eventDate:near},now);
 const other=new Date(now.getTime()+15*86400000).toISOString().slice(0,10);
 assert.notEqual(a.id,validateDiscovery(src.id,{...base,eventDate:other},now).id);
});
test('nearest five dated upcoming events win globally, regardless of source order',async()=>{
 process.env.FIRST_RUN_MODE='post';process.env.MAX_POSTS_PER_RUN='5';
 const today=Date.now();
 const date=n=>new Date(today+n*86400000).toISOString().slice(0,10);
 const groups=[
  {source:sources[0],numbers:[10,12,14,16,18]},
  {source:sources[1],numbers:[1,3,5]},
  {source:sources[2],numbers:[2,4,6]}
 ];
 const listings=new Map(groups.map(({source,numbers})=>[source.id,numbers.map((n,i)=>({
   title:source.id+' '+i,
   url:source.id==='magic-square'?'https://magicsquare.io/store/projects/game-'+i:
     source.id==='playtoearn'?'https://playtoearn.com/blockchaingame/game-'+i:
       'https://dappradar.com/dapp/game-'+i,
   status:'upcoming',eventDate:date(n)
 }))]));
 const initiallyUnseeded=new Set(groups.map(x=>x.source.id)),seen=new Set(),delivered=[];
 const store={
  acquireLock:async()=> 'token',releaseLock:async()=>{},
  initialized:async id=>!initiallyUnseeded.has(id),
  markInitialized:async id=>{initiallyUnseeded.delete(id)},
  markSeenMany:async items=>{for(const item of items)seen.add(item.id)},
  seenMany:async items=>new Set(items.filter(x=>seen.has(x.id)).map(x=>x.id)),
  refreshSeenMany:async()=>{},markSeen:async id=>{seen.add(id)},
  recordResult:async()=>{}
 };
 const deps={
  sources:groups.map(x=>x.source),state:store,
  fetchDirectory:async source=>({rawLength:100,listings:listings.get(source.id)}),
  sendDiscord:async item=>{delivered.push(item.eventDate);return 'sent-'+delivered.length;}
 };
 const preview=await runScan({preview:true,deps});
 assert.deepEqual(preview.topCandidates.map(x=>x.date),[1,2,3,4,5].map(date));
 assert.equal(preview.posted,0);
 const real=await runScan({deps});
 assert.equal(real.posted,5);
 assert.deepEqual(delivered,[1,2,3,4,5].map(date));
});
test('PlayToEarn game rows support link titles containing pipes',()=>{
 const line='| | 3 | [**Computers Rh**](https://playtoearn.com/blockchaingame/computers-rh "Computers Rh - Game | PlayToEarn") | [Alpha](https://playtoearn.com/alpha "Alpha") | Yes | Crypto |';
 const parsed=parseDirectoryMarkdown(sources[1],line);
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].title,'Computers Rh');
});


test('Magic Square 2-digit estimated launch dates are parsed, expired ones rejected',()=>{
 const sample='This is an upcoming app, and it is not yet live or validated by community. The estimated launch date is 31 Mar '+String.fromCharCode(39)+'26.';
 const now=new Date('2026-10-10T00:00:00Z');
 const past=parseDirectoryMarkdown(sources[0],
   '[Old Game](https://magicsquare.io/store/projects/old-game)\nGames • PvP\n'+sample)[0];
 assert.equal(past.eventDate,'past-or-outside-window');
 assert.equal(validateDiscovery('magic-square',past,now),null);
 const future=parseDirectoryMarkdown(sources[0],
   '[New Game](https://magicsquare.io/store/projects/new-game)\nGames • PvP\nEstimated launch date is 31 Dec '+String.fromCharCode(39)+'26.')[0];
 assert.equal(future.eventDate,'2026-12-31');
 assert.ok(validateDiscovery('magic-square',future,now));
});
test('detail-page enrichment in preview never writes to Redis; cached dates persist',async()=>{
 process.env.MAX_DETAIL_PAGES_PER_RUN='2';process.env.FIRST_RUN_MODE='baseline';
 const dt=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 const items=[{title:'Next Event',url:'https://magicsquare.io/store/projects/next-event',status:'upcoming',eventDate:null},
 {title:'Undated Game',url:'https://magicsquare.io/store/projects/undated',status:'upcoming',eventDate:null}];
 const cache=new Map(),seen=new Set(),stats={reads:0,writes:0,detailCalls:0},initial=new Set();
 const store={
  acquireLock:async()=> 'token',releaseLock:async()=>{},
  reserveDetailOffset:async()=>{stats.writes++;return 0;},
  detailCacheMany:async candidates=>{stats.reads++;return new Map(candidates.filter(x=>cache.has(x.url)).map(x=>[x.url,cache.get(x.url)]));},
  saveDetailResult:async(item,out)=>{stats.writes++;cache.set(item.url,{date:out.date||null});},
  initialized:async id=>initial.has(id),markInitialized:async id=>{initial.add(id);stats.writes++;},
  markSeenMany:async items=>{items.forEach(x=>seen.add(x.id));stats.writes++;},
  seenMany:async items=>new Set(items.filter(x=>seen.has(x.id)).map(x=>x.id)),
  refreshSeenMany:async()=>{},markSeen:async id=>{seen.add(id);stats.writes++;},
  recordResult:async()=>{}
 };
 const deps={sources:[sources[0]],state:store,fetchDirectory:async()=>({listings:items.map(x=>({...x})),rawLength:800}),
  fetchGameDetail:async(_,entry)=>{stats.detailCalls++;return {date:entry.title==='Next Event'?dt:null,matchedDates:1,outOfWindow:0,bytes:500};},
  sendDiscord:async()=>{throw Error('Baseline must not post');}
 };
 const preview=await runScan({preview:true,deps});
 assert.equal(preview.candidates,1);assert.equal(stats.writes,0);assert.equal(stats.reads,0);
 assert.equal(preview.detailChecks.length,2);
 const baseline=await runScan({deps});
 assert.equal(baseline.seeded,1);
 const detailCallsAfterBaseline=stats.detailCalls;
 const repeat=await runScan({deps});
 assert.equal(repeat.candidates,1);assert.equal(repeat.posted,0);
 assert.equal(stats.detailCalls,detailCallsAfterBaseline);
 assert.equal(repeat.cachedDetailCount,2);
});
