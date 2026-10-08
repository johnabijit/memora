const AUDIUS_ROOT='https://api.audius.co/v1'

function json(res,status,body,cache='public, s-maxage=300, stale-while-revalidate=1800'){
  res.statusCode=status
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control',cache)
  res.end(JSON.stringify(body))
}

function artwork(track){
  const art=track?.artwork||track?.cover_art||{}
  return art?.['480x480']||art?.['1000x1000']||art?.['150x150']||null
}

function normalizeTrack(track){
  if(!track) return null
  const id=String(track.id||track.track_id||'')
  if(!id) return null
  const gated=Boolean(track.is_stream_gated||track.stream_conditions)
  const access=track.access
  if(gated||access?.stream===false) return null
  return {
    id:'music-'+id,
    trackId:id,
    type:'music',
    title:String(track.title||'Untitled track').trim(),
    artist:String(track.user?.name||track.artist_name||track.user?.handle||'Audius artist').trim(),
    handle:String(track.user?.handle||'').trim(),
    genre:String(track.genre||'').trim(),
    mood:String(track.mood||'').trim(),
    duration:Number(track.duration||0),
    playCount:Number(track.play_count||track.total_play_count||0),
    repostCount:Number(track.repost_count||0),
    favoriteCount:Number(track.favorite_count||track.save_count||0),
    artwork:artwork(track),
    url:`${AUDIUS_ROOT}/tracks/${encodeURIComponent(id)}/stream`,
    sourcePage:track.permalink?(`https://audius.co${track.permalink.startsWith('/')?'':'/'}${track.permalink}`):'https://audius.co',
    license:String(track.license||'Audius public stream').trim(),
    releaseDate:track.release_date||null,
    downloadable:Boolean(track.is_downloadable),
    provider:'Audius'
  }
}

async function audius(path,params={}){
  const url=new URL(AUDIUS_ROOT+path)
  for(const [key,value] of Object.entries(params)){
    if(value!==undefined&&value!==null&&value!=='') url.searchParams.set(key,String(value))
  }
  const response=await fetch(url,{
    headers:{'Accept':'application/json','User-Agent':'Memora/1.0'}
  })
  if(!response.ok) throw new Error(`Audius ${response.status}`)
  return await response.json()
}

async function searchTracks(query,limit,offset){
  const data=await audius('/tracks/search',{
    query,
    limit:Math.min(100,Math.max(10,limit)),
    offset:Math.max(0,offset)
  })
  return (data?.data||[]).map(normalizeTrack).filter(Boolean)
}

async function trendingTracks(limit,offset,genre){
  const params={
    limit:Math.min(100,Math.max(10,limit)),
    offset:Math.max(0,offset),
    time:'week'
  }
  if(genre) params.genre=genre
  const data=await audius('/tracks/trending',params)
  return (data?.data||[]).map(normalizeTrack).filter(Boolean)
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed'},'no-store')
  const query=String(req.query?.q||'').slice(0,120).trim()
  const genre=String(req.query?.genre||'').slice(0,60).trim()
  const limit=Math.min(100,Math.max(10,Number(req.query?.limit)||40))
  const offset=Math.max(0,Number(req.query?.offset)||0)

  try{
    const items=query
      ?await searchTracks(query,limit,offset)
      :await trendingTracks(limit,offset,genre)
    return json(res,200,{
      source:'Audius',
      mode:query?'search':'trending',
      query,
      genre,
      offset,
      nextOffset:offset+items.length,
      hasMore:items.length>=Math.min(limit,100),
      count:items.length,
      items
    },query?'no-store':'public, s-maxage=180, stale-while-revalidate=900')
  }catch(error){
    return json(res,502,{
      error:'Open Music is temporarily unavailable.',
      detail:String(error?.message||error).slice(0,180)
    },'no-store')
  }
}
