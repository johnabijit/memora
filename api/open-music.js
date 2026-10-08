const {Readable}=require('stream')

const AUDIUS_API='https://api.audius.co/v1'

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
  if(process.env.AUDIUS_API_KEY){
    result.Authorization='Bearer '+process.env.AUDIUS_API_KEY
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
    openCatalog:true
  }
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
  const data=await audiusFetch('/tracks/search',params)
  return normalizeTracks(data?.data||data?.results||[])
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
    redirect:'manual'
  })

  const location=upstream.headers.get('location')
  if(location&&upstream.status>=300&&upstream.status<400){
    res.statusCode=302
    res.setHeader('Location',location)
    res.setHeader('Cache-Control','no-store')
    return res.end()
  }

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
  Readable.fromWeb(upstream.body).pipe(res)
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed'},'no-store')

  const mode=String(req.query?.mode||'search').toLowerCase()
  if(mode==='stream'){
    try{
      return await streamTrack(req,res,String(req.query?.id||''))
    }catch(error){
      return json(res,502,{error:'Open music playback is temporarily unavailable.'},'no-store')
    }
  }

  const query=String(req.query?.q||'').trim().slice(0,120)
  const genre=String(req.query?.genre||'').trim().slice(0,80)
  const sort=['relevant','popular','recent'].includes(String(req.query?.sort||'').toLowerCase())
    ?String(req.query.sort).toLowerCase()
    :'relevant'
  const limit=Math.min(50,Math.max(8,Number(req.query?.limit)||30))
  const offset=Math.max(0,Number(req.query?.offset)||0)
  const time=String(req.query?.time||'week')

  try{
    let items=[]
    let actualMode=mode
    if(mode==='trending'||!query){
      actualMode='trending'
      items=await trendingTracks({limit,offset,genre,time})
    }else{
      items=await searchTracks({query,limit,offset,sort,genre})
    }

    return json(res,200,{
      mode:actualMode,
      provider:'Audius',
      query,
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
      detail:process.env.NODE_ENV==='development'?String(error?.message||error):undefined
    },'no-store')
  }
}
