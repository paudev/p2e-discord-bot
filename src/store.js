import { randomUUID } from 'node:crypto';

const namespace='cryptoph:p2e:firecrawl:v1';
const key=name=>`${namespace}:${name}`;
export const seenRetentionSeconds=()=>{
  const days=Number(process.env.SEEN_RETENTION_DAYS||90);
  return (Number.isInteger(days)?Math.max(7,Math.min(365,days)):90)*86400;
};
export async function command(...args) {
  const url=process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/,'');
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing.');
  const res=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  const body=await res.json().catch(()=>({}));
  if(!res.ok||body.error)throw new Error(`Upstash HTTP ${res.status}: ${String(body.error||'unknown').slice(0,120)}`);
  return body.result;
}
export async function pipeline(cmds){
  if(!cmds.length)return [];
  const url=process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/,'');
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw new Error('Upstash Redis credentials missing.');
  const res=await fetch(`${url}/pipeline`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(cmds),signal:AbortSignal.timeout(10000)});
  const body=await res.json().catch(()=>null);
  if(!res.ok||!Array.isArray(body)||body.some(x=>x.error)) throw new Error(`Upstash pipeline HTTP ${res.status}`);
  return body.map(x=>x.result);
}
export const state={
  async initialized(sourceId){return Boolean(await command('GET',key(`init:${sourceId}`)));},
  async markInitialized(sourceId){return command('SET',key(`init:${sourceId}`),new Date().toISOString());},
  async seenMany(items) {
    const found=new Set();
    for(let i=0;i<items.length;i+=100){
      const batch=items.slice(i,i+100);
      const values=await command('MGET',...batch.map(x=>key(`seen:${x.id}`)));
      batch.forEach((x,j)=>{if(values?.[j]!=null)found.add(x.id);});
    }
    return found;
  },
  async markSeen(id,status){return command('SET',key(`seen:${id}`),`${status}:${new Date().toISOString()}`,'EX',seenRetentionSeconds());},
  async markSeenMany(items,status){
    for(let i=0;i<items.length;i+=50){
      await pipeline(items.slice(i,i+50).map(x=>['SET',key(`seen:${x.id}`),`${status}:${new Date().toISOString()}`,'EX',seenRetentionSeconds()]));
    }
  },
  // Refresh active listings' TTL, so 90-day cleanup removes disappeared entries
  // without causing an unchanged upcoming listing to get re-announced after 90 days.
  async refreshSeenMany(items){
    for(let i=0;i<items.length;i+=50){
      await pipeline(items.slice(i,i+50).map(x=>['EXPIRE',key(`seen:${x.id}`),seenRetentionSeconds()]));
    }
  },
  async acquireLock(){
    const token=randomUUID();
    const result=await command('SET',key('lock'),token,'NX','EX',150);
    return result==='OK'?token:null;
  },
  async releaseLock(token){return command('EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,key('lock'),token);},
  async recordResult(summary){return command('SET',key('last-run'),JSON.stringify({at:new Date().toISOString(),...summary}),'EX',86400*7);}
};
