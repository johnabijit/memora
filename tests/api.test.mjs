import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest as ask } from '../functions/api/ask.js'
import { onRequest as music } from '../functions/api/open-music.js'
import { onRequest as audio } from '../functions/api/audio-library.js'
import { onRequest as health } from '../functions/api/health.js'
import { onRequest as scene } from '../functions/api/scene-background.js'
import { onRequest as missing } from '../functions/api/[[path]].js'

const json = (body, status=200) => Response.json(body, {status})
const request = (path, body, token) => new Request(`https://memora.test/api/${path}`, {
  method: body===undefined?'GET':'POST',
  headers: {'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
})
async function withFetch(stub, run) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try { await run() } finally { globalThis.fetch = original }
}

test('health and unknown API routes return JSON with explicit statuses', async () => {
  const res = await health({request:request('health')})
  assert.equal(res.status,200)
  assert.equal((await res.json()).version,'43.1')
  assert.match(res.headers.get('cache-control'),/no-store/)
  assert.equal((await missing()).status,404)
  const invalid = await ask({request:request('ask')})
  assert.equal(invalid.status,405)
  assert.equal(invalid.headers.get('allow'),'POST')
  assert.equal((await invalid.json()).error,'Method not allowed')
})

test('AI rejects missing and invalid sessions without reading memories', async () => {
  let calls=0
  await withFetch(async url=>{calls++;assert.match(url,/auth\/v1\/user/);return json({},401)},async()=>{
    assert.equal((await ask({request:request('ask',{question:'Hello'})})).status,401)
    assert.equal(calls,0)
    assert.equal((await ask({request:request('ask',{question:'Hello'},'invalid-fixture')})).status,401)
    assert.equal(calls,1)
  })
})

test('malformed, oversized and non-JSON AI requests are rejected', async () => {
  const base='https://memora.test/api/ask'
  for(const [body,contentType,status] of [['{','application/json',400],['{}','text/plain',415],[JSON.stringify({question:'x'.repeat(70000)}),'application/json',413]]){
    const res=await ask({request:new Request(base,{method:'POST',headers:{'Content-Type':contentType},body})})
    assert.equal(res.status,status)
    assert.ok((await res.json()).error)
  }
})

function aiFixture({blocked=false,providerError=false}={}) {
  const calls=[]
  const stub=async(url,options={})=>{
    calls.push({url,options})
    assert.equal(options.headers?.Authorization || options.headers?.authorization,'Bearer fixture-session')
    if(url.includes('/auth/v1/user')) return json({id:'fixture-user'})
    if(url.includes('check_and_record_ai_usage')) return json({allowed:!blocked})
    if(url.includes('ai_request_logs')) return new Response(null,{status:204})
    if(url.includes('search_memory_universe')) return json([{entity_type:'memory',title:'My manager is Alice.',content:'My manager is Alice. {}',metadata:{}}])
    if(url.includes('/memory_facts?')) return json([{fact_key:'work.manager',category:'work',value_text:'Alice',confidence:1}])
    if(url.includes('/memory_media?')) return json([{id:'11111111-1111-4111-8111-111111111111',storage_path:'fixture/image.jpg',mime_type:'image/jpeg',file_name:'fixture.jpg'}])
    if(url.includes('/storage/v1/')) return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}})
    if(url.includes('/functions/v1/ai-provider-proxy')) return providerError?json({error:'No connected AI provider'},409):json({answer:'Your manager is Alice.',model:'fixture',provider:'fixture'})
    return json([])
  }
  return {stub,calls}
}

test('AI passes session-scoped evidence and the selected image to connected reasoning', async () => {
  const {stub,calls}=aiFixture()
  await withFetch(stub,async()=>{
    const res=await ask({request:request('ask',{question:'Who is my manager in the image?',mediaId:'11111111-1111-4111-8111-111111111111',history:[{role:'user',text:'I uploaded an image'}]},'fixture-session')})
    assert.equal(res.status,200)
    const data=await res.json()
    assert.equal(data.answer,'Your manager is Alice.')
    assert.equal(data.imageId,'11111111-1111-4111-8111-111111111111')
    const payload=JSON.parse(calls.find(call=>call.url.includes('ai-provider-proxy')).options.body)
    assert.match(payload.prompt,/work.manager: Alice/)
    assert.match(payload.instructions,/Never invent personal facts/)
    assert.equal(payload.imageDataUrl,'data:image/jpeg;base64,AQID')
    assert.match(calls.find(call=>call.url.includes('/memory_media?')).url,/&id=eq\.11111111/)
  })
})

test('AI rate limits and unavailable providers remain JSON failures',async()=>{
  for(const [options,status] of [[{blocked:true},429],[{providerError:true},503]]){
    const fixture=aiFixture(options)
    await withFetch(fixture.stub,async()=>{
      const res=await ask({request:request('ask',{question:'What do I do?'},'fixture-session')})
      assert.equal(res.status,status)
      assert.ok((await res.json()).error)
      if(options.blocked) assert.equal(fixture.calls.some(x=>x.url.includes('ai-provider-proxy')),false)
    })
  }
})

test('music streams preserve range requests and do not buffer the entire audio',async()=>{
  let buffered=false
  const upstream=new Response(new Uint8Array([1,2,3]),{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-2/3','accept-ranges':'bytes'}})
  upstream.arrayBuffer=async()=>{buffered=true;throw new Error('Should never buffer')}
  await withFetch(async(url,options)=>{
    assert.match(url,/tracks\/fixture\/stream/)
    assert.equal(options.headers.Range,'bytes=0-2')
    return upstream
  },async()=>{
    const req=new Request('https://memora.test/api/open-music?mode=stream&id=fixture',{headers:{Range:'bytes=0-2'}})
    const res=await music({request:req})
    assert.equal(res.status,206)
    assert.equal(res.headers.get('content-range'),'bytes 0-2/3')
    assert.equal(buffered,false)
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[1,2,3])
  })
})

test('music redirects and HEAD preserve upstream playback behavior',async()=>{
  await withFetch(async()=>new Response(null,{status:302,headers:{location:'https://cdn.audius.co/fixture.mp3'}}),async()=>{
    const res=await music({request:new Request('https://memora.test/api/open-music?mode=stream&id=fixture',{method:'HEAD'})})
    assert.equal(res.status,302)
    assert.equal(res.headers.get('location'),'https://cdn.audius.co/fixture.mp3')
    assert.equal(await res.text(),'')
  })
})

test('simultaneous music requests keep their environment bindings isolated',async()=>{
  const keys=[]
  await withFetch(async(url,options)=>{
    keys.push(options.headers.Authorization)
    await new Promise(resolve=>setTimeout(resolve,5))
    return json({data:[{id:'fixture',title:'Test song',user:{name:'Test artist'}}]})
  },async()=>{
    const results=await Promise.all(['fixture-key-a','fixture-key-b'].map(key=>music({request:request('open-music?mode=trending'),env:{AUDIUS_API_KEY:key}})))
    assert.deepEqual(new Set(keys),new Set(['Bearer fixture-key-a','Bearer fixture-key-b']))
    for(const res of results){assert.equal(res.status,200);assert.equal((await res.json()).items[0].title,'Test song')}
  })
})

test('a valid music search with no matches is an empty result rather than a provider failure',async()=>{
  await withFetch(async url=>url.includes('audius')?json({data:[]}):json({query:{pages:[]}}),async()=>{
    const res=await music({request:request('open-music?q=unmatched-fixture')})
    assert.equal(res.status,200)
    const data=await res.json()
    assert.deepEqual(data.items,[])
    assert.equal(data.hasMore,false)
  })
})

test('nature fallback is usable and external radio failures are explicit JSON',async()=>{
  await withFetch(async()=>{throw new Error('fixture offline')},async()=>{
    const nature=await audio({request:request('audio-library?mode=nature')})
    assert.equal(nature.status,200)
    const data=await nature.json()
    assert.ok(data.items.length>0)
    assert.ok(data.items.every(item=>item.type==='nature' && item.url.startsWith('https://')))
    const radio=await audio({request:request('audio-library?mode=countries')})
    assert.equal(radio.status,502)
    assert.ok((await radio.json()).error)
  })
})

test('radio directory normalizes countries, languages and playable HTTPS stations',async()=>{
  await withFetch(async url=>{
    if(url.includes('/countrycodes')) return json([{name:'US',stationcount:123},{name:'',stationcount:2}])
    if(url.includes('/languages')) return json([{name:'tamil',stationcount:42},{name:'',stationcount:1}])
    return json([
      {stationuuid:'secure',name:'Tamil Radio',url_resolved:'https://fixture.test/live',countrycode:'IN',lastcheckok:1,language:'tamil'},
      {stationuuid:'insecure',name:'HTTP Radio',url_resolved:'http://fixture.test/live',lastcheckok:1},
      {stationuuid:'broken',name:'Broken Radio',url_resolved:'https://fixture.test/broken',lastcheckok:0}
    ])
  },async()=>{
    const countries=await (await audio({request:request('audio-library?mode=countries')})).json()
    assert.equal(countries.countries.length,1)
    assert.equal(countries.countries[0].code,'US')
    const languages=await (await audio({request:request('audio-library?mode=languages')})).json()
    assert.equal(languages.languages[0].name,'tamil')
    const stations=await (await audio({request:request('audio-library?mode=radio&q=tamil')})).json()
    assert.ok(stations.items.length>0)
    assert.ok(stations.items.every(item=>item.url.startsWith('https://') && item.title!=='Broken Radio'))
  })
})

test('scene background selects a suitable licensed image and returns JSON upstream errors',async()=>{
  await withFetch(async()=>json({query:{pages:[
    {pageid:1,title:'File:Landscape.jpg',imageinfo:[{mime:'image/jpeg',width:2000,height:1200,url:'https://fixture.test/scene.jpg',extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},Artist:{value:'<b>Fixture artist</b>'}}}]},
    {pageid:2,title:'File:Small.jpg',imageinfo:[{mime:'image/jpeg',width:200,height:120,url:'https://fixture.test/small.jpg'}]}
  ]}}),async()=>{
    const res=await scene({request:request('scene-background?q=calm')})
    assert.equal(res.status,200)
    const data=await res.json()
    assert.equal(data.count,1)
    assert.equal(data.item.artist,'Fixture artist')
    assert.equal(data.item.url,'https://fixture.test/scene.jpg')
  })
  await withFetch(async()=>new Response('offline',{status:503}),async()=>{
    const res=await scene({request:request('scene-background')})
    assert.equal(res.status,502)
    assert.ok((await res.json()).error)
  })
})
