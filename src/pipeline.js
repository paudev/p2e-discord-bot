import { sources, validateDiscovery } from './directories.js';
import { fetchDirectory } from './firecrawl.js';
import { state } from './store.js';
import { sendDiscord } from './discord.js';

const compareUpcoming=(a,b)=>a.eventDate.localeCompare(b.eventDate)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id);

export async function runScan({preview=false,deps={}}={}) {
  const storage=deps.state||state;
  const read=deps.fetchDirectory||fetchDirectory;
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
        const accepted=listings.map(item=>validateDiscovery(source.id,item)).filter(Boolean).sort(compareUpcoming);
        return {source,listings,accepted,rawLength,diagnostics};
      }catch(e){return {source,error:String(e.message||e).slice(0,180)};}
    }));
    const summary={ok:true,preview,sources:[],candidates:0,posted:0,seeded:0,errors:[]};
    const queued=[];
    const firstRunPostSources=[];
    const sourceInfo=new Map();
    for(const entry of results) {
      const {source,error,listings=[],accepted=[],rawLength=0,diagnostics}=entry;
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
      if(!listings.length && source.id!=='dappradar'){
        info.error='No listings parsed. Inspect source page or parser before using scan.';
        summary.errors.push({source:source.name,error:info.error});summary.sources.push(info);continue;
      }
      if(preview){ info.candidates=accepted.slice(0,maxPosts).map(x=>({title:x.title,status:x.status,date:x.eventDate,url:x.url})); summary.sources.push(info);queued.push(...accepted);continue; }
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
        title:item.title,status:item.status,date:item.eventDate,url:item.url,source:item.sourceName
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
            status:item.status+' · Event '+item.eventDate+' (not independently verified)'});
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
      await storage.recordResult({...summary,ok:summary.errors.length===0});
    }
    summary.ok=summary.errors.length===0;
    return summary;
  }finally{if(lock)await storage.releaseLock(lock).catch(e=>console.error('Redis lock release:',e));}
}
