import { sources, validateDiscovery } from './directories.js';
import { fetchDirectory, fetchGameDetail } from './firecrawl.js';
import { state } from './store.js';
import { sendDiscord } from './discord.js';

const compareUpcoming=(a,b)=>a.eventDate.localeCompare(b.eventDate)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id);

export async function runScan({preview=false,detailOffset=0,deps={}}={}) {
  const storage=deps.state||state;
  const read=deps.fetchDirectory||fetchDirectory;
  const readDetail=deps.fetchGameDetail||fetchGameDetail;
  const post=deps.sendDiscord||sendDiscord;
  const feeds=deps.sources||sources;
  const firstRunMode=process.env.FIRST_RUN_MODE==='post'?'post':'baseline';
  const maxPosts=Math.min(5,Math.max(1,Number(process.env.MAX_POSTS_PER_RUN||5)));
  const lock=preview?null:await storage.acquireLock();
  if(!preview&&!lock) return {ok:true,busy:true,message:'A previous scan is still running.'};
  try {
    const results=await Promise.all(feeds.map(async source=>{
      try{
        const {listings,rawLength,diagnostics}=await read(source);
        // Details are enriched below, before validation and global ranking.
        const accepted=listings;
        return {source,listings,accepted,rawLength,diagnostics};
      }catch(e){return {source,error:String(e.message||e).slice(0,180)};}
    }));
    // Redis retains successfully extracted detail dates between scans.
    // Without this, a game discovered from a detail page would disappear
    // from the next scan's candidate queue when only directory cards refresh.
    let cachedDetailCount=0;
    if(!preview&&typeof storage.detailCacheMany==='function') {
      const every=results.filter(x=>!x.error).flatMap(x=>x.listings.filter(item=>!item.eventDate));
      const cache=await storage.detailCacheMany(every);
      for(const item of every){
        const saved=cache.get(item.url);
        if(!saved)continue;
        item._detailCached=true;
        cachedDetailCount++;
        if(saved.date){
          item.eventDate=saved.date;
          item.evidence=saved.evidence||null;
          item.eventType=saved.eventType||null;
          item.estimated=!!saved.estimated;
          item.yearInferred=!!saved.yearInferred;
        }
      }
    }
    // Existing directory cards normally show no dates. Inspect a small set of
    // individual game pages each run, rotating via Redis so the same two games
    // are not repeatedly checked. Preview is read-only and uses a query offset.
    const rawBudget=Number(process.env.MAX_DETAIL_PAGES_PER_RUN??2);
    const detailBudget=Number.isInteger(rawBudget)?Math.max(0,Math.min(5,rawBudget)):2;
    const pools=results.filter(x=>!x.error).map(x=>({
      source:x.source,items:x.listings.filter(item=>!item.eventDate&&!item._detailCached)
    }));
    const detailPool=[];
    let index=0;
    while(pools.some(p=>index<p.items.length)){
      for(const group of pools) {
        if(index<group.items.length)detailPool.push({source:group.source,entry:group.items[index]});
      }
      index++;
    }
    let checkedOffset=0;
    const detailChecks=[];
    if(detailBudget&&detailPool.length) {
      checkedOffset=preview?Math.max(0,Math.min(100000,Number(detailOffset)||0)):
        typeof storage.reserveDetailOffset==='function'?await storage.reserveDetailOffset(detailBudget):0;
      const chosen=[];
      for(let n=0;n<Math.min(detailBudget,detailPool.length);n++)
        chosen.push(detailPool[(checkedOffset+n)%detailPool.length]);
      const checks=await Promise.all(chosen.map(async ({source,entry})=>{
        try {
          const value=await readDetail(source,entry);
          if(!preview&&typeof storage.saveDetailResult==='function')
            await storage.saveDetailResult(entry,value);
          if(value.date){
            entry.eventDate=value.date;
            entry.evidence=value.evidence||null;
            entry.eventType=value.eventType||null;
            entry.estimated=Boolean(value.estimated);
            entry.yearInferred=Boolean(value.yearInferred);
          }
          return {source:source.name,title:entry.title,url:entry.url,
            date:value.date||null,eventType:value.eventType||null,evidence:value.evidence||null,
            estimated:!!value.estimated,yearInferred:!!value.yearInferred,matchedDates:value.matchedDates||0,
            outOfWindow:value.outOfWindow||0,bytes:value.bytes||0};
        } catch(err) {
          return {source:source.name,title:entry.title,url:entry.url,error:String(err.message||err).slice(0,140)};
        }
      }));
      detailChecks.push(...checks);
    }
    const summary={ok:true,preview,sources:[],candidates:0,posted:0,seeded:0,errors:[],
      detailChecks,detailOffset:checkedOffset,detailPoolSize:detailPool.length,detailBudget,cachedDetailCount};
    const queued=[];
    const firstRunPostSources=[];
    const sourceInfo=new Map();
    for(const entry of results) {
      const {source,error,listings=[],rawLength=0,diagnostics}=entry;
      const accepted=listings.map(item=>validateDiscovery(source.id,item)).filter(Boolean).sort(compareUpcoming);
      if(error){summary.errors.push({source:source.name,error});summary.sources.push({source:source.name,error});continue;}
      const discardedUndated=listings.filter(x=>!x.eventDate).length;
      const discardedOutOfWindow=listings.filter(x=>x.eventDate==='past-or-outside-window').length;
      const info={source:source.name,bytes:rawLength,extracted:listings.length,eligible:accepted.length,
        discardedUndated,discardedOutOfWindow,
        discardedOther:Math.max(0,listings.length-accepted.length-discardedUndated-discardedOutOfWindow)};
      sourceInfo.set(source.id,info);
      if(preview&&diagnostics) info.diagnostics=diagnostics;
      summary.candidates+=accepted.length;
      // A zero on a known upcoming-oriented page is likely broken extraction,
      // not a valid first baseline. DappRadar may legitimately have no upcoming games.
      if(!listings.length && source.id!=='dappradar' && source.id!=='playtoearn-news'){
        info.error='No listings parsed. Inspect source page or parser before using scan.';
        summary.errors.push({source:source.name,error:info.error});summary.sources.push(info);continue;
      }
      if(preview){ info.candidates=accepted.slice(0,maxPosts).map(x=>({title:x.title,status:x.status,date:x.eventDate,
          eventType:x.eventType||null,evidence:x.evidence||null,estimated:!!x.estimated,
          yearInferred:!!x.yearInferred,publishedAt:x.publishedAt||null,url:x.url})); summary.sources.push(info);queued.push(...accepted);continue; }
      const initialized=await storage.initialized(source.id);
      if(!initialized && firstRunMode==='baseline'){
        await storage.markSeenMany(accepted,'baseline');
        await storage.markInitialized(source.id);
        summary.seeded+=accepted.length;
        info.seeded=accepted.length;
        summary.sources.push(info);continue;
      }
      const seen=await storage.seenMany(accepted);
      const already=accepted.filter(x=>seen.has(x.id));
      await storage.refreshSeenMany(already);
      info.alreadySeen=already.length;
      info.posted=0;
      // Defer posting until all sources have been checked and globally sorted.
      queued.push(...accepted.filter(item=>!seen.has(item.id)));
      if(!initialized&&firstRunMode==='post')firstRunPostSources.push({source,accepted});
      summary.sources.push(info);
    }
    // Rank the combined results, so a near launch from PlayToEarn outranks
    // a farther event from Magic Square even if Magic Square was fetched first.
    queued.sort(compareUpcoming);
    if(preview) {
      summary.topCandidates=queued.slice(0,maxPosts).map(item=>({
        title:item.title,status:item.status,date:item.eventDate,url:item.url,source:item.sourceName,
        evidence:item.evidence||null,eventType:item.eventType||null,
        estimated:!!item.estimated,yearInferred:!!item.yearInferred,publishedAt:item.publishedAt||null
      }));
    } else {
      const failedSources=new Set();
      const postedIds=new Set();
      for(const item of queued) {
        if(summary.posted>=maxPosts)break;
        if(!item.eventDate)continue; // Defense in depth: never post undated entries.
        const info=sourceInfo.get(item.sourceId);
        try {
          const messageId=await post({...item,date:new Date(),
            status:(item.estimated?'Estimated ':'Scheduled ')+(item.eventType||'event')+' · '+item.eventDate+' (source reported; not independently verified)'});
          await storage.markSeen(item.id,'posted:'+messageId);
          postedIds.add(item.id);
          summary.posted++;
          if(info)info.posted=(info.posted||0)+1;
        }catch(e){
          failedSources.add(item.sourceId);
          summary.errors.push({source:item.sourceName,error:'Discord: '+String(e.message).slice(0,150)});
        }
      }
      // As before, FIRST_RUN_MODE=post doesn't drip-feed existing backlog.
      for(const {source,accepted} of firstRunPostSources) {
        if(failedSources.has(source.id))continue;
        await storage.markSeenMany(accepted.filter(item=>!postedIds.has(item.id)),'first-run-reviewed');
        await storage.markInitialized(source.id);
      }
      // Write the final status below after distinguishing partial source failures.
      await storage.recordResult({...summary,partial:summary.errors.some(x=>!String(x.error).startsWith('Discord:')),
        ok:summary.sources.some(x=>!x.error)&&!summary.errors.some(x=>String(x.error).startsWith('Discord:'))});
    }
    // Continue delivering dated events from healthy sources while disclosing
    // every failed parser/provider. A delivery failure or all sources failing
    // still makes the run fail.
    summary.partial=summary.errors.some(x=>!String(x.error).startsWith('Discord:'));
    summary.ok=summary.sources.some(x=>!x.error)&&
      !summary.errors.some(x=>String(x.error).startsWith('Discord:'));
    return summary;
  }finally{if(lock)await storage.releaseLock(lock).catch(e=>console.error('Redis lock release:',e));}
}
