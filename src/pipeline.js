import { sources, validateDiscovery } from './directories.js';
import { fetchDirectory } from './firecrawl.js';
import { state } from './store.js';
import { sendDiscord } from './discord.js';

export async function runScan({preview=false,deps={}}={}) {
  const storage=deps.state||state;
  const read=deps.fetchDirectory||fetchDirectory;
  const post=deps.sendDiscord||sendDiscord;
  const feeds=deps.sources||sources;
  const firstRunMode=process.env.FIRST_RUN_MODE==='post'?'post':'baseline';
  const maxPosts=Math.min(5,Math.max(1,Number(process.env.MAX_POSTS_PER_RUN||3)));
  const lock=preview?null:await storage.acquireLock();
  if(!preview&&!lock) return {ok:true,busy:true,message:'A previous scan is still running.'};
  try {
    const results=await Promise.all(feeds.map(async source=>{
      try{
        const {listings,rawLength}=await read(source);
        const accepted=listings.map(item=>validateDiscovery(source.id,item)).filter(Boolean);
        return {source,listings,accepted,rawLength};
      }catch(e){return {source,error:String(e.message||e).slice(0,180)};}
    }));
    const summary={ok:true,preview,sources:[],candidates:0,posted:0,seeded:0,errors:[]};
    for(const entry of results) {
      const {source,error,listings=[],accepted=[],rawLength=0}=entry;
      if(error){summary.errors.push({source:source.name,error});summary.sources.push({source:source.name,error});continue;}
      const info={source:source.name,bytes:rawLength,extracted:listings.length,eligible:accepted.length};
      summary.candidates+=accepted.length;
      // A zero on a known upcoming-oriented page is likely broken extraction,
      // not a valid first baseline. DappRadar may legitimately have no upcoming games.
      if(!listings.length && source.id!=='dappradar'){
        info.error='No listings parsed. Inspect source page or parser before using scan.';
        summary.errors.push({source:source.name,error:info.error});summary.sources.push(info);continue;
      }
      if(preview){ info.candidates=accepted.slice(0,5).map(x=>({title:x.title,status:x.status,date:x.eventDate,url:x.url})); summary.sources.push(info);continue; }
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
      let deliveryError=false;
      for(const item of accepted) {
        if(seen.has(item.id))continue;
        if(summary.posted>=maxPosts)break;
        const event=item.eventDate?`Event ${item.eventDate} (not independently verified)`:'Upcoming directory listing · date not announced';
        try {
          const messageId=await post({...item,date:new Date(),status:`${item.status} · ${event}`});
          await storage.markSeen(item.id,`posted:${messageId}`);
          summary.posted++;info.posted++;
        }catch(e){deliveryError=true;summary.errors.push({source:source.name,error:`Discord: ${String(e.message).slice(0,150)}`});break;}
      }
      if(!initialized && !deliveryError && firstRunMode==='post'){
        // Never drip-feed an old directory backlog on subsequent scans.
        await storage.markSeenMany(accepted.filter(x=>!seen.has(x.id)),'first-run-reviewed');
        await storage.markInitialized(source.id);
      }
      if(!initialized&&!deliveryError && firstRunMode==='baseline')await storage.markInitialized(source.id);
      summary.sources.push(info);
    }
    summary.ok=summary.errors.length===0;
    if(!preview)await storage.recordResult(summary);
    return summary;
  }finally{if(lock)await storage.releaseLock(lock).catch(e=>console.error('Redis lock release:',e));}
}
