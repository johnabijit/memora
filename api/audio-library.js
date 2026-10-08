const COMMONS_API='https://commons.wikimedia.org/w/api.php'
const RADIO_ROOT='https://de1.api.radio-browser.info'
const RADIO_API=RADIO_ROOT+'/json/stations/search'

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

async function hydrateCurated(){
  const titles=CURATED.map(([,file])=>'File:'+file).join('|')
  const params=new URLSearchParams({
    action:'query',
    titles,
    prop:'imageinfo',
    iiprop:'url|mime|extmetadata|derivatives',
    format:'json',
    formatversion:'2',
    origin:'*'
  })
  try{
    const response=await fetch(COMMONS_API+'?'+params.toString(),{
      headers:{'User-Agent':'Memora/1.0 (personal memory app)'}
    })
    if(!response.ok) return curatedItems()
    const data=await response.json()
    const pages=new Map((data?.query?.pages||[]).map(page=>[String(page.title||'').replace(/^File:/,''),page]))
    return CURATED.map(([title,file,category,license],index)=>{
      const page=pages.get(file)
      const info=page?.imageinfo?.[0]
      return {
        id:'curated-'+index,
        type:'nature',
        title,
        category,
        license:textOnly(info?.extmetadata?.LicenseShortName?.value||license),
        artist:textOnly(info?.extmetadata?.Artist?.value||'Wikimedia Commons contributor'),
        url:bestPlayable(info)||directFile(file),
        sourcePage:sourcePage(file),
        file,
        curated:true
      }
    })
  }catch{
    return curatedItems()
  }
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
  const terms=query?[query+' nature sound',query+' ambient sound'] : DEFAULT_TERMS
  const [curated,batches]=await Promise.all([
    hydrateCurated(),
    Promise.allSettled(terms.map(term=>commonsSearch(term,Math.ceil(target/terms.length)+4)))
  ])
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

async function fetchRadioRows(params){
  const response=await fetch(RADIO_API+'?'+params.toString(),{
    headers:{
      'User-Agent':'Memora/1.0 (personal memory app)',
      'Accept':'application/json'
    }
  })
  if(!response.ok) throw new Error('Radio Browser '+response.status)
  return await response.json()
}

function radioItem(row,category=''){
  const url=String(row.url_resolved||row.url||'')
  if(!url.startsWith('https://')) return null
  if(Number(row.lastcheckok)===0) return null
  const id=String(row.stationuuid||url)
  return {
    id:'radio-'+id,
    type:'radio',
    title:String(row.name||'Internet radio').trim(),
    category,
    country:String(row.country||'').trim(),
    countrycode:String(row.countrycode||'').trim().toUpperCase(),
    state:String(row.state||'').trim(),
    language:String(row.language||'').trim(),
    tags:String(row.tags||'').split(',').filter(Boolean).slice(0,8),
    bitrate:Number(row.bitrate||0),
    codec:String(row.codec||'').trim(),
    votes:Number(row.votes||0),
    clickcount:Number(row.clickcount||0),
    url,
    homepage:String(row.homepage||'').trim(),
    favicon:String(row.favicon||'').trim(),
    stationuuid:String(row.stationuuid||'')
  }
}

async function radioCountries(){
  const params=new URLSearchParams({
    hidebroken:'true',
    order:'stationcount',
    reverse:'true',
    limit:'400'
  })
  const response=await fetch(RADIO_ROOT+'/json/countrycodes?'+params.toString(),{
    headers:{
      'User-Agent':'Memora/1.0 (personal memory app)',
      'Accept':'application/json'
    }
  })
  if(!response.ok) throw new Error('Radio Browser '+response.status)
  const rows=await response.json()
  let names=null
  try{names=new Intl.DisplayNames(['en'],{type:'region'})}catch{}
  return (rows||[])
    .map(row=>{
      const code=String(row.name||'').trim().toUpperCase()
      if(!/^[A-Z]{2}$/.test(code)) return null
      let name=code
      try{name=names?.of(code)||code}catch{}
      return {code,name,stationcount:Number(row.stationcount||0)}
    })
    .filter(Boolean)
}

async function radioLibrary(query,limit,{random=false,offset=0,countrycode='',sort='popular'}={}){
  const target=Math.min(100,Math.max(10,limit||60))
  const q=String(query||'').trim()
  const country=String(countrycode||'').trim().toUpperCase()
  const order=random||sort==='random'?'random':'clickcount'
  const reverse=order==='random'?'false':'true'
  const base={
    hidebroken:'true',
    order,
    reverse,
    offset:String(Math.max(0,Number(offset)||0)),
    limit:String(Math.min(300,target*3))
  }

  const buildParams=extra=>{
    const params=new URLSearchParams(base)
    if(country) params.set('countrycode',country)
    for(const [key,value] of Object.entries(extra||{})){
      if(value) params.set(key,String(value))
    }
    return params
  }

  let batches=[]
  if(q){
    batches=await Promise.allSettled([
      fetchRadioRows(buildParams({name:q})),
      fetchRadioRows(buildParams({tag:q})),
      fetchRadioRows(buildParams({language:q}))
    ])
  }else{
    batches=[{status:'fulfilled',value:await fetchRadioRows(buildParams())}]
  }

  const items=[]
  const seen=new Set()
  for(const batch of batches){
    if(batch.status!=='fulfilled') continue
    for(const row of batch.value||[]){
      const item=radioItem(row,q)
      if(!item||seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }

  if(order!=='random'){
    items.sort((a,b)=>(b.clickcount-a.clickcount)||(b.votes-a.votes)||(b.bitrate-a.bitrate))
  }else{
    for(let i=items.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1))
      ;[items[i],items[j]]=[items[j],items[i]]
    }
  }

  return {
    items:items.slice(0,target),
    hasMore:items.length>=target,
    countrycode:country,
    sort:order==='random'?'random':'popular',
    offset:Math.max(0,Number(offset)||0)
  }
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed'},'no-store')
  const mode=String(req.query?.mode||'nature').toLowerCase()
  const query=String(req.query?.q||'').slice(0,80).trim()
  const limit=Math.min(100,Math.max(8,Number(req.query?.limit)||60))
  const random=String(req.query?.random??'0')==='1'
  const offset=Math.max(0,Number(req.query?.offset)||0)
  const countrycode=String(req.query?.countrycode||'').slice(0,2).toUpperCase()
  const sort=String(req.query?.sort||'popular').toLowerCase()==='random'?'random':'popular'
  try{
    if(mode==='countries'){
      const countries=await radioCountries()
      return json(res,200,{mode:'countries',count:countries.length,countries},'public, s-maxage=21600, stale-while-revalidate=86400')
    }
    if(mode==='radio'){
      const result=await radioLibrary(query,limit,{random,offset,countrycode,sort})
      return json(res,200,{
        mode:'radio',
        query,
        count:result.items.length,
        items:result.items,
        random:result.sort==='random',
        sort:result.sort,
        countrycode:result.countrycode,
        offset:result.offset,
        nextOffset:result.offset+result.items.length,
        hasMore:result.hasMore,
        liveDirectory:true,
        batchSize:limit
      },'no-store')
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
