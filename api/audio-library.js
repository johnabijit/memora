const COMMONS_API='https://commons.wikimedia.org/w/api.php'
const RADIO_API='https://de1.api.radio-browser.info/json/stations/search'

const CURATED=[
  ['Rain, thunder and birds','Rainthunderandbirds.ogg','Rain','Public domain'],
  ['Ocean waves on a tropical beach','Ocean_Waves_on_a_Tropical_Beach.ogg','Ocean','CC0'],
  ['Lake waves','Waves.ogg','Ocean','Public domain'],
  ['Forest birds','Birds_forest.ogg','Forest','Public domain'],
  ['Walk in the rainforest','Walk_in_the_rainforest.ogg','Forest','Public domain'],
  ['Rain and thunder','Rain_and_thunder.ogg','Thunder','Public domain'],
  ['Heavy rain','Rain_(1).ogg','Rain','Public domain'],
  ['Ocean waves on shore','Oceanwavescrushing.ogg','Ocean','CC BY 3.0']
]

const DEFAULT_TERMS=[
  'rain nature sound','forest birds sound','ocean waves sound','night crickets sound',
  'thunderstorm sound','river stream sound','wind trees sound','birds forest sound',
  'waterfall sound','beach waves sound'
]

function json(res,status,body,cache='public, s-maxage=3600, stale-while-revalidate=86400'){
  res.statusCode=status
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control',cache)
  res.end(JSON.stringify(body))
}

function textOnly(value=''){
  return String(value).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
}

function directFile(name){
  return 'https://commons.wikimedia.org/wiki/Special:Redirect/file/'+encodeURIComponent(name)
}

function sourcePage(name){
  return 'https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(name.replace(/ /g,'_'))
}

function curatedItems(){
  return CURATED.map(([title,file,category,license],index)=>({
    id:'curated-'+index,
    type:'nature',
    title,
    category,
    license,
    artist:'Wikimedia Commons contributor',
    url:directFile(file),
    sourcePage:sourcePage(file),
    file,
    curated:true
  }))
}

function bestPlayable(info){
  const derivatives=Array.isArray(info?.derivatives)?info.derivatives:[]
  const mp3=derivatives.find(item=>String(item.type||'').includes('mpeg'))
  const ogg=derivatives.find(item=>String(item.type||'').includes('ogg'))
  return mp3?.src||ogg?.src||info?.url||null
}

async function commonsSearch(term,limit){
  const params=new URLSearchParams({
    action:'query',
    generator:'search',
    gsrsearch:term+' filetype:audio',
    gsrnamespace:'6',
    gsrlimit:String(Math.min(25,Math.max(4,limit))),
    prop:'imageinfo',
    iiprop:'url|mime|extmetadata|derivatives',
    format:'json',
    formatversion:'2',
    origin:'*'
  })
  const response=await fetch(COMMONS_API+'?'+params.toString(),{
    headers:{'User-Agent':'Memora/1.0 (personal memory app)'}
  })
  if(!response.ok) throw new Error('Commons '+response.status)
  const data=await response.json()
  return (data?.query?.pages||[]).flatMap(page=>{
    const info=page?.imageinfo?.[0]
    const mime=String(info?.mime||'')
    const url=bestPlayable(info)
    if(!url||(!mime.startsWith('audio/')&&!/\.(ogg|oga|mp3|wav|flac)(\?|$)/i.test(url))) return []
    const meta=info?.extmetadata||{}
    const title=String(page.title||'').replace(/^File:/,'').replace(/_/g,' ').replace(/\.(ogg|oga|mp3|wav|flac)$/i,'').trim()
    const license=textOnly(meta.LicenseShortName?.value||meta.UsageTerms?.value||'See source')
    const artist=textOnly(meta.Artist?.value||meta.Credit?.value||'Wikimedia Commons contributor')
    return [{
      id:'commons-'+page.pageid,
      type:'nature',
      title,
      category:term.replace(/ sound| nature/gi,'').trim(),
      license,
      artist,
      url,
      sourcePage:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(String(page.title||'').replace(/ /g,'_')),
      curated:false
    }]
  })
}

async function natureLibrary(query,limit){
  const target=Math.min(100,Math.max(8,limit||60))
  const curated=curatedItems()
  const terms=query?[query+' nature sound',query+' ambient sound'] : DEFAULT_TERMS
  const batches=await Promise.allSettled(terms.map(term=>commonsSearch(term,Math.ceil(target/terms.length)+4)))
  const seen=new Set()
  const items=[]
  for(const item of curated){
    if(items.length>=target) break
    seen.add(item.title.toLowerCase())
    items.push(item)
  }
  for(const batch of batches){
    if(batch.status!=='fulfilled') continue
    for(const item of batch.value){
      const key=item.title.toLowerCase()
      if(seen.has(key)) continue
      seen.add(key)
      items.push(item)
      if(items.length>=target) break
    }
    if(items.length>=target) break
  }
  return items
}

async function radioLibrary(query,limit){
  const target=Math.min(100,Math.max(10,limit||60))
  const q=(query||'ambient').trim()
  const params=new URLSearchParams({
    tag:q,
    hidebroken:'true',
    order:'clickcount',
    reverse:'true',
    limit:String(target*2)
  })
  const response=await fetch(RADIO_API+'?'+params.toString(),{
    headers:{
      'User-Agent':'Memora/1.0 (personal memory app)',
      'Accept':'application/json'
    }
  })
  if(!response.ok) throw new Error('Radio Browser '+response.status)
  const rows=await response.json()
  const items=[]
  const seen=new Set()
  for(const row of rows||[]){
    const url=String(row.url_resolved||row.url||'')
    if(!url.startsWith('https://')) continue
    if(Number(row.lastcheckok)===0) continue
    const id=String(row.stationuuid||url)
    if(seen.has(id)) continue
    seen.add(id)
    items.push({
      id:'radio-'+id,
      type:'radio',
      title:String(row.name||'Internet radio').trim(),
      category:q,
      country:String(row.country||'').trim(),
      language:String(row.language||'').trim(),
      tags:String(row.tags||'').split(',').filter(Boolean).slice(0,6),
      bitrate:Number(row.bitrate||0),
      codec:String(row.codec||'').trim(),
      url,
      homepage:String(row.homepage||'').trim(),
      favicon:String(row.favicon||'').trim(),
      stationuuid:String(row.stationuuid||'')
    })
    if(items.length>=target) break
  }
  return items
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed'},'no-store')
  const mode=String(req.query?.mode||'nature').toLowerCase()
  const query=String(req.query?.q||'').slice(0,80).trim()
  const limit=Math.min(100,Math.max(8,Number(req.query?.limit)||60))
  try{
    if(mode==='radio'){
      const items=await radioLibrary(query,limit)
      return json(res,200,{mode:'radio',query:query||'ambient',count:items.length,items})
    }
    const items=await natureLibrary(query,limit)
    return json(res,200,{mode:'nature',query,count:items.length,items})
  }catch(error){
    if(mode==='nature'){
      const items=curatedItems()
      return json(res,200,{mode:'nature',query,count:items.length,items,fallback:true})
    }
    return json(res,502,{error:'The live radio directory is temporarily unavailable. Try again shortly.'},'no-store')
  }
}
