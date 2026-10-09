import { parseDirectoryMarkdown } from './directories.js';

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
  return { rawLength:md.length,listings };
}
