// Cloudflare Pages adapter for the existing Memora Vercel API logic.
let env={};
function makeResponse(){let statusCode=200;const headers=new Headers();let body='';return {get statusCode(){return statusCode},set statusCode(v){statusCode=v},setHeader(k,v){headers.set(k,String(v))},status(v){statusCode=v;return this},end(v=''){body=v;return this},toResponse(){return new Response(body,{status:statusCode,headers})}}}
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

async function radioLanguages(){
  const params=new URLSearchParams({
    hidebroken:'true',
    order:'stationcount',
    reverse:'true',
    limit:'500'
  })
  const response=await fetch(RADIO_ROOT+'/json/languages?'+params.toString(),{
    headers:{
      'User-Agent':'Memora/1.0 (personal memory app)',
      'Accept':'application/json'
    }
  })
  if(!response.ok) throw new Error('Radio Browser '+response.status)
  const rows=await response.json()
  return (rows||[])
    .map(row=>({
      name:String(row.name||'').trim(),
      stationcount:Number(row.stationcount||0)
    }))
    .filter(row=>row.name&&row.stationcount>0)
    .sort((a,b)=>b.stationcount-a.stationcount||a.name.localeCompare(b.name))
}


const DEVOTIONAL_LIBRARY={
  all_faiths:{
    label:'All faiths and spiritual',
    terms:['devotional','spiritual','christian','gospel','worship','catholic','quran','nasheed','sufi','qawwali','bhajan','gurbani','buddhist','jewish','jain'],
    description:'A mixed worldwide discovery view across faith and spiritual programming'
  },
  christian:{
    label:'Christian',
    terms:['christian','gospel','worship','praise','hymn','jesus','christian contemporary','christian music','ccm','christian radio','christian songs','christian worship music','christian praise'],
    description:'Christian music, contemporary worship, praise, gospel, hymns and teaching'
  },
  catholic:{
    label:'Catholic',
    terms:['catholic','catholic radio','rosary','mass','gregorian','gregorian chant','marian','eucharist','catholic music','catholic hymns'],
    description:'Catholic radio, hymns, prayer, rosary, Mass and liturgical music'
  },
  orthodox:{
    label:'Orthodox Christian',
    terms:['orthodox christian','orthodox','byzantine chant','orthodox chant','orthodox hymns','eastern christian'],
    description:'Orthodox Christian radio and sacred chant'
  },
  protestant:{
    label:'Protestant',
    terms:['protestant','evangelical','christian worship','christian teaching','baptist','methodist','lutheran','anglican','reformed christian'],
    description:'Protestant, evangelical, worship and Christian teaching stations'
  },
  pentecostal:{
    label:'Pentecostal',
    terms:['pentecostal','charismatic christian','gospel worship'],
    description:'Pentecostal, charismatic and gospel worship programming'
  },
  adventist:{
    label:'Adventist',
    terms:['adventist','seventh day adventist','sda christian'],
    description:'Adventist Christian music, teaching and worship'
  },
  christian_prayer:{
    label:'Christian prayer and teaching',
    terms:['christian prayer','bible radio','christian sermon','scripture','christian teaching','prayer radio','bible teaching'],
    description:'Christian prayer, Bible readings, sermons, scripture and teaching'
  },
  gregorian:{
    label:'Gregorian chant',
    terms:['gregorian chant','gregorian','latin chant','catholic chant','sacred chant'],
    description:'Gregorian, Latin and Catholic sacred chant'
  },
  islamic:{
    label:'Islamic',
    terms:['islamic','quran','quran recitation','nasheed','islam','islamic radio','islamic devotional'],
    description:'Quran, nasheed and Islamic religious radio'
  },
  sufi:{
    label:'Sufi and Qawwali',
    terms:['sufi','qawwali','sufi music','sufi devotional','qawwali radio'],
    description:'Sufi devotional music and qawwali'
  },
  ghazal:{
    label:'Ghazal',
    terms:['ghazal','ghazals','urdu ghazal','hindi ghazal'],
    description:'Ghazal stations and related music, including secular and spiritual programming'
  },
  hindu:{
    label:'Hindu',
    terms:['hindu','bhajan','kirtan','mantra','bhakti','hindu devotional','devotional songs','temple music','aarti'],
    description:'Bhajan, kirtan, mantra, bhakti and Hindu devotional music'
  },
  carnatic_devotional:{
    label:'Carnatic devotional',
    terms:['carnatic devotional','carnatic bhakti','south indian devotional','carnatic spiritual'],
    description:'South Indian classical devotional and bhakti music'
  },
  sikh:{
    label:'Sikh and Gurbani',
    terms:['gurbani','sikh','sikh radio','gurbani kirtan','shabad','shabad kirtan','gurdwara'],
    description:'Gurbani, shabad and Sikh devotional kirtan'
  },
  buddhist:{
    label:'Buddhist',
    terms:['buddhist','buddhism','buddhist chant','dharma','zen','tibetan buddhist'],
    description:'Buddhist chants, teachings, dharma and meditation programming'
  },
  jewish:{
    label:'Jewish',
    terms:['jewish','judaism','hebrew','torah','jewish music','jewish radio'],
    description:'Jewish music, Hebrew programming, Torah and religious radio'
  },
  jain:{
    label:'Jain',
    terms:['jain','jainism','navkar','jain devotional'],
    description:'Jain devotional, spiritual and community programming'
  },
  bahai:{
    label:"Baha'i",
    terms:['bahai',"baha'i",'bahai radio'],
    description:"Baha'i spiritual and community programming"
  },
  zoroastrian:{
    label:'Zoroastrian',
    terms:['zoroastrian','zoroastrianism','avesta','parsi spiritual'],
    description:'Zoroastrian and Parsi spiritual programming where available'
  },
  taoist:{
    label:'Taoist',
    terms:['taoist','taoism','daoist','daoism','tao meditation'],
    description:'Taoist and Daoist spiritual programming where available'
  },
  shinto:{
    label:'Shinto',
    terms:['shinto','shinto music','japanese sacred'],
    description:'Shinto and Japanese sacred programming where available'
  },
  spiritual:{
    label:'Spiritual and meditation',
    terms:['spiritual','meditation','devotional','sacred','mindfulness','chant'],
    description:'Interfaith, spiritual, meditation and contemplative audio'
  }
}

async function devotionalLibrary(tradition,query,limit,{random=false,offset=0,countrycode='',sort='popular',language=''}={}){
  const key=String(tradition||'all_faiths').toLowerCase()
  const entry=DEVOTIONAL_LIBRARY[key]||{
    label:String(tradition||'Devotional'),
    terms:[String(tradition||'devotional')],
    description:'Devotional and spiritual radio'
  }
  const q=String(query||'').trim()
  const lang=String(language||'').trim()

  const searchTerms=[]
  const pushTerm=value=>{
    const term=String(value||'').trim()
    if(term&&!searchTerms.some(existing=>existing.toLowerCase()===term.toLowerCase())) searchTerms.push(term)
  }
  if(q) pushTerm(q)
  for(const base of entry.terms) pushTerm(base)

  const maxTerms=key==='all_faiths'?14:10
  const selectedTerms=searchTerms.slice(0,maxTerms)
  const perTerm=Math.max(14,Math.min(38,Math.ceil((Math.min(100,limit||60)*2.4)/Math.max(1,selectedTerms.length))+8))

  const strictBatches=await Promise.allSettled(
    selectedTerms.map(term=>radioLibrary(term,perTerm,{
      random,
      offset:0,
      countrycode,
      sort,
      language:lang
    }))
  )

  const fuzzyBatches=lang
    ?await Promise.allSettled(
        selectedTerms.slice(0,7).flatMap(term=>[
          radioLibrary(`${term} ${lang}`,Math.max(12,Math.floor(perTerm*.8)),{
            random,
            offset:0,
            countrycode,
            sort,
            language:''
          }),
          radioLibrary(`${lang} ${term}`,Math.max(12,Math.floor(perTerm*.8)),{
            random,
            offset:0,
            countrycode,
            sort,
            language:''
          })
        ])
      )
    :[]

  const batches=[...strictBatches,...fuzzyBatches]
  const allTerms=[...entry.terms,q,lang].filter(Boolean).map(term=>String(term).toLowerCase())
  const seen=new Set()
  const merged=[]

  for(const batch of batches){
    if(batch.status!=='fulfilled') continue
    for(const item of batch.value?.items||[]){
      if(seen.has(item.id)) continue
      seen.add(item.id)

      const haystack=[
        item.title,
        ...(item.tags||[]),
        item.language,
        item.country,
        item.state
      ].filter(Boolean).join(' ').toLowerCase()

      let relevance=0
      for(const term of allTerms){
        if(!term) continue
        if(haystack.includes(term)) relevance+=term===q&&q?10:5
        const pieces=term.split(/\s+/).filter(piece=>piece.length>2)
        for(const piece of pieces) if(haystack.includes(piece)) relevance+=1.25
      }
      if(lang){
        const lowerLang=lang.toLowerCase()
        if(String(item.language||'').toLowerCase().includes(lowerLang)) relevance+=10
        if(haystack.includes(lowerLang)) relevance+=5
      }
      if(countrycode&&String(item.countrycode||'').toUpperCase()===String(countrycode).toUpperCase()) relevance+=4
      relevance+=Math.log10(Math.max(1,item.clickcount||0)+1)*1.8
      relevance+=Math.log10(Math.max(1,item.votes||0)+1)*1.2
      if((item.bitrate||0)>=128) relevance+=1
      if((item.bitrate||0)>=192) relevance+=.7

      merged.push({
        ...item,
        devotional:true,
        tradition:key,
        traditionLabel:entry.label,
        devotionalQuery:q,
        devotionalLanguage:lang,
        relevance:Number(relevance.toFixed(2))
      })
    }
  }

  if(sort==='random'||random){
    for(let i=merged.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1))
      ;[merged[i],merged[j]]=[merged[j],merged[i]]
    }
  }else if(sort==='quality'){
    merged.sort((a,b)=>
      (Math.min(b.bitrate||0,512)-Math.min(a.bitrate||0,512))||
      (b.relevance-a.relevance)||
      ((b.votes||0)-(a.votes||0))||
      ((b.clickcount||0)-(a.clickcount||0))
    )
  }else{
    merged.sort((a,b)=>(b.relevance-a.relevance)||(b.clickcount-a.clickcount)||(b.votes-a.votes)||(b.bitrate-a.bitrate))
  }

  const start=Math.max(0,Number(offset)||0)
  const size=Math.min(100,Math.max(10,limit||60))
  return {
    items:merged.slice(start,start+size),
    nextOffset:start+size,
    hasMore:merged.length>start+size,
    tradition:key,
    label:entry.label,
    description:entry.description,
    query:q,
    language:lang,
    discoveryPasses:lang?2:1
  }
}

async function radioLibrary(query,limit,{random=false,offset=0,countrycode='',sort='popular',language=''}={}){
  const target=Math.min(100,Math.max(10,limit||60))
  const q=String(query||'').trim()
  const country=String(countrycode||'').trim().toUpperCase()
  const requestedLanguage=String(language||'').trim()
  const lang=String(language||'').trim()
  const order=random||sort==='random'?'random':sort==='quality'?'bitrate':'clickcount'
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
    if(lang) params.set('language',lang)
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
      ...(lang?[]:[fetchRadioRows(buildParams({language:q}))])
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

  if(sort==='quality'){
    items.sort((a,b)=>
      (Math.min(b.bitrate||0,512)-Math.min(a.bitrate||0,512))||
      ((b.votes||0)-(a.votes||0))||
      ((b.clickcount||0)-(a.clickcount||0))
    )
  }else if(order!=='random'){
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
    sort:order==='random'?'random':sort==='quality'?'quality':'popular',
    offset:Math.max(0,Number(offset)||0)
  }
}

async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed'},'no-store')
  const mode=String(req.query?.mode||'nature').toLowerCase()
  const query=String(req.query?.q||'').slice(0,80).trim()
  const limit=Math.min(100,Math.max(8,Number(req.query?.limit)||60))
  const random=String(req.query?.random??'0')==='1'
  const offset=Math.max(0,Number(req.query?.offset)||0)
  const countrycode=String(req.query?.countrycode||'').slice(0,2).toUpperCase()
  const language=String(req.query?.language||'').slice(0,64).trim()
  const requestedSort=String(req.query?.sort||'popular').toLowerCase()
  const sort=['popular','random','quality'].includes(requestedSort)?requestedSort:'popular'
  try{
    if(mode==='countries'){
      const countries=await radioCountries()
      return json(res,200,{mode:'countries',count:countries.length,countries},'public, s-maxage=21600, stale-while-revalidate=86400')
    }
    if(mode==='languages'){
      const languages=await radioLanguages()
      return json(res,200,{mode:'languages',count:languages.length,languages},'public, s-maxage=21600, stale-while-revalidate=86400')
    }
    if(mode==='radio'){
      const result=await radioLibrary(query,limit,{random,offset,countrycode,sort,language})
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
    if(mode==='devotional'){
      const tradition=String(req.query?.tradition||'all_faiths').slice(0,48).toLowerCase()
      const result=await devotionalLibrary(tradition,query,limit,{random,offset,countrycode,sort,language})
      return json(res,200,{
        mode:'devotional',
        tradition:result.tradition,
        label:result.label,
        description:result.description,
        query:result.query,
        language:result.language,
        count:result.items.length,
        items:result.items,
        random,
        sort,
        countrycode,
        language,
        offset,
        nextOffset:result.nextOffset,
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

export async function onRequest({request,env:bindings}){
 env=bindings||{};
 const url=new URL(request.url);
 const query=Object.fromEntries(url.searchParams);
 const req={method:request.method,query,headers:Object.fromEntries(request.headers)};
 const res=makeResponse();
 try { await handler(req,res); return res.toResponse(); }
 catch(error){return Response.json({error:'Service temporarily unavailable'},{status:502,headers:{'Cache-Control':'no-store'}})}
}
