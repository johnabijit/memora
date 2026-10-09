import { normalizeMusicQuery, musicQueryVariants } from '../shared/music-search.js'
export default async function handler(req,res,env={}) {
const AUDIUS_API='https://api.audius.co/v1'
const COMMONS_API='https://commons.wikimedia.org/w/api.php'

function json(res,status,body,cache='public, s-maxage=120, stale-while-revalidate=600'){
  res.statusCode=status
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control',cache)
  res.end(JSON.stringify(body))
}

function headers(extra={}){
  const result={
    'Accept':'application/json',
    'User-Agent':'Memora/1.0 (worldwide goodwill personal memory app)',
    ...extra
  }
  if(env.AUDIUS_API_KEY){
    result.Authorization='Bearer '+env.AUDIUS_API_KEY
  }
  return result
}

async function audiusFetch(path,params={}){
  const query=new URLSearchParams()
  for(const [key,value] of Object.entries(params)){
    if(value===undefined||value===null||value==='') continue
    if(Array.isArray(value)){
      for(const item of value) query.append(key,String(item))
    }else query.set(key,String(value))
  }
  const response=await fetch(AUDIUS_API+path+(query.size?'?'+query.toString():''),{headers:headers()})
  if(!response.ok){
    const detail=await response.text().catch(()=>'')
    throw new Error('Audius '+response.status+(detail?' '+detail.slice(0,180):''))
  }
  return await response.json()
}

function absoluteAudiusUrl(value=''){
  const url=String(value||'').trim()
  if(!url) return ''
  if(/^https?:\/\//i.test(url)) return url
  if(url.startsWith('/')) return 'https://audius.co'+url
  return 'https://audius.co/'+url.replace(/^\/+/, '')
}

function artworkUrl(track){
  const art=track?.artwork||track?.cover_art||{}
  return art['480x480']||art._480x480||art['1000x1000']||art._1000x1000||art['150x150']||art._150x150||''
}

function normalizeTrack(track){
  const id=String(track?.id||track?.track_id||'').trim()
  if(!id) return null
  const streamable=track?.is_streamable??track?.isStreamable??true
  const gated=Boolean(track?.is_stream_gated||track?.isStreamGated)
  if(streamable===false||streamable==='false'||gated) return null

  const artist=String(
    track?.user?.name||
    track?.artist_name||
    track?.artistName||
    track?.owner_name||
    track?.user?.handle||
    'Audius artist'
  ).trim()

  const handle=String(track?.user?.handle||track?.owner_handle||'').trim()
  const title=String(track?.title||'Untitled track').trim()
  const permalink=absoluteAudiusUrl(track?.permalink||track?.permalink_url||'')
  const genre=String(track?.genre||'').trim()
  const mood=String(track?.mood||'').trim()
  const duration=Number(track?.duration||0)
  const plays=Number(track?.play_count??track?.playCount??track?.plays??0)
  const favorites=Number(track?.favorite_count??track?.favoriteCount??0)
  const reposts=Number(track?.repost_count??track?.repostCount??0)

  return {
    id:'music-'+id,
    trackId:id,
    type:'music',
    title,
    artist,
    handle,
    genre,
    mood,
    duration,
    plays,
    favorites,
    reposts,
    artwork:artworkUrl(track),
    url:'/api/open-music?mode=stream&id='+encodeURIComponent(id),
    source:'Audius open music',
    sourcePage:permalink,
    description:String(track?.description||'').trim().slice(0,500),
    openCatalog:true,
    provider:'audius',
    license:'Streamed through Audius'
  }
}

function stripHtml(value=''){
  return String(value||'')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/\s+/g,' ')
    .trim()
}

function commonsPlayable(info){
  const derivatives=Array.isArray(info?.derivatives)?info.derivatives:[]
  const mp3=derivatives.find(item=>String(item.type||'').includes('mpeg'))
  const ogg=derivatives.find(item=>String(item.type||'').includes('ogg'))
  return mp3?.src||ogg?.src||info?.url||''
}

async function commonsMusicSearch(query,{limit=12,offset=0}={}){
  const term=String(query||'').trim()
  if(!term) return []
  const params=new URLSearchParams({
    action:'query',
    generator:'search',
    gsrsearch:`${term} filetype:audio`,
    gsrnamespace:'6',
    gsrlimit:String(Math.min(24,Math.max(4,limit))),
    gsroffset:String(Math.max(0,offset)),
    prop:'imageinfo',
    iiprop:'url|mime|extmetadata|derivatives',
    format:'json',
    formatversion:'2',
    origin:'*'
  })
  const response=await fetch(COMMONS_API+'?'+params.toString(),{
    headers:{'User-Agent':'Memora/1.0 (worldwide goodwill personal memory app)'}
  })
  if(!response.ok) throw new Error('Commons '+response.status)
  const data=await response.json()
  return (data?.query?.pages||[]).flatMap(page=>{
    const info=page?.imageinfo?.[0]
    const mime=String(info?.mime||'')
    const url=commonsPlayable(info)
    if(!url||(!mime.startsWith('audio/')&&!/\.(mp3|ogg|oga|wav|flac)(\?|$)/i.test(url))) return []
    const meta=info?.extmetadata||{}
    const title=String(page.title||'')
      .replace(/^File:/,'')
      .replace(/_/g,' ')
      .replace(/\.(mp3|ogg|oga|wav|flac)$/i,'')
      .trim()
    const artist=stripHtml(meta.Artist?.value||meta.Credit?.value||'Wikimedia Commons contributor')
    const license=stripHtml(meta.LicenseShortName?.value||meta.UsageTerms?.value||'Open license')
    return [{
      id:'music-commons-'+page.pageid,
      type:'music',
      title,
      artist,
      genre:'Open archive',
      mood:'',
      duration:0,
      plays:0,
      favorites:0,
      reposts:0,
      artwork:'',
      url,
      source:'Wikimedia Commons',
      sourcePage:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(String(page.title||'').replace(/ /g,'_')),
      description:stripHtml(meta.ImageDescription?.value||'').slice(0,500),
      license,
      openCatalog:true,
      provider:'commons'
    }]
  })
}

function mergeMusicProviders(primary,secondary,limit){
  const out=[]
  const seen=new Set()
  let a=0,b=0
  while(out.length<limit&&(a<primary.length||b<secondary.length)){
    for(let i=0;i<2&&a<primary.length&&out.length<limit;i++){
      const item=primary[a++]
      if(seen.has(item.id)) continue
      seen.add(item.id);out.push(item)
    }
    if(b<secondary.length&&out.length<limit){
      const item=secondary[b++]
      if(!seen.has(item.id)){seen.add(item.id);out.push(item)}
    }
  }
  return out
}

function normalizeCollection(row){
  const id=String(row?.id||row?.playlist_id||'').trim()
  if(!id) return null
  const title=String(row?.playlist_name||row?.name||row?.title||'Untitled collection').trim()
  const artist=String(row?.user?.name||row?.owner_name||row?.user?.handle||'Audius creator').trim()
  const handle=String(row?.user?.handle||row?.owner_handle||'').trim()
  const isAlbum=Boolean(row?.is_album??row?.isAlbum)
  const art=row?.artwork||row?.cover_art||{}
  const artwork=art['480x480']||art._480x480||art['1000x1000']||art._1000x1000||art['150x150']||art._150x150||''
  const permalink=absoluteAudiusUrl(row?.permalink||row?.permalink_url||'')
  return {
    id:'collection-'+id,
    collectionId:id,
    type:'collection',
    kind:isAlbum?'album':'playlist',
    title,
    artist,
    handle,
    artwork,
    trackCount:Number(row?.track_count??row?.trackCount??row?.playlist_contents?.track_ids?.length??0),
    totalPlayCount:Number(row?.total_play_count??row?.totalPlayCount??0),
    description:String(row?.description||'').trim().slice(0,500),
    source:'Audius open music',
    sourcePage:permalink,
    provider:'audius',
    openCatalog:true
  }
}

function normalizeCollections(rows){
  const seen=new Set()
  const items=[]
  for(const row of rows||[]){
    const item=normalizeCollection(row)
    if(!item||seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return items
}

async function searchCollections({query,limit,offset}){
  const data=await audiusFetch('/playlists/search',{
    query,
    limit,
    offset
  })
  return normalizeCollections(data?.data||data?.results||[])
}

async function trendingCollections({limit,offset}){
  const data=await audiusFetch('/playlists/trending',{
    limit,
    offset,
    time:'week'
  })
  return normalizeCollections(data?.data||data?.results||[])
}

async function collectionTracks(id,{limit=100,offset=0}={}){
  if(!/^[A-Za-z0-9_-]{2,96}$/.test(String(id||''))) throw new Error('Invalid collection id')
  const data=await audiusFetch('/playlists/'+encodeURIComponent(id)+'/tracks',{
    limit:Math.min(100,Math.max(1,limit)),
    offset:Math.max(0,offset)
  })
  return normalizeTracks(data?.data||data?.results||[])
}

function normalizeTracks(rows){
  const seen=new Set()
  const items=[]
  for(const row of rows||[]){
    const item=normalizeTrack(row)
    if(!item||seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return items
}

async function searchTracks({query,limit,offset,sort,genre}){
  const params={
    query,
    limit,
    offset,
    sort_method:['popular','recent'].includes(sort)?sort:'relevant',
    filter_tracks:'public'
  }
  if(genre) params.genre=genre

  const [audiusResult,commonsResult]=await Promise.allSettled([
    audiusFetch('/tracks/search',params),
    commonsMusicSearch(query,{limit:Math.min(16,Math.ceil(limit/2)),offset:Math.floor(offset/2)})
  ])

  const audiusItems=audiusResult.status==='fulfilled'
    ?normalizeTracks(audiusResult.value?.data||audiusResult.value?.results||[])
    :[]
  const commonsItems=commonsResult.status==='fulfilled'?commonsResult.value:[]

  if(audiusResult.status==='rejected'&&commonsResult.status==='rejected'){
    const reason=audiusResult.status==='rejected'?audiusResult.reason:commonsResult.reason
    throw reason||new Error('No open music providers responded')
  }
  return mergeMusicProviders(audiusItems,commonsItems,limit)
}

async function trendingTracks({limit,offset,genre,time='week'}){
  const data=await audiusFetch('/tracks/trending',{
    limit,
    offset,
    genre:genre||undefined,
    time:['week','month','year','allTime'].includes(time)?time:'week'
  })
  return normalizeTracks(data?.data||data?.results||[])
}

async function streamTrack(req,res,id){
  if(!/^[A-Za-z0-9_-]{2,96}$/.test(id)){
    return json(res,400,{error:'Invalid track id'},'no-store')
  }

  const upstreamHeaders=headers({Accept:'audio/*,*/*;q=0.8'})
  delete upstreamHeaders.Accept
  if(req.headers.range) upstreamHeaders.Range=req.headers.range

  const upstream=await fetch(AUDIUS_API+'/tracks/'+encodeURIComponent(id)+'/stream',{
    headers:upstreamHeaders,
    redirect:'manual',
    method:req.method
  })

  const location=upstream.headers.get('location')
  if(location&&upstream.status>=300&&upstream.status<400){
    res.statusCode=302
    res.setHeader('Location',location)
    res.setHeader('Cache-Control','no-store')
    return res.end()
  }

  if(upstream.status===416) return json(res,416,{error:'Requested audio range is unavailable'},'no-store')
  if(!upstream.ok){
    return json(res,upstream.status===404?404:502,{error:'This open-music track is not currently streamable.'},'no-store')
  }

  const copyHeaders=['content-type','content-length','accept-ranges','content-range','etag','last-modified']
  for(const key of copyHeaders){
    const value=upstream.headers.get(key)
    if(value) res.setHeader(key,value)
  }
  res.setHeader('Cache-Control','private, max-age=0, must-revalidate')
  res.statusCode=upstream.status
  if(!upstream.body) return res.end()
  res.end(req.method==='HEAD'?null:upstream.body)
}

async function run(req,res){
  if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed'},'no-store')

  const mode=String(req.query?.mode||'search').toLowerCase()
  if(mode==='stream'){
    try{
      return await streamTrack(req,res,String(req.query?.id||''))
    }catch(error){
      return json(res,502,{error:'Open music playback is temporarily unavailable.'},'no-store')
    }
  }

  const originalQuery=String(req.query?.q||'').trim().slice(0,120)
  const query=normalizeMusicQuery(originalQuery)
  let matchedQuery=query
  const searchedQueries=[]
  async function searchWithFallback(search){
    for(const candidate of musicQueryVariants(query)){
      searchedQueries.push(candidate)
      const items=await search(candidate)
      if(items.length){matchedQuery=candidate;return items}
    }
    return []
  }
  const genre=String(req.query?.genre||'').trim().slice(0,80)
  const sort=['relevant','popular','recent'].includes(String(req.query?.sort||'').toLowerCase())
    ?String(req.query.sort).toLowerCase()
    :'relevant'
  const limit=Math.min(50,Math.max(8,Number(req.query?.limit)||30))
  const offset=Math.max(0,Number(req.query?.offset)||0)
  const time=String(req.query?.time||'week')

  try{
    if(mode==='collections'){
      const items=query
        ?await searchWithFallback(candidate=>searchCollections({query:candidate,limit,offset}))
        :await trendingCollections({limit,offset})
      return json(res,200,{
        mode:'collections',
        provider:'Audius',
        query, originalQuery, matchedQuery, searchedQueries,
        offset,
        nextOffset:offset+items.length,
        hasMore:items.length>=limit,
        count:items.length,
        items
      },'public, s-maxage=90, stale-while-revalidate=300')
    }

    if(mode==='collection_tracks'){
      const collectionId=String(req.query?.id||'').trim()
      const items=await collectionTracks(collectionId,{limit,offset})
      return json(res,200,{
        mode:'collection_tracks',
        provider:'Audius',
        collectionId,
        offset,
        nextOffset:offset+items.length,
        hasMore:items.length>=limit,
        count:items.length,
        items
      },'public, s-maxage=90, stale-while-revalidate=300')
    }

    let items=[]
    let actualMode=mode
    if(mode==='trending'||!query){
      actualMode='trending'
      items=await trendingTracks({limit,offset,genre,time})
    }else{
      items=await searchWithFallback(candidate=>searchTracks({query:candidate,limit,offset,sort,genre}))
    }

    return json(res,200,{
      mode:actualMode,
      provider:actualMode==='trending'?'Audius':'Audius + Wikimedia Commons',
      query, originalQuery, matchedQuery, searchedQueries,
      genre,
      sort,
      offset,
      nextOffset:offset+items.length,
      hasMore:items.length>=limit,
      count:items.length,
      items
    },'public, s-maxage=60, stale-while-revalidate=300')
  }catch(error){
    return json(res,502,{
      error:'The open music catalog is temporarily unavailable.',
      detail:env.NODE_ENV==='development'?String(error?.message||error):undefined
    },'no-store')
  }
}
return run(req,res)
}
handler.allow='GET, HEAD'
