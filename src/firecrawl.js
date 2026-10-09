import { parseDirectoryMarkdown, extractionDiagnostics, extractUpcomingEventDate } from './directories.js';

export async function fetchDirectory(source,{ request=fetch }={}) {
  const token=process.env.FIRECRAWL_API_KEY;
  if(!token) throw new Error('FIRECRAWL_API_KEY is not configured in Vercel Production.');
  const res=await request('https://api.firecrawl.dev/v2/scrape', {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({url:source.url,formats:['markdown'],onlyMainContent:true,timeout:25000}),
    signal:AbortSignal.timeout(32000)
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.success===false) throw new Error(`Firecrawl HTTP ${res.status}: ${String(json.error||json.message||'scrape failed').slice(0,180)}`);
  const md=json.data?.markdown||json.markdown;
  if(!md) throw new Error('Firecrawl scrape returned no markdown (blocked, changed or unavailable).');
  const listings=parseDirectoryMarkdown(source,md);
  return { rawLength:md.length,listings,diagnostics:extractionDiagnostics(source,md) };
}


// Page cards often omit dates. Some Magic Square projects put an estimated
// launch date on the app detail page. Check at most a small, budgeted set per
// scan (selected by the pipeline's persisted rotating cursor).
export async function fetchGameDetail(source, listing, { request=fetch }={}) {
  const allowed=new URL(source.url);
  const page=new URL(listing.url);
  if(page.protocol!=='https:'||page.hostname!==allowed.hostname)
    throw new Error('Refusing to fetch a detail page outside its directory domain.');
  const token=process.env.FIRECRAWL_API_KEY;
  if(!token)throw new Error('FIRECRAWL_API_KEY missing.');
  const res=await request('https://api.firecrawl.dev/v2/scrape', {
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({url:page.href,formats:['markdown'],onlyMainContent:true,timeout:18000}),
    signal:AbortSignal.timeout(23000)
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.success===false)
    throw new Error('Firecrawl detail HTTP '+res.status+': '+String(json.error||json.message||'scrape failed').slice(0,100));
  const md=json.data?.markdown||json.markdown;
  if(typeof md!=='string'||!md.trim())throw new Error('No detail-page text returned.');
  if(md.length>1000000)throw new Error('Detail page exceeds 1 MB.');
  const match=extractUpcomingEventDate(md);
  return {...match,bytes:md.length};
}
