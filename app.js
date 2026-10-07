import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
const app = document.getElementById('app')

let user = null
let view = 'home'
let chat = []
let pendingMedia = []
let pendingLocation = null
let recorder = null
let recorderStream = null
let recorderChunks = []
let cameraStream = null
let cameraFacing = 'environment'
let conversationContext = { thing: null }
let lastThemeHour = null

const themeFamilies = [
  {id:'aurora',name:'Aurora',h:252},{id:'ocean',name:'Ocean',h:210},{id:'rose',name:'Rose',h:330},
  {id:'forest',name:'Forest',h:145},{id:'solar',name:'Solar',h:28},{id:'lavender',name:'Lavender',h:275},
  {id:'arctic',name:'Arctic',h:190},{id:'ember',name:'Ember',h:8},{id:'neon',name:'Neon',h:300},
  {id:'sakura',name:'Sakura',h:345},{id:'copper',name:'Copper',h:22},{id:'galaxy',name:'Galaxy',h:235}
]
const themeMoods = [
  {id:'dawn',name:'Dawn',s:82,l:66,b:8},{id:'mist',name:'Mist',s:58,l:70,b:10},
  {id:'silk',name:'Silk',s:70,l:64,b:7},{id:'glow',name:'Glow',s:90,l:62,b:8},
  {id:'night',name:'Night',s:74,l:58,b:4},{id:'pearl',name:'Pearl',s:46,l:74,b:11},
  {id:'deep',name:'Deep',s:80,l:54,b:3},{id:'dream',name:'Dream',s:76,l:67,b:7},
  {id:'pulse',name:'Pulse',s:96,l:60,b:5},{id:'velvet',name:'Velvet',s:64,l:61,b:4}
]
const themeCatalog = themeFamilies.flatMap((family,fi)=>themeMoods.map((mood,mi)=>{
  const h1=(family.h+mi*3)%360
  const h2=(family.h+48+mi*4)%360
  const h3=(family.h+112+mi*2)%360
  const bgHue=(family.h+mi*2)%360
  return {
    id:`${family.id}-${mood.id}`,
    label:`${family.name} ${mood.name}`,
    family:family.name,
    c1:`hsl(${h1} ${mood.s}% ${mood.l}%)`,
    c2:`hsl(${h2} ${Math.max(48,mood.s-8)}% ${Math.min(74,mood.l+2)}%)`,
    c3:`hsl(${h3} ${Math.min(96,mood.s+4)}% ${Math.min(76,mood.l+4)}%)`,
    bg0:`hsl(${bgHue} 36% ${mood.b}%)`,
    bg1:`hsl(${(bgHue+12)%360} 42% ${mood.b+4}%)`,
    bg2:`hsl(${(bgHue+24)%360} 40% ${mood.b+7}%)`
  }
}))
const manualThemes = Object.fromEntries(themeCatalog.map(theme=>[theme.id,theme]))


const esc = value => String(value ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const when = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Unknown date'
const shortDate = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value)) : 'Unknown'

const typeLabel = type => ({
  note:'Moment',object:'Object',activity:'Activity',event:'Event',person:'Person',place:'Place',
  task:'Task',document:'Document',preference:'Preference',personal_fact:'Personal fact',
  object_location:'Object location',reminder:'Reminder',document_fact:'Document fact',
  conversation:'Conversation',other:'Memory'
}[type] || 'Memory')

function toast(message){
  const el=document.createElement('div')
  el.className='toast'
  el.textContent=message
  document.body.appendChild(el)
  setTimeout(()=>el.remove(),2600)
}

function modal(title,body){
  const wrap=document.createElement('div')
  wrap.className='modal-backdrop'
  wrap.innerHTML=`<div class="glass modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="close" aria-label="Close">×</button></div>${body}</div>`
  wrap.querySelector('.close').onclick=()=>wrap.remove()
  wrap.onclick=e=>{if(e.target===wrap)wrap.remove()}
  document.body.appendChild(wrap)
  return wrap
}

function applyTheme(values,label){
  const root=document.documentElement
  Object.entries(values).forEach(([key,value])=>root.style.setProperty(`--${key}`,value))
  root.dataset.themeLabel=label
  const labelEl=document.getElementById('themeLabel')
  if(labelEl) labelEl.textContent=label
  const meta=document.querySelector('meta[name="theme-color"]')
  if(meta) meta.setAttribute('content',values.bg0)
}

function adaptiveTheme(){
  const now=new Date()
  const hour=now.getHours()
  const day=Math.floor(Date.now()/86400000)
  const theme=themeCatalog[(day*24+hour)%themeCatalog.length]
  const daypart=hour>=5&&hour<8?'Dawn':hour>=8&&hour<12?'Morning':hour>=12&&hour<16?'Daylight':hour>=16&&hour<19?'Golden Hour':hour>=19&&hour<22?'Twilight':'Night'
  applyTheme(theme,`${daypart} · ${theme.label} · ${hour.toString().padStart(2,'0')}:00`)
  lastThemeHour=hour
}

function updateTheme(){
  const mode=localStorage.getItem('memora-theme')||'auto'
  if(mode==='auto') adaptiveTheme()
  else {
    const theme=manualThemes[mode]||themeCatalog[0]
    applyTheme(theme,theme.label)
  }
}

function openThemePicker(){
  const current=localStorage.getItem('memora-theme')||'auto'
  const body=`
    <p class="muted">Adaptive mode changes the visual atmosphere every hour. You can also choose from ${themeCatalog.length} handcrafted color combinations.</p>
    <div class="theme-picker-tools">
      <input class="input" id="themeSearch" placeholder="Search 120 themes, for example Ocean, Velvet or Sakura">
      <button class="btn" id="randomTheme">Surprise me</button>
      <button class="btn ${current==='auto'?'primary':''}" data-theme="auto">Adaptive hourly</button>
    </div>
    <div class="theme-gallery" id="themeGallery">
      ${themeCatalog.map(theme=>`<button class="theme-card ${current===theme.id?'selected':''}" data-theme="${theme.id}" data-theme-name="${theme.label.toLowerCase()}" style="--t1:${theme.c1};--t2:${theme.c2};--t3:${theme.c3};--tb:${theme.bg1}"><span></span><small>${theme.label}</small></button>`).join('')}
    </div>`
  const box=modal('Theme Universe',body)
  const applyChoice=id=>{
    localStorage.setItem('memora-theme',id)
    updateTheme()
    box.remove()
    toast(id==='auto'?'Adaptive hourly theme enabled':'Theme updated')
  }
  box.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>applyChoice(button.dataset.theme))
  box.querySelector('#randomTheme').onclick=()=>{
    const theme=themeCatalog[Math.floor(Math.random()*themeCatalog.length)]
    applyChoice(theme.id)
  }
  box.querySelector('#themeSearch').oninput=event=>{
    const term=event.target.value.trim().toLowerCase()
    box.querySelectorAll('.theme-card').forEach(card=>{
      card.classList.toggle('hidden',term&&!card.dataset.themeName.includes(term))
    })
  }
}

function setupAtmosphere(){
  updateTheme()
  document.addEventListener('pointermove',event=>{
    const x=Math.round(event.clientX/window.innerWidth*100)
    const y=Math.round(event.clientY/window.innerHeight*100)
    document.documentElement.style.setProperty('--pointer-x',`${x}%`)
    document.documentElement.style.setProperty('--pointer-y',`${y}%`)
  },{passive:true})
  setInterval(()=>{
    const mode=localStorage.getItem('memora-theme')||'auto'
    if(mode==='auto'&&new Date().getHours()!==lastThemeHour) adaptiveTheme()
  },60000)
}

function openThemePicker(){
  const body=`
    <p class="muted">Auto changes the atmosphere every hour using your device time. Manual themes stay fixed on this device.</p>
    <div class="theme-menu">
      <button class="theme-swatch auto" data-theme="auto">AUTO</button>
      <button class="theme-swatch" data-theme="aurora" style="background:linear-gradient(135deg,#8b7cff,#50d8d0,#ff7cac)"></button>
      <button class="theme-swatch" data-theme="ocean" style="background:linear-gradient(135deg,#4f8cff,#3de1d2,#73b7ff)"></button>
      <button class="theme-swatch" data-theme="rose" style="background:linear-gradient(135deg,#f06ca9,#b589ff,#ffad70)"></button>
      <button class="theme-swatch" data-theme="forest" style="background:linear-gradient(135deg,#65d99c,#57c9c1,#b1d86f)"></button>
      <button class="theme-swatch" data-theme="solar" style="background:linear-gradient(135deg,#ff9d58,#ffc861,#ff6f91)"></button>
      <button class="theme-swatch" data-theme="mono" style="background:linear-gradient(135deg,#d5d9e2,#8ea0b8,#ffffff)"></button>
    </div>`
  const box=modal('Choose your atmosphere',body)
  box.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{
    localStorage.setItem('memora-theme',button.dataset.theme)
    updateTheme()
    box.remove()
    toast('Theme updated')
  })
}

async function oauthSignIn(provider,scopes){
  const options={redirectTo:window.location.origin}
  if(scopes) options.scopes=scopes
  const {error}=await supabase.auth.signInWithOAuth({provider,options})
  if(error) toast(error.message)
}

async function magicLink(email){
  if(!email) return toast('Enter your email first')
  const {error}=await supabase.auth.signInWithOtp({
    email,
    options:{emailRedirectTo:window.location.origin,shouldCreateUser:true}
  })
  toast(error?error.message:'Magic link sent. Check your email.')
}

function authScreen(mode='login'){
  app.innerHTML=`
  <div class="auth-wrap">
    <div class="glass auth-card">
      <div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>A private universe for your life</small></div></div>
      <div class="eyebrow">Your memory, beautifully organized</div>
      <h2>${mode==='login'?'Welcome back':'Create your private universe'}</h2>
      <p class="muted">Memories can include text, photos, video, voice, places, files and connected sources.</p>
      <div class="social-grid">
        <button class="social" data-oauth="google">Continue with Google</button>
        <button class="social" data-oauth="azure">Continue with Microsoft</button>
        <button class="social" data-oauth="apple">Continue with Apple</button>
        <button class="social" data-oauth="github">Continue with GitHub</button>
      </div>
      <div class="divider">OR USE EMAIL</div>
      <form id="authForm">
        ${mode==='signup'?'<input class="input" id="name" placeholder="Your name" required>':''}
        <input class="input" id="email" type="email" placeholder="Email" required>
        <input class="input" id="password" type="password" minlength="8" placeholder="Password" required>
        <button class="btn primary" type="submit">${mode==='login'?'Enter Memora':'Create account'}</button>
      </form>
      <div class="grid two" style="margin-top:9px">
        <button class="btn" id="magicLink">Email me a magic link</button>
        <button class="btn" id="switchMode">${mode==='login'?'Create new account':'I already have an account'}</button>
      </div>
      <p id="authMsg" class="muted"></p>
      <p class="small muted">Social providers appear here now. Each provider must also be enabled in the Memora Supabase authentication settings before first use.</p>
    </div>
  </div>`
  document.querySelectorAll('[data-oauth]').forEach(button=>button.onclick=()=>{
    const provider=button.dataset.oauth
    oauthSignIn(provider,provider==='azure'?'email':undefined)
  })
  document.getElementById('magicLink').onclick=()=>magicLink(document.getElementById('email').value.trim())
  document.getElementById('switchMode').onclick=()=>authScreen(mode==='login'?'signup':'login')
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

const dockItems=[
  ['home','⌂','Home'],
  ['memories','✦','Memories'],
  ['ask','◎','Ask'],
  ['capture','＋',''],
  ['timeline','◷','Timeline'],
  ['sources','◉','Sources'],
  ['vault','◇','Vault']
]

function shell(content,title,subtitle=''){
  return `
  <div class="app">
    <header class="topbar">
      <div class="brand" id="brandHome"><div class="logo">M</div><div><h1>Memora</h1><small>Your life, remembered beautifully</small></div></div>
      <div class="top-actions">
        <button class="icon-btn" id="themeButton"><span class="theme-text" id="themeLabel">${esc(document.documentElement.dataset.themeLabel||'Adaptive')}</span> ✦</button>
        <button class="icon-btn" id="settingsButton">Profile</button>
      </div>
    </header>
    <main class="main">
      ${title?`<div class="page-head"><div><div class="eyebrow">Memora</div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div>`:''}
      ${content}
    </main>
    <nav class="dock">
      ${dockItems.map(([id,icon,label])=>id==='capture'
        ?`<button class="capture" id="dockCapture" aria-label="New memory">${icon}</button>`
        :`<button data-nav="${id}" class="${view===id?'active':''}"><span>${icon}</span><small>${label}</small></button>`
      ).join('')}
    </nav>
  </div>`
}

function wire(){
  document.querySelectorAll('[data-nav]').forEach(button=>button.onclick=()=>go(button.dataset.nav))
  document.getElementById('dockCapture')?.addEventListener('click',()=>go('home',true))
  document.getElementById('brandHome')?.addEventListener('click',()=>go('home'))
  document.getElementById('themeButton')?.addEventListener('click',openThemePicker)
  document.getElementById('settingsButton')?.addEventListener('click',()=>go('settings'))
}

async function go(next,focus=false){
  view=next
  const routes={home,memories,ask,timeline,sources,vault,people,places,things,documents,settings}
  await (routes[next]||home)()
  if(focus) setTimeout(()=>document.getElementById('memoryInput')?.focus(),50)
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
    const upload=await supabase.storage.from('memora-media').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false})
    if(upload.error) throw upload.error
    const mediaType=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'image'
    const row=await supabase.from('memory_media').insert({
      user_id:user.id,memory_id:memoryId,storage_path:path,file_name:file.name,mime_type:file.type,media_type:mediaType
    })
    if(row.error) throw row.error
  }
}

async function saveMemory(text,files=[],location=null){
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
  await syncEntitiesFromMemory(memory,text)
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
  if(location){
    const context=await supabase.from('memory_contexts').insert({
      user_id:user.id,memory_id:memory.id,context_type:'location',
      data:{latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy,captured_at:new Date().toISOString()}
    })
    if(context.error) throw context.error
  }
  return memory
}

function renderPending(){
  const target=document.getElementById('pendingPreview')
  if(!target) return
  target.innerHTML=pendingMedia.map((file,index)=>{
    const url=URL.createObjectURL(file)
    let media
    if(file.type.startsWith('video/')) media=`<video src="${url}" muted playsinline></video>`
    else if(file.type.startsWith('audio/')) media=`<div class="preview audio">Voice note</div>`
    else media=`<img src="${url}" alt="">`
    return `<div class="preview ${file.type.startsWith('audio/')?'audio':''}">${media}<button data-remove-media="${index}">×</button></div>`
  }).join('')
  document.querySelectorAll('[data-remove-media]').forEach(button=>button.onclick=()=>{
    pendingMedia.splice(Number(button.dataset.removeMedia),1)
    renderPending()
  })
  const context=document.getElementById('captureContext')
  if(context){
    context.innerHTML=pendingLocation
      ?`<span class="context-pill location">Location attached · ±${Math.round(pendingLocation.accuracy||0)} m <button class="kebab" id="removeLocation">×</button></span>`
      :''
    document.getElementById('removeLocation')?.addEventListener('click',()=>{pendingLocation=null;renderPending()})
  }
}

function attachCurrentLocation(){
  if(!navigator.geolocation) return toast('Location is not available in this browser')
  toast('Requesting your location...')
  navigator.geolocation.getCurrentPosition(
    pos=>{
      pendingLocation={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy}
      renderPending()
      toast('Current location attached')
    },
    err=>toast(err.message),
    {enableHighAccuracy:true,timeout:12000,maximumAge:30000}
  )
}

async function toggleRecording(){
  const button=document.getElementById('voiceBtn')
  if(recorder&&recorder.state==='recording'){
    recorder.stop()
    button?.classList.remove('recording')
    if(button) button.textContent='Voice'
    return
  }
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder) return toast('Voice recording is not supported in this browser')
  try{
    recorderStream=await navigator.mediaDevices.getUserMedia({audio:true})
    recorderChunks=[]
    recorder=new MediaRecorder(recorderStream)
    recorder.ondataavailable=e=>{if(e.data.size)recorderChunks.push(e.data)}
    recorder.onstop=()=>{
      const type=recorder.mimeType||'audio/webm'
      const blob=new Blob(recorderChunks,{type})
      const file=new File([blob],`voice-${Date.now()}.webm`,{type})
      pendingMedia.push(file)
      recorderStream?.getTracks().forEach(track=>track.stop())
      recorderStream=null
      recorder=null
      renderPending()
      toast('Voice note attached')
    }
    recorder.start()
    button?.classList.add('recording')
    if(button) button.textContent='Stop voice'
  }catch(error){toast(error.message)}
}

function bindComposerInputs(){
  const photo=document.getElementById('photoInput')
  const camera=document.getElementById('cameraInput')
  const video=document.getElementById('videoInput')
  document.getElementById('photoBtn')?.addEventListener('click',()=>photo?.click())
  document.getElementById('cameraBtn')?.addEventListener('click',()=>openLiveCamera('photo'))
  document.getElementById('videoBtn')?.addEventListener('click',()=>openLiveCamera('video'))
  document.getElementById('voiceBtn')?.addEventListener('click',toggleRecording)
  document.getElementById('locationBtn')?.addEventListener('click',attachCurrentLocation)
  ;[photo,camera,video].forEach(input=>input?.addEventListener('change',event=>{
    const files=[...event.target.files].filter(f=>f.type.startsWith('image/')||f.type.startsWith('video/'))
    pendingMedia.push(...files.slice(0,8-pendingMedia.length))
    renderPending()
    event.target.value=''
  }))
}

async function hydrateMemoryExtras(memoriesList){
  if(!memoriesList?.length) return
  const ids=memoriesList.map(m=>m.id)
  const [{data:media},{data:contexts}]=await Promise.all([
    supabase.from('memory_media').select('*').in('memory_id',ids).order('created_at'),
    supabase.from('memory_contexts').select('*').in('memory_id',ids).eq('context_type','location')
  ])
  const mediaGrouped={}
  for(const item of media||[]){
    if(mediaGrouped[item.memory_id]) continue
    const signed=await supabase.storage.from('memora-media').createSignedUrl(item.storage_path,3600)
    if(signed.data?.signedUrl) mediaGrouped[item.memory_id]={...item,url:signed.data.signedUrl}
  }
  Object.entries(mediaGrouped).forEach(([memoryId,item])=>{
    const slot=document.querySelector(`[data-media-slot="${memoryId}"]`)
    if(!slot) return
    if(item.media_type==='video') slot.innerHTML=`<video src="${item.url}" controls playsinline></video>`
    else if(item.media_type==='audio') slot.innerHTML=`<div style="height:100%;display:grid;place-items:center"><audio src="${item.url}" controls></audio></div>`
    else slot.innerHTML=`<img src="${item.url}" alt="Memory attachment">`
    slot.classList.remove('hidden')
    document.querySelector(`[data-media-badge="${memoryId}"]`)?.classList.remove('hidden')
  })
  for(const ctx of contexts||[]){
    const el=document.querySelector(`[data-location-slot="${ctx.memory_id}"]`)
    if(!el) continue
    const lat=ctx.data?.latitude,lon=ctx.data?.longitude
    if(lat==null||lon==null) continue
    const href=`https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`
    el.innerHTML=`<a class="context-pill location" href="${href}" target="_blank" rel="noreferrer">Location attached</a>`
  }
}

function memoryCard(m){
  return `<article class="glass memory-card">
    <div class="memory-media hidden" data-media-slot="${m.id}"></div>
    <div class="memory-body">
      <div class="memory-top">
        <div><span class="badge">${esc(typeLabel(m.memory_type))}</span> <span class="badge alt hidden" data-media-badge="${m.id}">Media</span></div>
        <button class="kebab" data-delete-memory="${m.id}" title="Delete">•••</button>
      </div>
      <div class="memory-title">${esc(m.summary||m.original_text)}</div>
      <div class="memory-original">${esc(m.original_text)}</div>
      <div class="context-row" data-location-slot="${m.id}"></div>
      <div class="memory-meta"><span>${shortDate(m.occurred_at||m.created_at)}</span><span>•</span><span>${esc((m.provenance_kind||'user_stated').replaceAll('_',' '))}</span></div>
    </div>
  </article>`
}


function weatherLabel(code){
  if(code===0) return 'Clear'
  if([1,2].includes(code)) return 'Mostly clear'
  if(code===3) return 'Cloudy'
  if([45,48].includes(code)) return 'Fog'
  if(code>=51&&code<=67) return 'Rain'
  if(code>=71&&code<=77) return 'Snow'
  if(code>=80&&code<=82) return 'Showers'
  if(code>=95) return 'Thunderstorm'
  return 'Weather'
}

async function getLivePulse(){
  const now=new Date()
  const network=navigator.onLine?'Online':'Offline'
  const connection=navigator.connection?.effectiveType?String(navigator.connection.effectiveType).toUpperCase():'Connected'
  const base={time:now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),network,connection}
  if(!navigator.geolocation) return {...base,error:'Location is unavailable in this browser'}
  const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:300000}))
  const {latitude,longitude,accuracy}=position.coords
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
  const response=await fetch(url)
  if(!response.ok) throw new Error('Live weather is temporarily unavailable')
  const weather=await response.json()
  return {...base,latitude,longitude,accuracy,current:weather.current,current_units:weather.current_units,timezone:weather.timezone}
}

async function refreshLivePulse(){
  const target=document.getElementById('livePulse')
  if(!target) return
  target.innerHTML='<div class="glass live-card loading">Loading live context...</div>'
  try{
    const pulse=await getLivePulse()
    localStorage.setItem('memora-live-context','1')
    const c=pulse.current||{}
    target.innerHTML=`
      <div class="glass live-card"><span class="live-orb"></span><div class="eyebrow">Local time</div><b>${esc(pulse.time)}</b><small>${esc(pulse.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone)}</small></div>
      <div class="glass live-card"><span class="live-orb"></span><div class="eyebrow">Weather now</div><b>${c.temperature_2m!=null?`${Math.round(c.temperature_2m)}°`:'--'}</b><small>${esc(weatherLabel(c.weather_code))} · feels ${c.apparent_temperature!=null?Math.round(c.apparent_temperature)+'°':'--'}</small></div>
      <div class="glass live-card"><span class="live-orb"></span><div class="eyebrow">Network</div><b>${esc(pulse.network)}</b><small>${esc(pulse.connection)}</small></div>
      <div class="glass live-card"><span class="live-orb"></span><div class="eyebrow">Location context</div><b>Ready</b><small>Approx. accuracy ±${Math.round(pulse.accuracy||0)} m</small></div>
    `
  }catch(error){
    target.innerHTML=`<div class="glass live-card wide"><div><b>Live context is off</b><small>${esc(error.message||'Allow location to enable live weather and location context.')}</small></div><button class="btn" id="retryLive">Enable</button></div>`
    document.getElementById('retryLive')?.addEventListener('click',refreshLivePulse)
  }
}

async function home(){
  const [{count:memoryCount},{count:thingCount},{count:docCount},{data:recent},{data:profile}]=await Promise.all([
    supabase.from('memories').select('*',{count:'exact',head:true}),
    supabase.from('things').select('*',{count:'exact',head:true}),
    supabase.from('documents').select('*',{count:'exact',head:true}),
    supabase.from('memories').select('*').order('created_at',{ascending:false}).limit(6),
    supabase.from('profiles').select('display_name').maybeSingle()
  ])
  const firstName=(profile?.display_name||'').split(' ')[0]
  app.innerHTML=shell(`
    <section class="glass hero">
      <div class="hero-content">
        <div class="eyebrow">${firstName?`Hello ${esc(firstName)} · `:''}Capture anything</div>
        <h2><span class="gradient-text">A living universe of your memories.</span></h2>
        <p>Write it, photograph it, record it, attach your location or add a file. Memora keeps the detail, the source and the history together.</p>
        <div class="composer">
          <textarea id="memoryInput" placeholder="I kept my keys in the top drawer beside the watch..."></textarea>
          <div id="pendingPreview" class="preview-strip"></div>
          <div id="captureContext" class="context-row"></div>
          <div class="capture-tools">
            <div class="tool-group">
              <button class="tool" id="cameraBtn">Camera</button>
              <button class="tool" id="photoBtn">Photos</button>
              <button class="tool" id="videoBtn">Video</button>
              <button class="tool" id="voiceBtn">Voice</button>
              <button class="tool" id="locationBtn">Location</button>
              <button class="tool" id="fileBtn">File</button>
              <input class="hidden" id="cameraInput" type="file" accept="image/*" capture="environment">
              <input class="hidden" id="photoInput" type="file" accept="image/*" multiple>
              <input class="hidden" id="videoInput" type="file" accept="video/*" capture="environment">
            </div>
            <button class="btn primary" id="saveMemory">Remember this</button>
          </div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h3>Your memory space</h3><p>It grows as your life grows.</p></div></div>
      <div class="grid three">
        <div class="glass stat" style="--accent:var(--c1)"><span class="muted">Memories</span><b>${memoryCount||0}</b></div>
        <div class="glass stat" style="--accent:var(--c2)"><span class="muted">Things tracked</span><b>${thingCount||0}</b></div>
        <div class="glass stat" style="--accent:var(--c3)"><span class="muted">Files remembered</span><b>${docCount||0}</b></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h3>Live Pulse</h3><p>Optional live context from this device. Nothing is stored unless you save a memory.</p></div><button class="btn" id="enableLivePulse">Refresh live</button></div>
      <div class="live-grid" id="livePulse"><div class="glass live-card wide"><div><b>Live context is optional</b><small>Enable current weather, local time, network and approximate location context.</small></div><button class="btn primary" id="livePulseStart">Enable</button></div></div>
    </section>
    <section class="section">
      <div class="section-head"><div><h3>Recent memories</h3><p>Your newest moments, objects and details.</p></div><button class="btn" data-nav="memories">See gallery</button></div>
      <div class="memory-grid">${recent?.length?recent.map(memoryCard).join(''):'<div class="glass empty"><strong>Your universe is waiting</strong>Add a sentence, image, video, voice note or location.</div>'}</div>
    </section>
  `)
  wire()
  bindComposerInputs()
  renderPending()
  document.getElementById('fileBtn').onclick=()=>go('documents')
  document.getElementById('saveMemory').onclick=async()=>{
    const input=document.getElementById('memoryInput')
    let text=input.value.trim()
    if(!text&&pendingMedia.length) text='Visual memory'
    if(!text&&pendingLocation) text='Location memory'
    if(!text) return toast('Add a note, media or location first')
    const button=document.getElementById('saveMemory')
    button.disabled=true
    button.textContent='Saving...'
    try{
      await saveMemory(text,pendingMedia,pendingLocation)
      pendingMedia=[]
      pendingLocation=null
      toast('Memory saved')
      await home()
    }catch(error){
      toast(error.message)
      button.disabled=false
      button.textContent='Remember this'
    }
  }
  document.getElementById('enableLivePulse')?.addEventListener('click',refreshLivePulse)
  document.getElementById('livePulseStart')?.addEventListener('click',refreshLivePulse)
  if(localStorage.getItem('memora-live-context')==='1') refreshLivePulse()
  bindDeletes()
  await hydrateMemoryExtras(recent||[])
}

async function memories(){
  const {data,error}=await supabase.from('memories').select('*').order('created_at',{ascending:false})
  const all=data||[]
  app.innerHTML=shell(`
    <div class="glass" style="padding:16px;border-radius:22px">
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px">
        <input class="input" id="memorySearch" placeholder="Search a person, place, object, activity or phrase">
        <button class="btn primary" id="searchMemory">Search</button>
      </div>
      <div class="filter-row" style="margin-top:12px">
        <button class="chip active" data-filter="all">All</button>
        <button class="chip" data-filter="object">Things</button>
        <button class="chip" data-filter="activity">Activities</button>
        <button class="chip" data-filter="document">Files</button>
        <button class="chip" data-filter="conversation">Conversations</button>
      </div>
    </div>
    <section class="section">
      <div class="section-head"><div><h3>Memory gallery</h3><p>A visual archive you can search and filter.</p></div></div>
      <div class="memory-grid" id="memoryList">${error?esc(error.message):all.length?all.map(memoryCard).join(''):'<div class="glass empty"><strong>No memories yet</strong>Capture your first memory from Home.</div>'}</div>
    </section>
  `,'Memories','Everything you chose to remember, in one place.')
  wire()
  bindDeletes()
  await hydrateMemoryExtras(all)
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=async()=>{
    document.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'))
    button.classList.add('active')
    const filter=button.dataset.filter
    const filtered=filter==='all'?all:all.filter(m=>m.memory_type===filter)
    document.getElementById('memoryList').innerHTML=filtered.length?filtered.map(memoryCard).join(''):'<div class="glass empty"><strong>No matches</strong>Nothing in this category yet.</div>'
    bindDeletes()
    await hydrateMemoryExtras(filtered)
  })
  document.getElementById('searchMemory').onclick=async()=>{
    const q=document.getElementById('memorySearch').value.trim()
    if(!q) return memories()
    const result=await supabase.rpc('search_memories',{search_query:q,result_limit:50})
    const found=result.data||[]
    document.getElementById('memoryList').innerHTML=result.error?esc(result.error.message):found.length?found.map(m=>memoryCard({...m,created_at:m.occurred_at})).join(''):'<div class="glass empty"><strong>Nothing matched</strong>Try another word or phrase.</div>'
    bindDeletes()
    await hydrateMemoryExtras(found)
  }
}

function bindDeletes(){
  document.querySelectorAll('[data-delete-memory]').forEach(button=>button.onclick=async()=>{
    if(!confirm('Delete this memory and its linked media?')) return
    const memoryId=button.dataset.deleteMemory
    const {data:media}=await supabase.from('memory_media').select('storage_path').eq('memory_id',memoryId)
    if(media?.length) await supabase.storage.from('memora-media').remove(media.map(x=>x.storage_path))
    const {error}=await supabase.from('memories').delete().eq('id',memoryId)
    if(error) toast(error.message)
    else{toast('Memory deleted');go(view)}
  })
}


function detectRelationship(question){
  const q=question.toLowerCase()
  const groups=[
    ['parents',['parent','parents']],
    ['siblings',['sibling','siblings']],
    ['sister',['sister','sisters']],
    ['brother',['brother','brothers']],
    ['father',['father','dad','daddy']],
    ['mother',['mother','mom','mum','mommy','mummy']],
    ['wife',['wife','spouse']],
    ['husband',['husband','spouse']],
    ['daughter',['daughter','daughters']],
    ['son',['son','sons']]
  ]
  for(const [relation,terms] of groups){
    if(terms.some(term=>new RegExp('\\b'+term+'\\b','i').test(q))) return relation
  }
  return null
}

function cleanPersonPart(value){
  return value
    .replace(/^[“"'\s]+|[”"'\s]+$/g,'')
    .replace(/^(?:the\s+)?(?:first|second|third|1st|2nd|3rd)\s+/i,'')
    .trim()
}

function relationNamesFromText(relation,text){
  const source=String(text||'').replace(/[\n\r]+/g,' ')
  const variants={
    father:'(?:father|dad|daddy)',
    mother:'(?:mother|mom|mum|mommy|mummy)',
    sister:'(?:(?:first|second|third|1st|2nd|3rd)\\s+)?(?:(?:younger|elder|older)\\s+)?sister',
    brother:'(?:(?:first|second|third|1st|2nd|3rd)\\s+)?(?:(?:younger|elder|older)\\s+)?brother',
    wife:'(?:wife|spouse)',
    husband:'(?:husband|spouse)',
    daughter:'(?:(?:first|second|third|1st|2nd|3rd)\\s+)?daughter',
    son:'(?:(?:first|second|third|1st|2nd|3rd)\\s+)?son'
  }
  const relationPattern=variants[relation]
  if(!relationPattern) return []
  const re=new RegExp('(?:my\\s+)?'+relationPattern+"(?:'s)?(?:\\s+name)?\\s+(?:is|are)\\s+([^.;”\"\\n]+)",'ig')
  const names=[]
  let match
  while((match=re.exec(source))){
    let segment=match[1]
    segment=segment.split(/\s+and\s+(?:my|the)\s+(?:(?:first|second|third|1st|2nd|3rd)\s+)?(?:(?:younger|elder|older)\s+)?(?:father|mother|sister|brother|wife|husband|daughter|son)\b/i)[0]
    segment=segment.split(/,?\s+(?:and\s+)?(?:my|the)\s+(?:(?:first|second|third|1st|2nd|3rd)\s+)?(?:(?:younger|elder|older)\s+)?(?:father|mother|sister|brother|wife|husband|daughter|son)\b/i)[0]
    const parts=segment.split(/\s+and\s+then\s+|,\s*then\s+|\s+then\s+|\s*,\s*/i)
    for(const raw of parts){
      const name=cleanPersonPart(raw)
      if(name && name.length<=80 && !names.some(existing=>existing.toLowerCase()===name.toLowerCase())) names.push(name)
    }
  }
  return names
}

function relationshipAnswer(relation,memories){
  const texts=(memories||[]).flatMap(m=>[m.original_text,m.summary]).filter(Boolean)
  const collect=rel=>[...new Set(texts.flatMap(text=>relationNamesFromText(rel,text)))]

  if(relation==='parents'){
    const fathers=collect('father')
    const mothers=collect('mother')
    if(fathers.length||mothers.length){
      const bits=[]
      if(fathers.length) bits.push(`father: ${fathers.join(', ')}`)
      if(mothers.length) bits.push(`mother: ${mothers.join(', ')}`)
      return `According to your stored memory, your ${bits.join(' and your ')}.`
    }
  }

  if(relation==='siblings'){
    const brothers=collect('brother')
    const sisters=collect('sister')
    if(brothers.length||sisters.length){
      const bits=[]
      if(brothers.length) bits.push(`${brothers.length===1?'brother':'brothers'}: ${brothers.join(', ')}`)
      if(sisters.length) bits.push(`${sisters.length===1?'sister':'sisters'}: ${sisters.join(', ')}`)
      return `According to your stored memory, your ${bits.join(' and your ')}.`
    }
  }

  const names=collect(relation)
  if(names.length){
    const label=names.length===1?relation:`${relation}s`
    return `According to your stored memory, your ${label} ${names.length===1?'is':'are'} ${names.join(', ')}.`
  }
  return null
}


function cleanEntityName(value){
  return String(value||'')
    .replace(/^[“"'\s]+|[”"'.,;!?\s]+$/g,'')
    .replace(/\s+/g,' ')
    .trim()
}

function extractEntitiesFromText(text){
  const source=String(text||'').replace(/[\r\n]+/g,' ')
  const people=new Map()
  const places=new Map()

  const addPerson=(name,relationship='known person')=>{
    name=cleanEntityName(name)
    if(!name||name.length<2||name.length>80||/^the\b/i.test(name)) return
    const key=name.toLowerCase()
    if(!people.has(key)||people.get(key).relationship==='known person') people.set(key,{name,relationship})
  }
  const addPlace=(name,category='place')=>{
    name=cleanEntityName(name)
    if(!name||name.length<2||name.length>90) return
    places.set(name.toLowerCase(),{name,category})
  }

  ;['father','mother','sister','brother','wife','husband','daughter','son'].forEach(relation=>{
    relationNamesFromText(relation,source).forEach(name=>addPerson(name,relation))
  })

  const relationPatterns=[
    ['friend',/(?:my\s+)?friend(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,70})/ig],
    ['colleague',/(?:my\s+)?(?:colleague|coworker|co-worker)(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,70})/ig],
    ['manager',/(?:my\s+)?(?:manager|boss)(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,70})/ig],
    ['partner',/(?:my\s+)?partner(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,70})/ig],
    ['cousin',/(?:my\s+)?cousin(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,70})/ig]
  ]
  relationPatterns.forEach(([relationship,re])=>{
    let m
    while((m=re.exec(source))) addPerson(m[1].split(/\s+(?:at|in|on|near|and|with|from|about|for)\s+/i)[0],relationship)
  })

  const encounterPatterns=[
    /(?:i\s+)?met\s+([A-Z][A-Za-z .'-]{1,70})/ig,
    /(?:played|went|worked|spoke|talked|travelled|traveled)\s+.*?\s+with\s+([A-Z][A-Za-z .'-]{1,70})/ig,
    /(?:spoke|talked)\s+(?:with|to)\s+([A-Z][A-Za-z .'-]{1,70})/ig
  ]
  encounterPatterns.forEach(re=>{
    let m
    while((m=re.exec(source))) addPerson(m[1].split(/\s+(?:at|in|on|near|and|from|about|for|yesterday|today)\s+/i)[0])
  })

  const whatsappSpeaker=/\]\s*([^:\n]{2,60}):/g
  let ws
  while((ws=whatsappSpeaker.exec(source))){
    const candidate=cleanEntityName(ws[1])
    if(candidate&&candidate.split(' ').length<=6) addPerson(candidate,'conversation participant')
  }

  const placePatterns=[
    ['hometown',/(?:born|grew up|live|lived)\s+(?:at|in)\s+([A-Z][A-Za-z0-9 .&'’-]{2,80})/ig],
    ['visited',/(?:visited|went to|travelled to|traveled to)\s+([A-Z][A-Za-z0-9 .&'’-]{2,80})/ig],
    ['place',/(?:at|near)\s+([A-Z][A-Za-z0-9 .&'’-]{2,80})/g]
  ]
  placePatterns.forEach(([category,re])=>{
    let m
    while((m=re.exec(source))){
      const name=m[1].split(/\s+(?:and|with|on|at|in|around|from|where|which|who)\s+/i)[0]
      addPlace(name,category)
    }
  })

  return {people:[...people.values()],places:[...places.values()]}
}

async function syncEntitiesFromMemory(memory,text){
  const entities=extractEntitiesFromText(text)
  const stamp=memory?.occurred_at||memory?.created_at||new Date().toISOString()
  if(entities.people.length){
    const rows=entities.people.map(person=>({
      user_id:user.id,name:person.name,relationship:person.relationship,
      notes:'Recognized automatically from a memory',first_seen_at:stamp,last_seen_at:stamp
    }))
    await supabase.from('people').upsert(rows,{onConflict:'user_id,name',ignoreDuplicates:false})
  }
  if(entities.places.length){
    const rows=entities.places.map(place=>({
      user_id:user.id,name:place.name,category:place.category,
      notes:'Recognized automatically from a memory',first_visited_at:stamp,last_visited_at:stamp
    }))
    await supabase.from('places').upsert(rows,{onConflict:'user_id,name',ignoreDuplicates:false})
  }
}

async function syncEntitiesFromAllMemories(){
  const {data:memories}=await supabase.from('memories').select('id,original_text,summary,occurred_at,created_at').order('created_at',{ascending:false}).limit(300)
  if(!memories?.length) return
  const people=new Map(),places=new Map()
  for(const memory of memories){
    const entities=extractEntitiesFromText(`${memory.original_text||''} ${memory.summary||''}`)
    const stamp=memory.occurred_at||memory.created_at
    for(const person of entities.people){
      const key=person.name.toLowerCase()
      const existing=people.get(key)
      people.set(key,{user_id:user.id,name:person.name,relationship:existing?.relationship&&existing.relationship!=='known person'?existing.relationship:person.relationship,notes:'Recognized automatically from stored memories',first_seen_at:existing?.first_seen_at||stamp,last_seen_at:stamp})
    }
    for(const place of entities.places){
      const key=place.name.toLowerCase()
      const existing=places.get(key)
      places.set(key,{user_id:user.id,name:place.name,category:existing?.category||place.category,notes:'Recognized automatically from stored memories',first_visited_at:existing?.first_visited_at||stamp,last_visited_at:stamp})
    }
  }
  if(people.size) await supabase.from('people').upsert([...people.values()],{onConflict:'user_id,name',ignoreDuplicates:false})
  if(places.size) await supabase.from('places').upsert([...places.values()],{onConflict:'user_id,name',ignoreDuplicates:false})
}

async function smartMemorySearch(query,limit=8){
  const result=await supabase.rpc('search_memories_smart',{search_query:query,result_limit:limit})
  if(!result.error && result.data?.length) return result.data
  const fallback=await supabase.rpc('search_memories',{search_query:query,result_limit:limit})
  return fallback.data||[]
}

function cameraModalMarkup(mode){
  return `
    <div class="camera-stage">
      <video id="liveCamera" autoplay playsinline muted></video>
      <div class="camera-status" id="cameraStatus">Starting camera...</div>
    </div>
    <div class="camera-actions">
      <button class="btn" id="switchCamera">Switch camera</button>
      ${mode==='photo'
        ? '<button class="btn primary" id="takePhoto">Capture photo</button>'
        : '<button class="btn primary" id="recordVideo">Start recording</button>'}
      <button class="btn" id="cameraFallback">Choose existing file</button>
    </div>
  `
}

function stopCamera(){
  if(cameraStream){
    cameraStream.getTracks().forEach(track=>track.stop())
    cameraStream=null
  }
}

async function openLiveCamera(mode='photo'){
  if(!navigator.mediaDevices?.getUserMedia){
    toast('Live camera is not supported here. Opening file picker instead.')
    document.getElementById(mode==='photo'?'cameraInput':'videoInput')?.click()
    return
  }

  const box=modal(mode==='photo'?'Take a photo':'Record a video',cameraModalMarkup(mode))
  const close=box.querySelector('.close')
  const originalClose=close.onclick
  close.onclick=()=>{stopCamera();originalClose()}
  box.onclick=e=>{if(e.target===box){stopCamera();box.remove()}}

  const start=async()=>{
    stopCamera()
    const status=box.querySelector('#cameraStatus')
    try{
      let constraints={video:{facingMode:{ideal:cameraFacing}},audio:mode==='video'}
      try{
        cameraStream=await navigator.mediaDevices.getUserMedia(constraints)
      }catch(error){
        if(mode==='video'){
          constraints={video:{facingMode:{ideal:cameraFacing}},audio:false}
          cameraStream=await navigator.mediaDevices.getUserMedia(constraints)
        }else throw error
      }
      const video=box.querySelector('#liveCamera')
      video.srcObject=cameraStream
      await video.play()
      status.textContent=mode==='photo'?'Camera ready':'Camera ready for video'
    }catch(error){
      status.textContent=`Camera unavailable: ${error.message}`
    }
  }

  box.querySelector('#switchCamera').onclick=async()=>{
    cameraFacing=cameraFacing==='environment'?'user':'environment'
    await start()
  }
  box.querySelector('#cameraFallback').onclick=()=>{
    stopCamera()
    box.remove()
    document.getElementById(mode==='photo'?'cameraInput':'videoInput')?.click()
  }

  if(mode==='photo'){
    box.querySelector('#takePhoto').onclick=()=>{
      const video=box.querySelector('#liveCamera')
      if(!cameraStream||!video.videoWidth) return toast('Camera is not ready yet')
      const canvas=document.createElement('canvas')
      canvas.width=video.videoWidth
      canvas.height=video.videoHeight
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height)
      canvas.toBlob(blob=>{
        if(!blob) return toast('Could not capture photo')
        pendingMedia.push(new File([blob],`camera-${Date.now()}.jpg`,{type:'image/jpeg'}))
        stopCamera()
        box.remove()
        renderPending()
        toast('Photo attached')
      },'image/jpeg',0.92)
    }
  }else{
    let videoRecorder=null
    let chunks=[]
    const button=box.querySelector('#recordVideo')
    button.onclick=()=>{
      if(!cameraStream) return toast('Camera is not ready yet')
      if(videoRecorder?.state==='recording'){
        videoRecorder.stop()
        button.textContent='Start recording'
        return
      }
      chunks=[]
      try{
        videoRecorder=new MediaRecorder(cameraStream)
      }catch(error){
        return toast(error.message)
      }
      videoRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      videoRecorder.onstop=()=>{
        const type=videoRecorder.mimeType||'video/webm'
        const blob=new Blob(chunks,{type})
        pendingMedia.push(new File([blob],`video-${Date.now()}.webm`,{type}))
        stopCamera()
        box.remove()
        renderPending()
        toast('Video attached')
      }
      videoRecorder.start()
      button.textContent='Stop and attach'
      box.querySelector('#cameraStatus').textContent='Recording...'
    }
  }
  await start()
}

async function answer(question){
  const q=question.trim()
  const lower=q.toLowerCase()

  const relation=detectRelationship(q)
  if(relation){
    let relationQuery=relation
    if(relation==='parents') relationQuery='father mother parents'
    if(relation==='siblings') relationQuery='brother sister siblings'
    const memories=await smartMemorySearch(relationQuery,10)
    const response=relationshipAnswer(relation,memories)
    if(response) return {text:response,source:'Your stored personal memory'}
    if(memories.length) return {text:`I found a related memory: “${memories[0].original_text}”`,source:'Your stored personal memory'}
  }

  let match=q.match(/where (?:is|did i (?:keep|put|leave)) (?:my )?(.+?)(?:\?|$)/i)
  if(match){
    let thingName=match[1].trim()
    if(/^(?:it|that|this)$/i.test(thingName) && conversationContext.thing) thingName=conversationContext.thing
    const thing=await findThing(thingName)
    if(!thing) {
      const memories=await smartMemorySearch(thingName,5)
      if(memories.length) return {text:`I found this related memory: “${memories[0].original_text}”`,source:'Your stored memories'}
      return {text:"I don't have a memory about that yet."}
    }
    conversationContext.thing=thing.name
    return {text:`Your ${thing.name} is currently recorded as being at ${thing.current_location}.`,source:'Latest personal memory'}
  }

  match=q.match(/where was (?:(?:my )?(.+?)|it|that|this) before(?:\?|$)/i)
  if(match || /where was (?:it|that|this) before/i.test(lower)){
    let thingName=match?.[1]?.trim()||conversationContext.thing
    if(thingName && /^(?:it|that|this)$/i.test(thingName)) thingName=conversationContext.thing
    if(!thingName) return {text:'Tell me which item you mean, for example “Where was my key before?”'}
    const thing=await findThing(thingName)
    if(!thing) return {text:"I don't have a location history for that item yet."}
    conversationContext.thing=thing.name
    const {data}=await supabase.from('thing_locations').select('*').eq('thing_id',thing.id).order('recorded_at',{ascending:false}).limit(2)
    if(!data||data.length<2) return {text:`I know the current location of your ${thing.name}, but I do not have an earlier location yet.`}
    return {text:`Before ${data[0].location}, your ${thing.name} was recorded at ${data[1].location}.`,source:`Personal memory from ${when(data[1].recorded_at)}`}
  }

  match=q.match(/when did i last (.+?)(?:\?|$)/i)
  if(match){
    const data=await smartMemorySearch(match[1].trim(),8)
    if(!data.length) return {text:"I don't have a memory about that yet."}
    return {text:`The most recent matching memory I found is “${data[0].original_text}” from ${when(data[0].occurred_at)}.`,source:'Your stored memories'}
  }

  const data=await smartMemorySearch(q,8)
  if(!data.length) return {text:"I don't have a memory about that yet."}
  return {text:`I found this in your memory vault: “${data[0].original_text}”`,source:`Stored memory from ${when(data[0].occurred_at)}`}
}
async function ask(){
  app.innerHTML=shell(`
    <div class="ask-shell">
      <div class="glass chat-panel">
        <div class="filter-row" style="margin-bottom:15px">
          <button class="chip" data-ask-suggestion="Where is my key?">Where is my key?</button>
          <button class="chip" data-ask-suggestion="Where was my key before?">Where was it before?</button>
          <button class="chip" data-ask-suggestion="When did I last play basketball?">Last activity</button>
        </div>
        <div class="chat" id="chat">${chat.length?chat.map(message=>`<div class="bubble ${message.role==='user'?'user':''}">${esc(message.text)}${message.source?`<div class="source">Source: ${esc(message.source)}</div>`:''}</div>`).join(''):'<div class="empty"><strong>Ask your own life</strong>Memora searches your stored memories before answering.</div>'}</div>
      </div>
      <div class="glass ask-box"><input class="input" id="askInput" placeholder="Ask Memora anything about your memories"><button class="btn primary" id="askButton">Ask</button></div>
    </div>
  `,'Ask Memora','A grounded search across your own life.')
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
  document.querySelectorAll('[data-ask-suggestion]').forEach(button=>button.onclick=()=>{
    document.getElementById('askInput').value=button.dataset.askSuggestion
    submit()
  })
}

async function timeline(){
  const {data}=await supabase.from('memories').select('*').order('occurred_at',{ascending:false})
  app.innerHTML=shell(`
    <div class="timeline">${data?.length?data.map(m=>`
      <div class="timeline-entry">
        <div class="timeline-dot"></div>
        <div class="glass timeline-card">
          <span class="badge">${esc(typeLabel(m.memory_type))}</span>
          <h3 style="margin:10px 0 6px">${esc(m.summary||m.original_text)}</h3>
          <div class="muted">${esc(m.original_text)}</div>
          <div class="memory-meta"><span>${when(m.occurred_at)}</span><span>•</span><span>${esc((m.provenance_kind||'user_stated').replaceAll('_',' '))}</span></div>
        </div>
      </div>`).join(''):'<div class="glass empty"><strong>Your timeline is waiting</strong>Memories appear here in time order.</div>'}</div>
  `,'Timeline','A calm chronological stream of your remembered life.')
  wire()
}

async function vault(){
  await syncEntitiesFromAllMemories()
  const [{count:peopleCount},{count:placeCount},{count:thingCount},{count:docCount}]=await Promise.all([
    supabase.from('people').select('*',{count:'exact',head:true}),
    supabase.from('places').select('*',{count:'exact',head:true}),
    supabase.from('things').select('*',{count:'exact',head:true}),
    supabase.from('documents').select('*',{count:'exact',head:true})
  ])
  app.innerHTML=shell(`
    <div class="vault-grid">
      <div class="glass vault-card" data-vault="people"><div class="vault-icon">◎</div><h3>People</h3><p>Names, relationships and encounters recognized from memories.</p><div class="memory-meta">${peopleCount||0} people</div></div>
      <div class="glass vault-card" data-vault="places"><div class="vault-icon">⌖</div><h3>Places</h3><p>Homes, cafes, cities and locations connected to your story.</p><div class="memory-meta">${placeCount||0} places</div></div>
      <div class="glass vault-card" data-vault="things"><div class="vault-icon">◇</div><h3>Things</h3><p>Keys, documents, jewellery and anything whose location matters.</p><div class="memory-meta">${thingCount||0} things</div></div>
      <div class="glass vault-card" data-vault="documents"><div class="vault-icon">▣</div><h3>Documents</h3><p>Files, policies, receipts and records you asked Memora to keep.</p><div class="memory-meta">${docCount||0} files</div></div>
    </div>
  `,'Vault','People, places, things and documents without cluttering the main navigation.')
  wire()
  document.querySelectorAll('[data-vault]').forEach(card=>card.onclick=()=>go(card.dataset.vault))
}

async function people(){
  await syncEntitiesFromAllMemories()
  const {data}=await supabase.from('people').select('*').order('name')
  app.innerHTML=shell(`<div class="vault-grid">${data?.length?data.map(p=>`<div class="glass vault-card"><div class="vault-icon">◎</div><h3>${esc(p.name)}</h3><p>${esc(p.relationship||'Person from your memories')}</p><div class="memory-meta">Last seen ${when(p.last_seen_at||p.created_at)}</div></div>`).join(''):'<div class="glass empty"><strong>No people yet</strong>Mention someone in a memory and they can appear here.</div>'}</div>`,'People')
  wire()
}

async function places(){
  await syncEntitiesFromAllMemories()
  const {data}=await supabase.from('places').select('*').order('name')
  app.innerHTML=shell(`<div class="vault-grid">${data?.length?data.map(p=>`<div class="glass vault-card"><div class="vault-icon">⌖</div><h3>${esc(p.name)}</h3><p>${esc(p.address||p.category||'Saved place')}</p></div>`).join(''):'<div class="glass empty"><strong>No places yet</strong>Places and imported location history will collect here.</div>'}</div>`,'Places')
  wire()
}

async function things(){
  const {data}=await supabase.from('things').select('*').order('updated_at',{ascending:false})
  app.innerHTML=shell(`<div class="vault-grid">${data?.length?data.map(t=>`<div class="glass vault-card"><div class="vault-icon">◇</div><span class="status live">Current</span><h3>${esc(t.name)}</h3><p>Location: <b>${esc(t.current_location||'Unknown')}</b></p><button class="btn" data-history="${t.id}">Location history</button><div id="history-${t.id}" style="margin-top:12px"></div></div>`).join(''):'<div class="glass empty"><strong>No objects tracked yet</strong>Try “I kept my key in the drawer.”</div>'}</div>`,'Things')
  wire()
  document.querySelectorAll('[data-history]').forEach(button=>button.onclick=async event=>{
    event.stopPropagation()
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
  const text=note?.trim()?`${note.trim()} | File: ${file.name}`:`Remember this file: ${file.name}`
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
      <div class="glass" style="padding:22px;border-radius:24px">
        <div class="eyebrow">Memory from a file</div><h3>Drop in something important</h3>
        <p class="muted">PDFs, Word files, receipts, screenshots and other records can become part of your memory vault.</p>
        <textarea class="input" id="docNote" placeholder="Optional note, for example: My vehicle insurance policy for 2026"></textarea>
        <label class="file-zone" style="margin-top:12px"><strong>Choose a file</strong><div class="muted" style="margin-top:6px">Stored privately in your account</div><input type="file" id="fileInput"></label>
        <div id="uploadMsg" class="muted" style="margin-top:10px"></div>
      </div>
      <div class="glass" style="padding:22px;border-radius:24px">
        <div class="eyebrow">Document intelligence</div><h3>Built to become searchable knowledge</h3>
        <p class="muted">Secure storage and memory linking work now. Deep text extraction and document Q&A are the next intelligence module.</p>
        <div class="filter-row"><span class="chip active">Private storage</span><span class="chip">Provenance</span><span class="chip">AI ready</span></div>
      </div>
    </div>
    <section class="section"><div class="section-head"><div><h3>Your files</h3><p>Documents you asked Memora to remember.</p></div></div>
      <div class="grid two">${data?.length?data.map(d=>`<div class="glass" style="padding:18px;border-radius:22px"><div class="memory-top"><div><strong>${esc(d.file_name)}</strong><div class="muted" style="margin-top:5px">${esc(d.description||d.mime_type||'Stored document')}</div></div><span class="badge alt">File</span></div><div class="memory-meta">${when(d.created_at)}</div></div>`).join(''):'<div class="glass empty"><strong>No files yet</strong>Add a document above and give it a note.</div>'}</div>
    </section>
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

async function importWhatsApp(file){
  const raw=(await file.text()).trim()
  if(!raw) throw new Error('This WhatsApp export appears empty.')
  const source=await supabase.from('sources').insert({
    user_id:user.id,source_type:'whatsapp_import',source_name:file.name,metadata:{imported_at:new Date().toISOString()}
  }).select().single()
  if(source.error) throw source.error
  const chunks=[]
  for(let i=0;i<raw.length;i+=9000) chunks.push(raw.slice(i,i+9000))
  let imported=0
  for(let i=0;i<Math.min(chunks.length,60);i++){
    const result=await supabase.from('memories').insert({
      user_id:user.id,original_text:chunks[i],summary:`WhatsApp chat: ${file.name} · part ${i+1}`,
      memory_type:'conversation',state:'historical',occurred_at:new Date().toISOString(),
      source_type:'import',provenance_kind:'imported',source_id:source.data.id,confidence:1,
      interpreted_data:{source:'WhatsApp export',file_name:file.name,part:i+1}
    })
    if(!result.error) imported++
  }
  return imported
}


async function getConnectionMap(){
  const {data}=await supabase.from('connections').select('*').order('provider')
  return Object.fromEntries((data||[]).map(item=>[item.provider,item]))
}

function connectionStatus(connection,setupLabel='Connect'){
  if(connection?.status==='connected') return {label:'Connected',className:'live'}
  if(connection?.status==='error') return {label:'Needs attention',className:''}
  return {label:setupLabel,className:''}
}

async function connectAiApi(provider,label){
  const body=`
    <p class="muted">Enter your ${esc(label)} API key. It is sent directly to an authenticated Supabase Edge Function, verified with the provider and stored encrypted in Supabase Vault. It is never written into Memora's frontend code.</p>
    <input class="input" id="providerApiKey" type="password" autocomplete="off" placeholder="${esc(label)} API key">
    <div class="filter-row" style="margin-top:12px"><button class="btn primary" id="providerConnect">Connect securely</button><span class="muted" id="providerConnectMsg"></span></div>`
  const box=modal(`Connect ${label}`,body)
  box.querySelector('#providerConnect').onclick=async()=>{
    const key=box.querySelector('#providerApiKey').value.trim()
    const msg=box.querySelector('#providerConnectMsg')
    if(!key) return msg.textContent='Enter an API key.'
    msg.textContent='Verifying...'
    const {data,error}=await supabase.functions.invoke('connect-ai-provider',{body:{action:'connect',provider,api_key:key}})
    box.querySelector('#providerApiKey').value=''
    if(error||data?.error) return msg.textContent=data?.error||error.message
    msg.textContent='Connected.'
    setTimeout(()=>{box.remove();sources()},500)
  }
}

async function disconnectSource(provider){
  const {data,error}=await supabase.functions.invoke('connect-ai-provider',{body:{action:'disconnect',provider}})
  if(error||data?.error) return toast(data?.error||error.message)
  toast('Disconnected')
  sources()
}

async function startOAuthSource(provider){
  const isGoogle=provider==='google_workspace'
  const authProvider=isGoogle?'google':'azure'
  const scopes=isGoogle
    ? 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly'
    : 'openid email profile offline_access User.Read Mail.Read Calendars.Read Files.Read Sites.Read.All'
  localStorage.setItem('memora-pending-source',provider)
  localStorage.setItem('memora-pending-scopes',scopes)
  const queryParams=isGoogle?{access_type:'offline',prompt:'consent'}:{prompt:'consent'}
  const {error}=await supabase.auth.signInWithOAuth({
    provider:authProvider,
    options:{redirectTo:window.location.origin,scopes,queryParams}
  })
  if(error){
    localStorage.removeItem('memora-pending-source')
    localStorage.removeItem('memora-pending-scopes')
    toast(error.message)
  }
}

async function finalizePendingOAuth(session){
  const provider=localStorage.getItem('memora-pending-source')
  if(!provider||!session) return
  const accessToken=session.provider_token
  const refreshToken=session.provider_refresh_token
  if(!accessToken) return
  const scopes=(localStorage.getItem('memora-pending-scopes')||'').split(' ').filter(Boolean)
  const {data,error}=await supabase.functions.invoke('store-oauth-source',{
    body:{provider,access_token:accessToken,refresh_token:refreshToken||null,scopes}
  })
  if(error||data?.error){
    console.warn('Source connection could not be finalized')
    return
  }
  localStorage.removeItem('memora-pending-source')
  localStorage.removeItem('memora-pending-scopes')
  toast('Source connected')
}

function sourceInfo(kind){
  const info={
    openai:{
      title:'OpenAI and GPT agents',
      body:'OpenAI connects through a secure API-key flow backed by Supabase Vault. New reasoning integrations should use the current Responses architecture rather than the retired Assistants API.'
    },
    google:{
      title:'Google Workspace',
      body:'Google Workspace uses OAuth with explicit read-only scopes. Memora stores provider credentials server-side after authorization, not in frontend JavaScript. Gmail scopes may require Google verification before public release.'
    },
    microsoft:{
      title:'Microsoft 365',
      body:'Microsoft 365 uses Microsoft Graph OAuth with delegated permissions for Outlook, Calendar, OneDrive and SharePoint. An Entra application registration must be configured once before public use.'
    },
    claude:{
      title:'Claude',
      body:'Claude now has a secure API-key connection path. The credential is verified server-side and encrypted in Supabase Vault before the source is marked connected.'
    },
    gemini:{
      title:'Gemini',
      body:'Gemini now has a separate secure API connection so Google AI access stays independent from Gmail, Calendar and Drive permissions.'
    },
    maps:{
      title:'Maps and live location',
      body:'One-time current location attachment already works from the capture bar with browser permission. Continuous location history and Google Maps Timeline import need a dedicated import and consent flow.'
    }
  }
  return info[kind]
}

function openSourceInfo(kind){
  const info=sourceInfo(kind)
  modal(info.title,`<p class="muted" style="line-height:1.65">${esc(info.body)}</p><div class="filter-row"><span class="chip active">Privacy first</span><span class="chip">User consent</span><span class="chip">No fake connection</span></div>`)
}

async function sources(){
  const connections=await getConnectionMap()
  const google=connectionStatus(connections.google_workspace,'OAuth')
  const microsoft=connectionStatus(connections.microsoft365,'OAuth')
  const openai=connectionStatus(connections.openai,'API')
  const anthropic=connectionStatus(connections.anthropic,'API')
  const gemini=connectionStatus(connections.gemini,'API')

  app.innerHTML=shell(`
    <div class="source-hero glass">
      <div><div class="eyebrow">Connection Hub</div><h3>Connect your life, not just import it.</h3><p>OAuth sources and AI APIs are separated by permission type. Connected credentials are kept server-side, while Memora only shows status and account labels.</p></div>
      <div class="source-summary"><b>${Object.values(connections).filter(c=>c.status==='connected').length}</b><span>connected sources</span></div>
    </div>
    <div class="source-grid">
      <div class="glass source-card"><span class="status ${google.className}">${google.label}</span><div class="source-icon">G</div><h3>Google Workspace</h3><p>Gmail, Calendar and Drive through explicit read-only OAuth scopes.</p><div class="source-actions">${connections.google_workspace?.status==='connected'?'<button class="btn" data-source-detail="google_workspace">Connected account</button>':'<button class="btn primary" id="connectGoogle">Connect Google</button>'}<button class="btn ghost" data-source-info="google">Details</button></div></div>
      <div class="glass source-card"><span class="status ${microsoft.className}">${microsoft.label}</span><div class="source-icon">M</div><h3>Microsoft 365</h3><p>Outlook, Calendar, OneDrive and SharePoint through Microsoft Graph OAuth.</p><div class="source-actions">${connections.microsoft365?.status==='connected'?'<button class="btn" data-source-detail="microsoft365">Connected account</button>':'<button class="btn primary" id="connectMicrosoft">Connect Microsoft</button>'}<button class="btn ghost" data-source-info="microsoft">Details</button></div></div>
      <div class="glass source-card"><span class="status ${openai.className}">${openai.label}</span><div class="source-icon">AI</div><h3>OpenAI API</h3><p>Secure API connection for future Responses-based reasoning, tools and live AI features.</p><div class="source-actions">${connections.openai?.status==='connected'?'<button class="btn" data-disconnect-ai="openai">Disconnect</button>':'<button class="btn primary" id="connectOpenAI">Connect API</button>'}<button class="btn ghost" data-source-info="openai">Details</button></div></div>
      <div class="glass source-card"><span class="status ${anthropic.className}">${anthropic.label}</span><div class="source-icon">C</div><h3>Claude API</h3><p>Optional Anthropic reasoning provider with encrypted API-key storage.</p><div class="source-actions">${connections.anthropic?.status==='connected'?'<button class="btn" data-disconnect-ai="anthropic">Disconnect</button>':'<button class="btn primary" id="connectClaude">Connect API</button>'}<button class="btn ghost" data-source-info="claude">Details</button></div></div>
      <div class="glass source-card"><span class="status ${gemini.className}">${gemini.label}</span><div class="source-icon">Gm</div><h3>Gemini API</h3><p>Optional Google AI reasoning provider, separate from Workspace permissions.</p><div class="source-actions">${connections.gemini?.status==='connected'?'<button class="btn" data-disconnect-ai="gemini">Disconnect</button>':'<button class="btn primary" id="connectGemini">Connect API</button>'}<button class="btn ghost" data-source-info="gemini">Details</button></div></div>
      <div class="glass source-card"><span class="status">Business API</span><div class="source-icon">W</div><h3>WhatsApp</h3><p>Live connection requires the Meta WhatsApp Business Cloud API. Personal chats do not expose a general live-history API.</p><div class="source-actions"><button class="btn primary" id="whatsappConnect">Set up API</button><button class="btn ghost" id="whatsappImport">Import existing chat</button><input class="hidden" id="whatsappFile" type="file" accept=".txt,text/plain"></div></div>
      <div class="glass source-card"><span class="status live">Live now</span><div class="source-icon">⌖</div><h3>Live Context</h3><p>Current location, local time, network and live weather from this device.</p><div class="source-actions"><button class="btn primary" id="enableLiveSource">Enable live</button><button class="btn ghost" data-source-info="maps">Details</button></div></div>
      <div class="glass source-card"><span class="status live">Works now</span><div class="source-icon">▣</div><h3>Files and Documents</h3><p>PDFs, screenshots, receipts and documents can be stored as source-backed memories.</p><div class="source-actions"><button class="btn primary" id="filesJump">Open Documents</button></div></div>
      <div class="glass source-card"><span class="status">Optional</span><div class="source-icon">＋</div><h3>More connectors</h3><p>Slack, Notion, Dropbox, GitHub, calendars, health and other sources can follow the same connector model.</p><div class="source-actions"><button class="btn" id="moreConnectors">Explore roadmap</button></div></div>
    </div>
    <div id="sourceMsg" class="muted" style="margin-top:14px"></div>
  `,'Source Universe','Real OAuth, API and live-device connections with clear permission boundaries.')
  wire()

  document.getElementById('connectGoogle')?.addEventListener('click',()=>startOAuthSource('google_workspace'))
  document.getElementById('connectMicrosoft')?.addEventListener('click',()=>startOAuthSource('microsoft365'))
  document.getElementById('connectOpenAI')?.addEventListener('click',()=>connectAiApi('openai','OpenAI'))
  document.getElementById('connectClaude')?.addEventListener('click',()=>connectAiApi('anthropic','Claude'))
  document.getElementById('connectGemini')?.addEventListener('click',()=>connectAiApi('gemini','Gemini'))
  document.querySelectorAll('[data-disconnect-ai]').forEach(button=>button.onclick=()=>disconnectSource(button.dataset.disconnectAi))
  document.querySelectorAll('[data-source-info]').forEach(button=>button.onclick=event=>{event.stopPropagation();openSourceInfo(button.dataset.sourceInfo)})
  document.querySelectorAll('[data-source-detail]').forEach(button=>button.onclick=()=>{
    const connection=connections[button.dataset.sourceDetail]
    modal('Connected source',`<p><b>${esc(connection?.external_account_label||button.dataset.sourceDetail)}</b></p><p class="muted">Status: ${esc(connection?.status||'connected')}</p><p class="muted">Connected credentials are stored server-side. Memora does not render access tokens in the browser.</p>`)
  })
  document.getElementById('filesJump').onclick=()=>go('documents')
  document.getElementById('enableLiveSource').onclick=()=>{localStorage.setItem('memora-live-context','1');go('home').then(refreshLivePulse)}
  document.getElementById('moreConnectors').onclick=()=>modal('Connector roadmap','<p class="muted">The same secure connector pattern can be extended to Slack, Notion, Dropbox, GitHub, Apple services, wearables and health sources. Each connector will request only the permissions it needs.</p>')
  document.getElementById('whatsappConnect').onclick=()=>modal('WhatsApp Business Cloud API','<p class="muted">A live WhatsApp connection requires a Meta developer app, WhatsApp Business account, Phone Number ID and access token/webhook configuration. Memora will support that flow separately from personal chat imports.</p><p class="muted">For personal WhatsApp history, use the existing chat export path because WhatsApp does not provide a general consumer-history OAuth API.</p>')
  document.getElementById('whatsappImport').onclick=()=>document.getElementById('whatsappFile').click()
  document.getElementById('whatsappFile').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('sourceMsg')
    msg.textContent='Indexing WhatsApp chat...'
    try{const count=await importWhatsApp(file);msg.textContent=`Indexed ${count} WhatsApp memory chunks.`;await syncEntitiesFromAllMemories();toast('WhatsApp chat indexed')}
    catch(error){msg.textContent=error.message}
  }
}
async function settings(){
  const [{data:profile},{data:settingsData}]=await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    supabase.from('user_settings').select('*').maybeSingle()
  ])
  const currentTheme=localStorage.getItem('memora-theme')||'auto'
  app.innerHTML=shell(`
    <div class="grid two">
      <div class="glass" style="padding:22px;border-radius:24px">
        <div class="eyebrow">Identity</div><h3>Profile</h3>
        <div style="display:grid;gap:10px">
          <input class="input" id="displayName" value="${esc(profile?.display_name||'')}" placeholder="Display name">
          <input class="input" id="timezone" value="${esc(profile?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone)}" placeholder="Timezone">
          <button class="btn primary" id="saveProfile">Save profile</button>
        </div>
      </div>
      <div class="glass" style="padding:22px;border-radius:24px">
        <div class="eyebrow">Atmosphere</div><h3>Dynamic appearance</h3>
        <p class="muted">Adaptive mode changes the color atmosphere every hour. Current mode: <b>${esc(currentTheme)}</b>.</p>
        <button class="btn" id="settingsTheme">Choose theme</button>
      </div>
      <div class="glass" style="padding:22px;border-radius:24px">
        <div class="eyebrow">Security</div><h3>Your private data</h3>
        <p class="muted">Memories, media, context and files are scoped to your signed-in user through Row Level Security.</p>
        <button class="btn" id="logoutButton">Sign out</button>
      </div>
      <div class="glass" style="padding:22px;border-radius:24px">
        <div class="eyebrow">Data control</div><h3>Export or erase</h3>
        <p class="muted">Take a copy of your memory data or remove all memories from your account.</p>
        <div class="filter-row"><button class="btn" id="exportData">Export memories</button><button class="btn danger" id="deleteAll">Delete all memories</button></div>
      </div>
    </div>
  `,'Profile and Settings')
  wire()
  document.getElementById('settingsTheme').onclick=openThemePicker
  document.getElementById('logoutButton').onclick=async()=>{await supabase.auth.signOut();user=null;authScreen()}
  document.getElementById('saveProfile').onclick=async()=>{
    const display_name=document.getElementById('displayName').value.trim()
    const timezone=document.getElementById('timezone').value.trim()
    const {error}=await supabase.from('profiles').upsert({user_id:user.id,display_name,timezone})
    if(!error&&settingsData) await supabase.from('user_settings').update({adaptive_theme:(localStorage.getItem('memora-theme')||'auto')==='auto',theme_profile:localStorage.getItem('memora-theme')||'auto'}).eq('user_id',user.id)
    toast(error?error.message:'Profile saved')
  }
  document.getElementById('exportData').onclick=async()=>{
    const [{data:memoryData},{data:thingData},{data:peopleData},{data:contexts}]=await Promise.all([
      supabase.from('memories').select('*').order('created_at'),
      supabase.from('things').select('*'),
      supabase.from('people').select('*'),
      supabase.from('memory_contexts').select('*')
    ])
    const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),memories:memoryData,things:thingData,people:peopleData,contexts},null,2)],{type:'application/json'})
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

setupAtmosphere()

const session=await supabase.auth.getSession()
user=session.data.session?.user||null
if(user) await finalizePendingOAuth(session.data.session)
supabase.auth.onAuthStateChange((_event,sessionNow)=>{user=sessionNow?.user||null})
if(user) render()
else authScreen()

if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{})
