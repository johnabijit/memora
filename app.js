import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
const app = document.getElementById('app')
let user = null
let view = 'home'
let chat = []
let pendingMedia = []

const nav = [
  ['home','Home'],['ask','Ask Memora'],['memories','Memories'],['timeline','Timeline'],
  ['people','People'],['places','Places'],['things','Things'],['documents','Documents'],
  ['connections','Connections'],['settings','Settings']
]

const esc = value => String(value ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const when = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Unknown date'
const shortDate = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value)) : 'Unknown'
const toast = message => {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(()=>el.remove(),2600)
}
const typeLabel = type => ({
  note:'Moment',object:'Object',activity:'Activity',event:'Event',person:'Person',place:'Place',
  task:'Task',document:'Document',preference:'Preference',personal_fact:'Personal fact',
  object_location:'Object location',reminder:'Reminder',document_fact:'Document fact',
  conversation:'Conversation',other:'Memory'
}[type] || 'Memory')

function authScreen(mode='login'){
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="glass auth-card">
      <div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>Your life, remembered beautifully</small></div></div>
      <div class="eyebrow">Private memory space</div>
      <h2>${mode==='login'?'Welcome back':'Begin your memory vault'}</h2>
      <p class="muted">Capture moments, photos, people, places, documents and the little details you never want to lose.</p>
      <form id="authForm">
        ${mode==='signup'?'<input class="input" id="name" placeholder="Your name" required>':''}
        <input class="input" id="email" type="email" placeholder="Email" required>
        <input class="input" id="password" type="password" minlength="8" placeholder="Password" required>
        <button class="btn primary" type="submit">${mode==='login'?'Enter Memora':'Create my space'}</button>
      </form>
      <div class="tabbar"><button class="btn" id="loginTab">Sign in</button><button class="btn" id="signupTab">Sign up</button></div>
      <p id="authMsg" class="muted"></p>
    </div>
  </div>`
  document.getElementById('loginTab').onclick=()=>authScreen('login')
  document.getElementById('signupTab').onclick=()=>authScreen('signup')
  document.getElementById('authForm').onsubmit=async event=>{
    event.preventDefault()
    const email=document.getElementById('email').value.trim()
    const password=document.getElementById('password').value
    const msg=document.getElementById('authMsg')
    msg.textContent='Working...'
    if(mode==='signup'){
      const display_name=document.getElementById('name').value.trim()
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name},emailRedirectTo:window.location.origin}})
      if(error) return msg.textContent=error.message
      if(data.session){user=data.user;render()}else msg.textContent='Account created. Check your email to confirm, then return here and sign in.'
    }else{
      const {data,error}=await supabase.auth.signInWithPassword({email,password})
      if(error) return msg.textContent=error.message
      user=data.user
      render()
    }
  }
}

function shell(content,title){
  const navHtml=nav.map(([id,label])=>`<button data-nav="${id}" class="${view===id?'active':''}"><span class="nav-dot"></span>${label}</button>`).join('')
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>Personal memory OS</small></div></div>
      <nav class="nav">${navHtml}</nav>
      <div class="sidebar-footer"><button class="btn" id="logout">Sign out</button></div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div><div class="eyebrow">Your private universe</div><h2>${esc(title)}</h2></div>
        <button class="btn primary" id="quick">+ New memory</button>
      </div>
      ${content}
    </main>
    <div class="mobile-nav">
      ${[['home','Home'],['ask','Ask'],['timeline','Timeline'],['memories','Memories'],['settings','Profile']].map(([id,label])=>`<button data-nav="${id}" class="${view===id?'active':''}">${label}</button>`).join('')}
    </div>
  </div>`
}

function wire(){
  document.querySelectorAll('[data-nav]').forEach(button=>button.onclick=()=>go(button.dataset.nav))
  document.getElementById('quick')?.addEventListener('click',()=>go('home',true))
  document.getElementById('logout')?.addEventListener('click',async()=>{
    await supabase.auth.signOut()
    user=null
    pendingMedia=[]
    authScreen()
  })
}

async function go(next,focus=false){
  view=next
  const routes={home,ask,memories,timeline,people,places,things,documents,connections,settings}
  await (routes[next]||home)()
  if(focus) document.getElementById('memoryInput')?.focus()
}
const render=()=>go(view)

function interpret(text){
  const result={memory_type:'note',summary:text,interpreted_data:{}}
  const patterns=[
    /(?:i\s+)?(?:kept|put|left|placed|stored)\s+(?:my\s+)?(.+?)\s+(?:in|inside|under|below|on|at|near)\s+(.+?)(?:\.|$)/i,
    /(?:my\s+)?(.+?)\s+(?:is|was)\s+(?:in|inside|under|below|on|at|near)\s+(.+?)(?:\.|$)/i,
    /(?:i\s+)?moved\s+(?:my\s+)?(.+?)\s+(?:to|into)\s+(.+?)(?:\.|$)/i
  ]
  for(const pattern of patterns){
    const match=text.match(pattern)
    if(match){
      result.memory_type='object'
      result.summary=`${match[1].trim()} is at ${match[2].trim()}`
      result.interpreted_data={thing:match[1].trim(),location:match[2].trim()}
      return result
    }
  }
  const activity=text.match(/(?:i\s+)?(?:played|did|attended|visited)\s+(.+?)(?:\s+with\s+([A-Z][A-Za-z .'-]+?))?(?:\s+(today|yesterday))?(?:\.|$)/i)
  if(activity){
    result.memory_type='activity'
    result.interpreted_data={activity:activity[1]?.trim(),person:activity[2]?.trim()||null,relative_date:activity[3]||null}
  }else if(/prefer|favorite|favourite|like|love/i.test(text)) result.memory_type='preference'
  else if(/need to|must|todo|to-do/i.test(text)) result.memory_type='task'
  else if(/met|spoke with|talked with/i.test(text)) result.memory_type='person'
  else if(/visited|went to|at the|at my/i.test(text)) result.memory_type='place'
  else if(/remember|important|note/i.test(text)) result.memory_type='personal_fact'
  return result
}

async function findThing(name){
  const {data}=await supabase.from('things').select('*').ilike('name',name).limit(1).maybeSingle()
  return data
}

async function trackThing(name,location,memoryId){
  let thing=await findThing(name)
  const now=new Date().toISOString()
  if(!thing){
    const created=await supabase.from('things').insert({user_id:user.id,name,current_location:location,last_memory_id:memoryId}).select().single()
    if(created.error) throw created.error
    thing=created.data
  }else{
    if(thing.last_memory_id){
      await supabase.from('memories').update({state:'superseded',valid_to:now}).eq('id',thing.last_memory_id)
      await supabase.from('memories').update({supersedes_memory_id:thing.last_memory_id}).eq('id',memoryId)
    }
    await supabase.from('thing_locations').update({is_current:false,valid_to:now}).eq('thing_id',thing.id).eq('is_current',true)
    const update=await supabase.from('things').update({current_location:location,last_memory_id:memoryId}).eq('id',thing.id)
    if(update.error) throw update.error
  }
  const loc=await supabase.from('thing_locations').insert({
    user_id:user.id,thing_id:thing.id,memory_id:memoryId,location,recorded_at:now,valid_from:now,is_current:true
  })
  if(loc.error) throw loc.error
}

async function uploadMedia(memoryId,files){
  for(const file of files){
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path=`${user.id}/${memoryId}/${Date.now()}-${safe}`
    const upload=await supabase.storage.from('memora-media').upload(path,file,{contentType:file.type,upsert:false})
    if(upload.error) throw upload.error
    const mediaType=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'image'
    const row=await supabase.from('memory_media').insert({
      user_id:user.id,memory_id:memoryId,storage_path:path,file_name:file.name,mime_type:file.type,media_type:mediaType
    })
    if(row.error) throw row.error
  }
}

async function saveMemory(text,files=[]){
  const parsed=interpret(text)
  let occurred=new Date()
  if(parsed.interpreted_data.relative_date==='yesterday') occurred.setDate(occurred.getDate()-1)
  const payload={
    user_id:user.id,original_text:text,summary:parsed.summary,memory_type:parsed.memory_type,state:'current',
    occurred_at:occurred.toISOString(),source_type:'manual',provenance_kind:'user_stated',confidence:1,
    interpreted_data:parsed.interpreted_data,valid_from:new Date().toISOString()
  }
  const {data:memory,error}=await supabase.from('memories').insert(payload).select().single()
  if(error) throw error
  if(parsed.interpreted_data.thing&&parsed.interpreted_data.location) await trackThing(parsed.interpreted_data.thing,parsed.interpreted_data.location,memory.id)
  if(parsed.interpreted_data.person){
    const existing=await supabase.from('people').select('id').ilike('name',parsed.interpreted_data.person).limit(1).maybeSingle()
    if(!existing.data) await supabase.from('people').insert({user_id:user.id,name:parsed.interpreted_data.person,first_seen_at:memory.occurred_at,last_seen_at:memory.occurred_at})
  }
  if(parsed.memory_type==='activity'){
    await supabase.from('events').insert({
      user_id:user.id,title:text,event_at:memory.occurred_at,memory_id:memory.id,
      person_name:parsed.interpreted_data.person||null,source_type:'manual',event_type:'activity'
    })
  }
  if(files.length) await uploadMedia(memory.id,files)
  return memory
}

function renderPending(){
  const target=document.getElementById('pendingPreview')
  if(!target) return
  target.innerHTML=pendingMedia.map((file,index)=>{
    const url=URL.createObjectURL(file)
    const media=file.type.startsWith('video/')?`<video src="${url}" muted></video>`:`<img src="${url}" alt="">`
    return `<div class="preview">${media}<button data-remove-media="${index}">×</button></div>`
  }).join('')
  document.querySelectorAll('[data-remove-media]').forEach(button=>button.onclick=()=>{
    pendingMedia.splice(Number(button.dataset.removeMedia),1)
    renderPending()
  })
}

function bindComposerInputs(){
  const photo=document.getElementById('photoInput')
  const camera=document.getElementById('cameraInput')
  document.getElementById('photoBtn')?.addEventListener('click',()=>photo?.click())
  document.getElementById('cameraBtn')?.addEventListener('click',()=>camera?.click())
  ;[photo,camera].forEach(input=>input?.addEventListener('change',event=>{
    const files=[...event.target.files].filter(f=>f.type.startsWith('image/')||f.type.startsWith('video/'))
    pendingMedia.push(...files.slice(0,6-pendingMedia.length))
    renderPending()
    event.target.value=''
  }))
}

async function hydrateMemoryMedia(memoriesList){
  if(!memoriesList?.length) return
  const ids=memoriesList.map(m=>m.id)
  const {data:media}=await supabase.from('memory_media').select('*').in('memory_id',ids).order('created_at')
  if(!media?.length) return
  const grouped={}
  for(const item of media){
    grouped[item.memory_id] ||= []
    if(grouped[item.memory_id].length<3){
      const signed=await supabase.storage.from('memora-media').createSignedUrl(item.storage_path,3600)
      if(signed.data?.signedUrl) grouped[item.memory_id].push({...item,url:signed.data.signedUrl})
    }
  }
  Object.entries(grouped).forEach(([memoryId,items])=>{
    const slot=document.querySelector(`[data-media-slot="${memoryId}"]`)
    if(!slot) return
    const first=items[0]
    if(first.media_type==='video') slot.innerHTML=`<video src="${first.url}" controls playsinline></video>`
    else slot.innerHTML=`<img src="${first.url}" alt="Memory attachment">`
    slot.classList.remove('hidden')
    const badge=document.querySelector(`[data-photo-badge="${memoryId}"]`)
    if(badge) badge.classList.remove('hidden')
  })
}

function memoryCard(m){
  return `<article class="glass memory-card">
    <div class="memory-media hidden" data-media-slot="${m.id}"></div>
    <div class="memory-body">
      <div class="memory-top">
        <div><span class="badge">${esc(typeLabel(m.memory_type))}</span> <span class="badge photo hidden" data-photo-badge="${m.id}">Visual</span></div>
        <button class="kebab" data-delete-memory="${m.id}" title="Delete">•••</button>
      </div>
      <div class="memory-title" style="margin-top:12px">${esc(m.summary||m.original_text)}</div>
      <div class="memory-original">${esc(m.original_text)}</div>
      <div class="memory-meta"><span>${shortDate(m.occurred_at||m.created_at)}</span><span>•</span><span>${esc((m.provenance_kind||'user_stated').replaceAll('_',' '))}</span></div>
    </div>
  </article>`
}

async function home(){
  const [{count:memoryCount},{count:thingCount},{count:docCount},{data:recent}]=await Promise.all([
    supabase.from('memories').select('*',{count:'exact',head:true}),
    supabase.from('things').select('*',{count:'exact',head:true}),
    supabase.from('documents').select('*',{count:'exact',head:true}),
    supabase.from('memories').select('*').order('created_at',{ascending:false}).limit(6)
  ])
  app.innerHTML=shell(`
    <section class="glass hero">
      <div class="hero-content">
        <div class="eyebrow">Capture a moment</div>
        <h3><span class="gradient-text">Your life deserves a better memory.</span></h3>
        <p>Write it, photograph it, scan it or simply tell Memora where you kept something. Every memory stays linked to its source, time and history.</p>
        <div class="composer">
          <textarea id="memoryInput" placeholder="I kept my keys in the top drawer beside the watch..."></textarea>
          <div id="pendingPreview" class="preview-strip"></div>
          <div class="composer-tools">
            <div class="tool-row">
              <button class="btn icon" id="cameraBtn">Camera</button>
              <button class="btn icon" id="photoBtn">Photos</button>
              <button class="btn icon" id="fileJump">File</button>
              <input class="hidden" id="cameraInput" type="file" accept="image/*" capture="environment">
              <input class="hidden" id="photoInput" type="file" accept="image/*,video/*" multiple>
            </div>
            <button class="btn primary" id="saveMemory">Remember this</button>
          </div>
        </div>
      </div>
    </section>
    <div class="section-title"><div><h3>Your memory space</h3><p>A living map of the things that matter.</p></div></div>
    <div class="grid three">
      <div class="glass stat" style="--accent:rgba(139,124,255,.22)"><span class="muted">Memories</span><b>${memoryCount||0}</b></div>
      <div class="glass stat" style="--accent:rgba(83,216,208,.20)"><span class="muted">Things tracked</span><b>${thingCount||0}</b></div>
      <div class="glass stat" style="--accent:rgba(255,120,168,.18)"><span class="muted">Files remembered</span><b>${docCount||0}</b></div>
    </div>
    <div class="section-title"><div><h3>Recent memories</h3><p>Moments, objects and details you captured recently.</p></div><button class="btn" data-nav="memories">View all</button></div>
    <div class="memory-grid">${recent?.length?recent.map(memoryCard).join(''):'<div class="glass empty"><strong>Your canvas is empty</strong>Start with a sentence, photo or file.</div>'}</div>
  `,'Home')
  wire()
  bindComposerInputs()
  renderPending()
  document.getElementById('fileJump').onclick=()=>go('documents')
  document.getElementById('saveMemory').onclick=async()=>{
    const input=document.getElementById('memoryInput')
    let text=input.value.trim()
    if(!text&&pendingMedia.length) text='Photo memory'
    if(!text) return toast('Add a note or photo first')
    const button=document.getElementById('saveMemory')
    button.disabled=true
    button.textContent='Saving...'
    try{
      await saveMemory(text,pendingMedia)
      pendingMedia=[]
      toast('Memory saved beautifully')
      await home()
    }catch(error){
      toast(error.message)
      button.disabled=false
      button.textContent='Remember this'
    }
  }
  bindDeletes()
  await hydrateMemoryMedia(recent||[])
}

async function memories(){
  const {data,error}=await supabase.from('memories').select('*').order('created_at',{ascending:false})
  app.innerHTML=shell(`
    <div class="glass" style="padding:16px">
      <div class="capture" style="display:grid;grid-template-columns:1fr auto;gap:10px">
        <input class="input" id="memorySearch" placeholder="Search a person, object, place, activity or phrase">
        <button class="btn primary" id="searchMemory">Search</button>
      </div>
    </div>
    <div class="section-title"><div><h3>Memory gallery</h3><p>Your searchable visual archive.</p></div></div>
    <div class="memory-grid" id="memoryList">${error?esc(error.message):data?.length?data.map(memoryCard).join(''):'<div class="glass empty"><strong>No memories yet</strong>Capture your first one from Home.</div>'}</div>
  `,'Memories')
  wire()
  bindDeletes()
  await hydrateMemoryMedia(data||[])
  document.getElementById('searchMemory').onclick=async()=>{
    const q=document.getElementById('memorySearch').value.trim()
    if(!q) return memories()
    const result=await supabase.rpc('search_memories',{search_query:q,result_limit:50})
    const found=result.data||[]
    document.getElementById('memoryList').innerHTML=result.error?esc(result.error.message):found.length?found.map(m=>memoryCard({...m,created_at:m.occurred_at})).join(''):'<div class="glass empty"><strong>Nothing matched</strong>Try another word or phrase.</div>'
    bindDeletes()
    await hydrateMemoryMedia(found)
  }
}

function bindDeletes(){
  document.querySelectorAll('[data-delete-memory]').forEach(button=>button.onclick=async()=>{
    if(!confirm('Delete this memory and its links?')) return
    const memoryId=button.dataset.deleteMemory
    const {data:media}=await supabase.from('memory_media').select('storage_path').eq('memory_id',memoryId)
    if(media?.length) await supabase.storage.from('memora-media').remove(media.map(x=>x.storage_path))
    const {error}=await supabase.from('memories').delete().eq('id',memoryId)
    if(error) toast(error.message)
    else{toast('Memory deleted');go(view)}
  })
}

async function answer(question){
  const q=question.trim()
  let match=q.match(/where (?:is|did i (?:keep|put|leave)) (?:my )?(.+?)(?:\?|$)/i)
  if(match){
    const thing=await findThing(match[1].trim())
    if(!thing) return {text:"I don't have a memory about that yet."}
    return {text:`Your ${thing.name} is currently recorded as being at ${thing.current_location}.`,source:'Latest personal memory'}
  }
  match=q.match(/where was (?:my )?(.+?) before/i)
  if(match){
    const thing=await findThing(match[1].trim())
    if(!thing) return {text:"I don't have a memory about that yet."}
    const {data}=await supabase.from('thing_locations').select('*').eq('thing_id',thing.id).order('recorded_at',{ascending:false}).limit(2)
    if(!data||data.length<2) return {text:`I know the current location of your ${thing.name}, but I do not have an earlier location yet.`}
    return {text:`Before ${data[0].location}, your ${thing.name} was recorded at ${data[1].location}.`,source:`Personal memory from ${when(data[1].recorded_at)}`}
  }
  match=q.match(/when did i last (.+?)(?:\?|$)/i)
  if(match){
    const {data}=await supabase.rpc('search_memories',{search_query:match[1].trim(),result_limit:5})
    if(!data?.length) return {text:"I don't have a memory about that yet."}
    return {text:`The most recent matching memory I found is “${data[0].original_text}” from ${when(data[0].occurred_at)}.`,source:'Your stored memories'}
  }
  const {data,error}=await supabase.rpc('search_memories',{search_query:q,result_limit:5})
  if(error||!data?.length) return {text:"I don't have a memory about that yet."}
  return {text:`I found this in your memory vault: “${data[0].original_text}”`,source:`Stored memory from ${when(data[0].occurred_at)}`}
}

async function ask(){
  app.innerHTML=shell(`
    <div class="ask-wrap">
      <div class="glass" style="padding:18px;overflow:auto">
        <div class="chat" id="chat">${chat.length?chat.map(message=>`<div class="bubble ${message.role==='user'?'user':''}">${esc(message.text)}${message.source?`<div class="source">Source: ${esc(message.source)}</div>`:''}</div>`).join(''):'<div class="empty"><strong>Ask your own life</strong>Try “Where are my keys?”, “Where were they before?” or “When did I last play basketball?”</div>'}</div>
      </div>
      <div class="glass ask-composer"><input class="input" id="askInput" placeholder="Ask Memora anything about your memories"><button class="btn primary" id="askButton">Ask</button></div>
    </div>
  `,'Ask Memora')
  wire()
  const submit=async()=>{
    const input=document.getElementById('askInput')
    const q=input.value.trim()
    if(!q) return
    chat.push({role:'user',text:q})
    chat.push({role:'assistant',...(await answer(q))})
    ask()
  }
  document.getElementById('askButton').onclick=submit
  document.getElementById('askInput').onkeydown=e=>{if(e.key==='Enter')submit()}
}

async function timeline(){
  const {data}=await supabase.from('memories').select('*').order('occurred_at',{ascending:false})
  app.innerHTML=shell(`
    <div class="section-title"><div><h3>Your life stream</h3><p>A chronological trail of what you chose to remember.</p></div></div>
    <div class="timeline">${data?.length?data.map(m=>`<div class="timeline-entry"><div class="timeline-dot"></div><div class="glass timeline-card"><span class="badge">${esc(typeLabel(m.memory_type))}</span><h3 style="margin:10px 0 6px">${esc(m.summary||m.original_text)}</h3><div class="muted">${esc(m.original_text)}</div><div class="memory-meta"><span>${when(m.occurred_at)}</span><span>•</span><span>${esc((m.provenance_kind||'user_stated').replaceAll('_',' '))}</span></div></div></div>`).join(''):'<div class="glass empty"><strong>Your timeline is waiting</strong>Memories will appear here in time order.</div>'}</div>
  `,'Timeline')
  wire()
}

async function people(){
  const {data}=await supabase.from('people').select('*').order('name')
  app.innerHTML=shell(`
    <div class="section-title"><div><h3>People in your story</h3><p>Names Memora has recognized from your memories.</p></div></div>
    <div class="vault">${data?.length?data.map(p=>`<div class="glass vault-card"><div class="big">◎</div><h3>${esc(p.name)}</h3><div class="muted">${esc(p.relationship||'Person from your memories')}</div><div class="memory-meta">Last seen ${when(p.last_seen_at||p.created_at)}</div></div>`).join(''):'<div class="glass empty"><strong>No people yet</strong>Mention someone in a memory and they can appear here.</div>'}</div>
  `,'People')
  wire()
}

async function places(){
  const {data}=await supabase.from('places').select('*').order('name')
  app.innerHTML=shell(`
    <div class="section-title"><div><h3>Places that matter</h3><p>Homes, cafes, cities and meaningful locations.</p></div></div>
    <div class="vault">${data?.length?data.map(p=>`<div class="glass vault-card"><div class="big">⌖</div><h3>${esc(p.name)}</h3><div class="muted">${esc(p.address||p.category||'Saved place')}</div></div>`).join(''):'<div class="glass empty"><strong>No places yet</strong>Place recognition and imported location history will collect here.</div>'}</div>
  `,'Places')
  wire()
}

async function things(){
  const {data}=await supabase.from('things').select('*').order('updated_at',{ascending:false})
  app.innerHTML=shell(`
    <div class="section-title"><div><h3>Things you never want to lose</h3><p>Current location plus the history of where each item was kept.</p></div></div>
    <div class="vault">${data?.length?data.map(t=>`<div class="glass vault-card"><div class="big">◇</div><div class="item-head"><h3 style="margin:0">${esc(t.name)}</h3><span class="badge photo">Current</span></div><p>Location: <b>${esc(t.current_location||'Unknown')}</b></p><button class="btn" data-history="${t.id}">Location history</button><div id="history-${t.id}" style="margin-top:14px"></div></div>`).join(''):'<div class="glass empty"><strong>No objects tracked yet</strong>Try “I kept my key in the drawer.”</div>'}</div>
  `,'Things')
  wire()
  document.querySelectorAll('[data-history]').forEach(button=>button.onclick=async()=>{
    const {data:history}=await supabase.from('thing_locations').select('*').eq('thing_id',button.dataset.history).order('recorded_at',{ascending:false})
    document.getElementById('history-'+button.dataset.history).innerHTML=history?.length?history.map(h=>`<div style="padding:8px 0;border-top:1px solid var(--line)"><span class="badge">${h.is_current?'Current':'Previous'}</span> ${esc(h.location)} <span class="muted">${shortDate(h.recorded_at)}</span></div>`).join(''):'<div class="muted">No earlier location.</div>'
  })
}

async function rememberDocument(file,note){
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
  const path=`${user.id}/${Date.now()}-${safe}`
  const uploaded=await supabase.storage.from('memora-documents').upload(path,file,{contentType:file.type||'application/octet-stream'})
  if(uploaded.error) throw uploaded.error
  const {data:doc,error}=await supabase.from('documents').insert({
    user_id:user.id,file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,
    description:note||null,processing_status:'pending'
  }).select().single()
  if(error) throw error
  const text=note?.trim()? `${note.trim()} | File: ${file.name}` : `Remember this file: ${file.name}`
  const memory=await supabase.from('memories').insert({
    user_id:user.id,original_text:text,summary:note?.trim()||file.name,memory_type:'document',state:'current',
    occurred_at:new Date().toISOString(),source_type:'document',provenance_kind:'user_stated',confidence:1,
    document_id:doc.id,valid_from:new Date().toISOString(),interpreted_data:{file_name:file.name}
  })
  if(memory.error) throw memory.error
}

async function documents(){
  const {data}=await supabase.from('documents').select('*').order('created_at',{ascending:false})
  app.innerHTML=shell(`
    <div class="grid two">
      <div class="glass" style="padding:22px">
        <div class="eyebrow">Memory from a file</div>
        <h3>Drop in something important</h3>
        <p class="muted">PDFs, Word documents, receipts, screenshots and other files can become part of your memory vault.</p>
        <textarea class="input" id="docNote" placeholder="Optional note, for example: My vehicle insurance policy for 2026"></textarea>
        <label class="file-zone" style="display:block;margin-top:12px">
          <strong>Choose a file</strong><div class="muted" style="margin-top:6px">Stored privately in your account</div>
          <input type="file" id="fileInput">
        </label>
        <div id="uploadMsg" class="muted" style="margin-top:10px"></div>
      </div>
      <div class="glass" style="padding:22px">
        <div class="eyebrow">What happens next</div>
        <h3>Files become searchable memory</h3>
        <p class="muted">The current version stores and links the file securely. Deep text extraction and AI document Q&A are prepared as the next intelligence layer.</p>
        <div class="chips"><span class="chip active">Private storage</span><span class="chip">Source tracking</span><span class="chip">Document memory</span></div>
      </div>
    </div>
    <div class="section-title"><div><h3>Your files</h3><p>Documents you asked Memora to remember.</p></div></div>
    <div class="list">${data?.length?data.map(d=>`<div class="glass item"><div class="item-head"><div><strong>${esc(d.file_name)}</strong><div class="muted">${esc(d.description||d.mime_type||'Stored document')}</div></div><span class="badge imported">File</span></div><div class="memory-meta">${when(d.created_at)}</div></div>`).join(''):'<div class="glass empty"><strong>No files yet</strong>Add a document above and give it a note.</div>'}</div>
  `,'Documents')
  wire()
  document.getElementById('fileInput').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('uploadMsg')
    msg.textContent='Saving file into your memory vault...'
    try{
      await rememberDocument(file,document.getElementById('docNote').value)
      toast('File remembered')
      documents()
    }catch(error){msg.textContent=error.message}
  }
}

function extractConversationText(conversation){
  const messages=[]
  const mapping=conversation?.mapping||{}
  Object.values(mapping).forEach(node=>{
    const parts=node?.message?.content?.parts
    if(Array.isArray(parts)){
      const joined=parts.filter(x=>typeof x==='string').join(' ').trim()
      if(joined) messages.push(joined)
    }
  })
  return messages.join('\n').slice(0,12000)
}

async function importChatGPT(file){
  const raw=await file.text()
  const parsed=JSON.parse(raw)
  const conversations=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.conversations)?parsed.conversations:[])
  if(!conversations.length) throw new Error('I could not find ChatGPT conversations in this JSON file.')
  const source=await supabase.from('sources').insert({
    user_id:user.id,source_type:'chatgpt_import',source_name:file.name,metadata:{imported_at:new Date().toISOString(),count:conversations.length}
  }).select().single()
  if(source.error) throw source.error
  let imported=0
  for(const conversation of conversations.slice(0,100)){
    const body=extractConversationText(conversation)
    if(!body) continue
    const title=conversation.title||'Imported ChatGPT conversation'
    const result=await supabase.from('memories').insert({
      user_id:user.id,original_text:body,summary:title,memory_type:'conversation',state:'historical',
      occurred_at:conversation.create_time?new Date(conversation.create_time*1000).toISOString():new Date().toISOString(),
      source_type:'import',provenance_kind:'imported',source_id:source.data.id,confidence:1,
      interpreted_data:{source:'ChatGPT export',title}
    })
    if(!result.error) imported++
  }
  return imported
}

async function connections(){
  app.innerHTML=shell(`
    <div class="section-title"><div><h3>Bring your digital life together</h3><p>Imports work today where possible. Direct account connections require each provider's OAuth/API setup and will never be faked.</p></div></div>
    <div class="source-board">
      <div class="glass source-card"><span class="source-status">Works now</span><div class="source-icon">AI</div><h4>ChatGPT history</h4><p>Import your ChatGPT conversations from an exported JSON file and make them searchable memories.</p><button class="btn primary" id="chatgptImportBtn">Import export</button><input class="hidden" id="chatgptFile" type="file" accept=".json,application/json"></div>
      <div class="glass source-card"><span class="source-status">Import</span><div class="source-icon">⌖</div><h4>Google Maps Timeline</h4><p>Designed for exported Timeline/history data while respecting Google's current device-centered Timeline model.</p><button class="btn" id="timelineImportInfo">Import file</button></div>
      <div class="glass source-card"><span class="source-status">Planned</span><div class="source-icon">G</div><h4>Google ecosystem</h4><p>Calendar, Gmail, Drive and Photos can be added through user-authorized provider connections.</p><button class="btn" disabled>OAuth setup required</button></div>
      <div class="glass source-card"><span class="source-status">Planned</span><div class="source-icon">M</div><h4>Microsoft 365</h4><p>Outlook, OneDrive, Calendar and SharePoint are designed as future connected memory sources.</p><button class="btn" disabled>OAuth setup required</button></div>
      <div class="glass source-card"><span class="source-status">Works now</span><div class="source-icon">▣</div><h4>Files and documents</h4><p>Upload documents, receipts, screenshots and files with a note so you can remember why they matter.</p><button class="btn" id="documentsJump">Open Documents</button></div>
      <div class="glass source-card"><span class="source-status">Works now</span><div class="source-icon">◉</div><h4>Camera and photos</h4><p>Take a photo while creating a memory or attach existing images and video from your device.</p><button class="btn" id="cameraJump">Create visual memory</button></div>
    </div>
    <div id="connectionMsg" class="muted" style="margin-top:14px"></div>
  `,'Connections')
  wire()
  document.getElementById('documentsJump').onclick=()=>go('documents')
  document.getElementById('cameraJump').onclick=()=>go('home',true)
  document.getElementById('timelineImportInfo').onclick=()=>toast('Timeline import parser is the next connector module. The source card is ready without pretending a live API exists.')
  document.getElementById('chatgptImportBtn').onclick=()=>document.getElementById('chatgptFile').click()
  document.getElementById('chatgptFile').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('connectionMsg')
    msg.textContent='Importing ChatGPT history...'
    try{
      const count=await importChatGPT(file)
      msg.textContent=`Imported ${count} conversations into Memora.`
      toast('ChatGPT memories imported')
    }catch(error){msg.textContent=error.message}
  }
}

async function settings(){
  const {data:profile}=await supabase.from('profiles').select('*').maybeSingle()
  app.innerHTML=shell(`
    <div class="grid two">
      <div class="glass" style="padding:22px">
        <div class="eyebrow">Identity</div><h3>Profile</h3>
        <div style="display:grid;gap:10px">
          <input class="input" id="displayName" value="${esc(profile?.display_name||'')}" placeholder="Display name">
          <input class="input" id="timezone" value="${esc(profile?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone)}" placeholder="Timezone">
          <button class="btn primary" id="saveProfile">Save profile</button>
        </div>
      </div>
      <div class="glass" style="padding:22px">
        <div class="eyebrow">Privacy</div><h3>Your data stays yours</h3>
        <p class="muted">Memory rows and private files are restricted to your signed-in user through Supabase Row Level Security.</p>
        <div class="actions"><button class="btn" id="exportData">Export memories</button><button class="btn danger" id="deleteAll">Delete all memories</button></div>
      </div>
    </div>
  `,'Settings')
  wire()
  document.getElementById('saveProfile').onclick=async()=>{
    const display_name=document.getElementById('displayName').value.trim()
    const timezone=document.getElementById('timezone').value.trim()
    const {error}=await supabase.from('profiles').upsert({user_id:user.id,display_name,timezone})
    toast(error?error.message:'Profile saved')
  }
  document.getElementById('exportData').onclick=async()=>{
    const [{data:memoryData},{data:thingData},{data:peopleData}]=await Promise.all([
      supabase.from('memories').select('*').order('created_at'),
      supabase.from('things').select('*'),
      supabase.from('people').select('*')
    ])
    const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),memories:memoryData,things:thingData,people:peopleData},null,2)],{type:'application/json'})
    const link=document.createElement('a')
    link.href=URL.createObjectURL(blob)
    link.download='memora-export.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  document.getElementById('deleteAll').onclick=async()=>{
    if(!confirm('Delete all memories? This cannot be undone.')) return
    const {error}=await supabase.from('memories').delete().eq('user_id',user.id)
    toast(error?error.message:'Memories deleted')
  }
}

const session=await supabase.auth.getSession()
user=session.data.session?.user||null
supabase.auth.onAuthStateChange((_event,sessionNow)=>{user=sessionNow?.user||null})
if(user) render()
else authScreen()

if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{})
