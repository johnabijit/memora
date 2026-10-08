const COMMONS='https://commons.wikimedia.org/w/api.php'

function send(res,status,body,cache='public, s-maxage=21600, stale-while-revalidate=86400'){
  res.statusCode=status
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control',cache)
  res.end(JSON.stringify(body))
}

function clean(value=''){
  return String(value).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim()
}

function allowedLicense(name=''){
  const value=String(name).toLowerCase()
  return value.includes('public domain')||value.includes('cc0')||value.includes('cc by')||value.includes('creative commons')
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'},'no-store')
  const raw=String(req.query?.q||'calm landscape').replace(/[^\p{L}\p{N}\s,'-]/gu,' ').replace(/\s+/g,' ').trim().slice(0,90)
  const query=raw||'calm landscape'
  const bucket=String(req.query?.bucket||new Date().toISOString().slice(0,13))
  try{
    const params=new URLSearchParams({
      action:'query',
      generator:'search',
      gsrsearch:query+' landscape',
      gsrnamespace:'6',
      gsrlimit:'24',
      prop:'imageinfo',
      iiprop:'url|size|mime|extmetadata',
      iiurlwidth:'1920',
      format:'json',
      formatversion:'2',
      origin:'*'
    })
    const response=await fetch(COMMONS+'?'+params.toString(),{headers:{'User-Agent':'Memora/1.0 (worldwide goodwill app)'}})
    if(!response.ok) throw new Error('Commons '+response.status)
    const data=await response.json()
    const items=(data?.query?.pages||[]).flatMap(page=>{
      const info=page?.imageinfo?.[0]
      const mime=String(info?.mime||'')
      if(!mime.startsWith('image/')) return []
      if(Number(info?.width||0)<1000||Number(info?.height||0)<600) return []
      const meta=info?.extmetadata||{}
      const license=clean(meta.LicenseShortName?.value||meta.UsageTerms?.value||'')
      if(license&&!allowedLicense(license)) return []
      const title=String(page.title||'').replace(/^File:/,'').replace(/_/g,' ')
      return [{
        id:page.pageid,
        title,
        url:info?.thumburl||info?.url,
        sourcePage:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(String(page.title||'').replace(/ /g,'_')),
        artist:clean(meta.Artist?.value||meta.Credit?.value||'Wikimedia Commons contributor'),
        license:license||'See source'
      }]
    })
    if(!items.length) return send(res,404,{error:'No open scene found for this query'},'public, s-maxage=1800')
    let hash=0
    for(const ch of bucket+query) hash=(hash*31+ch.charCodeAt(0))>>>0
    const item=items[hash%items.length]
    return send(res,200,{query,item,count:items.length})
  }catch(error){
    return send(res,502,{error:'Scene background is temporarily unavailable.'},'no-store')
  }
}