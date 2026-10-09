import { createClient } from '@supabase/supabase-js'
import { safeStorage, fetchApi } from './client/runtime.js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

const localStore = safeStorage('localStorage')
const sessionStore = safeStorage('sessionStorage')
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{storage:localStore}})
const app = document.getElementById('app')

let user = null
let view = 'home'
let chat = []
let chatThreads = []
let currentThreadId = new URL(window.location.href).searchParams.get('thread') || null
let legacySessionChat = []
try{
  const savedChat=JSON.parse(sessionStore.getItem('memora-chat')||'[]')
  if(Array.isArray(savedChat)) legacySessionChat=savedChat.slice(-40)
}catch{}
let pendingMedia = []
let pendingLocation = null
let recorder = null
let recorderStream = null
let recorderChunks = []
let cameraStream = null
let cameraFacing = 'environment'
let conversationContext = { thing: null, subject: null, relation: null, lastMemoryId: null, lastImageMediaId: null }
let navigationInitialized = false
let ambientAudioContext = null
let ambientMasterGain = null
let ambientNodes = []
let ambientTimers = []
let ambientCurrentScene = null
let ambientPreferences = {
  enabled: true,
  scene: 'auto',
  volume: 0.24,
  dynamicBackground: true
}

let experiencePreferences={
  onboardingCompleted:false,
  moodCheckinsEnabled:true,
  contextualScenery:true
}
let latestMood=null
let sceneBackdropState={query:'',url:'',sourcePage:'',artist:'',license:'',loading:false}

const moodCatalog={
  great:{label:'Great',audio:{mode:'music',query:'uplifting happy'}},
  happy:{label:'Happy',audio:{mode:'music',query:'feel good uplifting'}},
  calm:{label:'Calm',audio:{mode:'nature',query:'ocean'}},
  okay:{label:'Okay',audio:{mode:'music',query:'easy listening'}},
  low:{label:'Low',audio:{mode:'nature',query:'gentle rain'}},
  sad:{label:'Sad',audio:{mode:'nature',query:'forest'}},
  stressed:{label:'Stressed',audio:{mode:'nature',query:'rain'}},
  anxious:{label:'Anxious',audio:{mode:'nature',query:'ocean'}},
  tired:{label:'Tired',audio:{mode:'nature',query:'night'}},
  focused:{label:'Focused',audio:{mode:'music',query:'focus instrumental'}},
  prayerful:{label:'Prayerful',audio:{mode:'devotional',query:'',tradition:'all_faiths'}},
  grateful:{label:'Grateful',audio:{mode:'music',query:'peaceful uplifting'}}
}


let mediaPlayerState={
  mode:localStore.getItem('memora-player-mode')||'nature',
  query:localStore.getItem('memora-player-query')||'rain',
  library:[],
  current:null,
  index:0,
  loading:false,
  unlocked:false,
  radioBatches:0,
  radioCountry:localStore.getItem('memora-radio-country')||'',
  radioLanguage:localStore.getItem('memora-radio-language')||'',
  radioSort:localStore.getItem('memora-radio-sort')||'popular',
  radioOffset:0,
  radioHasMore:true,
  countries:[],
  languages:[],
  audioView:localStore.getItem('memora-audio-view')||'music',
  devotionalTradition:localStore.getItem('memora-devotional-tradition')||'all_faiths',
  devotionalLanguage:localStore.getItem('memora-devotional-language')||'',
  devotionalQuery:localStore.getItem('memora-devotional-query')||'',
  musicQuery:localStore.getItem('memora-music-query')||'',
  musicSort:localStore.getItem('memora-music-sort')||'relevant',
  musicGenre:localStore.getItem('memora-music-genre')||'',
  musicBrowseKind:localStore.getItem('memora-music-browse-kind')||'tracks',
  musicCollections:[],
  musicCollectionOffset:0,
  musicCollectionHasMore:true,
  activeCollection:null,
  musicOffset:0,
  musicHasMore:true
}

const defaultNaturalTrack={
  id:'curated-0',
  type:'nature',
  title:'Rain, thunder and birds',
  category:'Rain',
  license:'Public domain',
  artist:'Wikimedia Commons',
  url:'https://commons.wikimedia.org/wiki/Special:Redirect/file/Rainthunderandbirds.ogg',
  sourcePage:'https://commons.wikimedia.org/wiki/File:Rainthunderandbirds.ogg',
  curated:true
}


function loadConversationContext(threadId=currentThreadId){
  conversationContext={thing:null,subject:null,relation:null,lastMemoryId:null,lastImageMediaId:null}
  if(!threadId) return
  try{
    const saved=JSON.parse(localStore.getItem(`memora-context:${threadId}`)||'{}')
    conversationContext={...conversationContext,...saved}
  }catch{}
}

function persistConversationState(){
  if(!currentThreadId) return
  try{
    localStore.setItem(`memora-context:${currentThreadId}`,JSON.stringify(conversationContext))
  }catch{}
}
function applyLocalAccessibilityPreferences(){
  document.documentElement.dataset.largeText=localStore.getItem('memora-large-text')==='1'?'on':'off'
  document.documentElement.dataset.highContrast=localStore.getItem('memora-high-contrast')==='1'?'on':'off'
}
applyLocalAccessibilityPreferences()

let ocrWorkerPromise = null
let lastThemeHour = null

const themeFamilies=[
  {id:'aurora',name:'Aurora',h:252},{id:'ocean',name:'Ocean',h:210},{id:'rose',name:'Rose',h:330},
  {id:'forest',name:'Forest',h:145},{id:'solar',name:'Solar',h:28},{id:'lavender',name:'Lavender',h:275},
  {id:'arctic',name:'Arctic',h:190},{id:'ember',name:'Ember',h:8},{id:'neon',name:'Neon',h:300},
  {id:'sakura',name:'Sakura',h:345},{id:'copper',name:'Copper',h:22},{id:'galaxy',name:'Galaxy',h:235}
]
const themeMoods=[
  {id:'dawn',name:'Dawn',s:82,l:66,b:8},{id:'mist',name:'Mist',s:58,l:70,b:10},
  {id:'silk',name:'Silk',s:70,l:64,b:7},{id:'glow',name:'Glow',s:90,l:62,b:8},
  {id:'night',name:'Night',s:74,l:58,b:4},{id:'pearl',name:'Pearl',s:46,l:74,b:11},
  {id:'deep',name:'Deep',s:80,l:54,b:3},{id:'dream',name:'Dream',s:76,l:67,b:7},
  {id:'pulse',name:'Pulse',s:96,l:60,b:5},{id:'velvet',name:'Velvet',s:64,l:61,b:4}
]
const themeCatalog=themeFamilies.flatMap((family)=>themeMoods.map((mood,index)=>{
  const h1=(family.h+index*3)%360
  const h2=(family.h+48+index*4)%360
  const h3=(family.h+112+index*2)%360
  const bgHue=(family.h+index*2)%360
  return {
    id:`${family.id}-${mood.id}`,
    label:`${family.name} ${mood.name}`,
    c1:`hsl(${h1} ${mood.s}% ${mood.l}%)`,
    c2:`hsl(${h2} ${Math.max(48,mood.s-8)}% ${Math.min(74,mood.l+2)}%)`,
    c3:`hsl(${h3} ${Math.min(96,mood.s+4)}% ${Math.min(76,mood.l+4)}%)`,
    bg0:`hsl(${bgHue} 36% ${mood.b}%)`,
    bg1:`hsl(${(bgHue+12)%360} 42% ${mood.b+4}%)`,
    bg2:`hsl(${(bgHue+24)%360} 40% ${mood.b+7}%)`
  }
}))
const manualThemes=Object.fromEntries(themeCatalog.map(theme=>[theme.id,theme]))

const esc = value => String(value ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const secretPatterns=[
  /sk-[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /xox[baprs]-[0-9A-Za-z-]{20,}/g
]
function redactSecrets(value){
  let text=String(value??'')
  for(const pattern of secretPatterns) text=text.replace(pattern,'[credential redacted]')
  return text
}
function looksLikeSecret(value){
  const text=String(value||'')
  return secretPatterns.some(pattern=>{
    pattern.lastIndex=0
    const found=pattern.test(text)
    pattern.lastIndex=0
    return found
  })
}

const when = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Unknown date'
const shortDate = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value)) : 'Unknown'

function removeStrayEscapedNewline(){
  if(!document.body) return
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
  const remove=[]
  while(walker.nextNode()){
    const node=walker.currentNode
    const parent=node.parentElement
    if(!parent||parent.closest('textarea,input,pre,code,[contenteditable="true"]')) continue
    const raw=String(node.textContent||'')
    const trimmed=raw.trim()
    if(/^(?:\\n|\/n)+$/i.test(trimmed)){
      remove.push(node)
      continue
    }
    if(/^(?:\\n|\/n)\s+/i.test(raw)){
      node.textContent=raw.replace(/^(?:\\n|\/n)\s*/i,'')
    }
  }
  remove.forEach(node=>node.remove())
  document.querySelectorAll('body > br:first-child,#app > br:first-child').forEach(node=>node.remove())
}

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
  const previousFocus=document.activeElement
  const wrap=document.createElement('div')
  wrap.className='modal-backdrop'
  wrap.innerHTML=`<div class="glass modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h3>${esc(title)}</h3><button class="close" aria-label="Close">×</button></div>${body}</div>`
  const close=()=>{
    wrap.remove()
    if(previousFocus?.focus) previousFocus.focus({preventScroll:true})
  }
  wrap.querySelector('.close').onclick=close
  wrap.onclick=e=>{if(e.target===wrap)close()}
  wrap.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.stopPropagation();close()}
    if(e.key==='Tab'){
      const nodes=[...wrap.querySelectorAll('button,input,select,textarea,a[href],iframe,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length)
      const first=nodes[0],last=nodes[nodes.length-1]
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
    }
  })
  document.body.appendChild(wrap)
  setTimeout(()=>wrap.querySelector('.close')?.focus({preventScroll:true}),20)
  return wrap
}


const ambientScenes=[
  {id:'auto',name:'Adaptive mix',description:'Changes with the hour'},
  {id:'rain',name:'Rain',description:'Soft rain and airy noise'},
  {id:'ocean',name:'Ocean',description:'Slow waves and deep wash'},
  {id:'forest',name:'Forest',description:'Quiet air with distant tones'},
  {id:'fire',name:'Fireplace',description:'Warm low crackle'},
  {id:'night',name:'Night',description:'Dark air and soft crickets'},
  {id:'brown',name:'Brown noise',description:'Deep focus noise'},
  {id:'focus',name:'Deep focus',description:'Balanced low ambient noise'}
]

async function loadChatThreads(){
  if(!user) return []
  const {data,error}=await supabase.from('chat_threads')
    .select('*')
    .eq('archived',false)
    .order('last_message_at',{ascending:false})
  if(error){console.warn('Chat thread load failed',error);return []}
  chatThreads=data||[]
  return chatThreads
}

async function createChatThread(title='New chat',{navigate=false}={}){
  const {data,error}=await supabase.from('chat_threads').insert({
    user_id:user.id,
    title:compactText(redactSecrets(title||'New chat'),70)||'New chat'
  }).select().single()
  if(error) throw error
  currentThreadId=data.id
  chat=[]
  conversationContext={thing:null,subject:null,relation:null,lastMemoryId:null,lastImageMediaId:null}
  persistConversationState()
  await loadChatThreads()
  if(navigate) await go('ask',false,{push:true})
  return data
}

async function loadChatThread(threadId){
  if(!threadId) return null
  const thread=await supabase.from('chat_threads').select('*').eq('id',threadId).maybeSingle()
  if(thread.error||!thread.data) return null
  const {data,error}=await supabase.from('chat_messages')
    .select('*')
    .eq('thread_id',threadId)
    .order('created_at',{ascending:true})
  if(error) throw error
  currentThreadId=threadId
  loadConversationContext(threadId)
  chat=(data||[]).map(row=>({
    id:row.id,
    role:row.role,
    text:redactSecrets(row.content),
    source:row.source||null,
    ai:Boolean(row.metadata?.ai),
    action:row.metadata?.action||null,
    created_at:row.created_at
  }))
  return thread.data
}

async function ensureChatThread(){
  if(currentThreadId){
    const loaded=await loadChatThread(currentThreadId)
    if(loaded) return loaded
  }
  const threads=await loadChatThreads()
  if(threads.length){
    await loadChatThread(threads[0].id)
    return threads[0]
  }
  return await createChatThread('New chat')
}

async function saveChatMessage(role,text,extra={}){
  if(!currentThreadId) await ensureChatThread()
  const safeText=redactSecrets(String(text||'')).trim()
  if(!safeText) return null
  const {data,error}=await supabase.from('chat_messages').insert({
    thread_id:currentThreadId,
    user_id:user.id,
    role,
    content:safeText,
    source:extra.source||null,
    metadata:{
      ai:Boolean(extra.ai),
      imageUsed:Boolean(extra.imageUrl||extra.imageUsed),
      structured:Boolean(extra.structured),
      action:extra.action||null
    }
  }).select().single()
  if(error) throw error

  const current=chatThreads.find(item=>item.id===currentThreadId)
  const update={last_message_at:new Date().toISOString(),updated_at:new Date().toISOString()}
  if(role==='user'&&(!current||current.title==='New chat')){
    update.title=compactText(safeText.replace(/\s+/g,' '),58)||'New chat'
  }
  await supabase.from('chat_threads').update(update).eq('id',currentThreadId)
  await loadChatThreads()
  return data
}

async function deleteChatThread(threadId){
  if(!threadId) return
  const {error}=await supabase.from('chat_threads').delete().eq('id',threadId)
  if(error) throw error
  try{localStore.removeItem(`memora-context:${threadId}`)}catch{}
  if(currentThreadId===threadId){
    currentThreadId=null
    chat=[]
    conversationContext={thing:null,subject:null,relation:null,lastMemoryId:null,lastImageMediaId:null}
    await ensureChatThread()
  }
  await loadChatThreads()
}

async function renameChatThread(threadId,title){
  const safe=compactText(redactSecrets(title||'').trim(),70)
  if(!safe) return
  const {error}=await supabase.from('chat_threads').update({title:safe,updated_at:new Date().toISOString()}).eq('id',threadId)
  if(error) throw error
  await loadChatThreads()
}

async function migrateLegacyChat(){
  if(!legacySessionChat.length||!user) return
  const existing=await loadChatThreads()
  if(existing.length){
    sessionStore.removeItem('memora-chat')
    sessionStore.removeItem('memora-context')
    legacySessionChat=[]
    return
  }
  const thread=await createChatThread('Previous conversation')
  const rows=legacySessionChat
    .filter(item=>item&&['user','assistant'].includes(item.role)&&item.text)
    .map(item=>({
      thread_id:thread.id,
      user_id:user.id,
      role:item.role,
      content:redactSecrets(String(item.text)),
      source:item.source||null,
      metadata:{ai:Boolean(item.ai),migrated:true}
    }))
  if(rows.length) await supabase.from('chat_messages').insert(rows)
  sessionStore.removeItem('memora-chat')
  sessionStore.removeItem('memora-context')
  legacySessionChat=[]
  await loadChatThread(thread.id)
}

function resolveAmbientScene(){
  if(ambientPreferences.scene&&ambientPreferences.scene!=='auto') return ambientPreferences.scene
  const hour=new Date().getHours()
  if(hour>=5&&hour<8) return 'forest'
  if(hour>=8&&hour<12) return 'focus'
  if(hour>=12&&hour<17) return 'ocean'
  if(hour>=17&&hour<20) return 'rain'
  if(hour>=20&&hour<23) return 'fire'
  return 'night'
}

function sceneQueryFromText(value){
  const text=String(value||'').toLowerCase()
  const map=[
    [/rain|storm|thunder/,'rain landscape'],
    [/forest|woods|jungle|rainforest/,'forest landscape'],
    [/ocean|sea|beach|coast|shore/,'ocean coast'],
    [/mountain|hill|hiking|trek/,'mountain landscape'],
    [/night|stars|moon/,'night sky landscape'],
    [/sunset|evening|golden hour/,'sunset landscape'],
    [/church|cathedral|chapel/,'church architecture'],
    [/temple/,'temple architecture'],
    [/mosque/,'mosque architecture'],
    [/city|downtown|street/,'city skyline'],
    [/park|garden/,'garden park'],
    [/village|countryside/,'countryside landscape'],
    [/snow|winter/,'snow landscape'],
    [/river|waterfall|lake/,'water landscape']
  ]
  for(const [pattern,query] of map) if(pattern.test(text)) return query
  return ''
}

function renderSceneCredit(){
  const credit=document.getElementById('sceneCredit')
  if(!credit) return
  if(!sceneBackdropState.sourcePage){
    credit.classList.add('hidden')
    credit.removeAttribute('href')
    return
  }
  credit.href=sceneBackdropState.sourcePage
  credit.textContent='Scene: Wikimedia Commons'
  credit.title=[sceneBackdropState.artist,sceneBackdropState.license].filter(Boolean).join(' · ')
  credit.classList.remove('hidden')
}

async function loadSceneBackdrop(query,{force=false}={}){
  if(!experiencePreferences.contextualScenery||!ambientPreferences.dynamicBackground) return
  const clean=String(query||'').trim().slice(0,80)
  if(!clean||sceneBackdropState.loading) return
  const bucket=new Date().toISOString().slice(0,13)
  const cacheKey=`memora-scene:${clean.toLowerCase()}:${bucket}`
  if(!force){
    try{
      const cached=JSON.parse(sessionStore.getItem(cacheKey)||'null')
      if(cached?.url){
        sceneBackdropState={...sceneBackdropState,...cached,query:clean,loading:false}
        document.documentElement.style.setProperty('--scene-photo',`url("${cached.url.replace(/"/g,'%22')}")`)
        document.documentElement.dataset.scenePhoto='on'
        renderSceneCredit()
        return
      }
    }catch{}
  }

  sceneBackdropState.loading=true
  try{
    const response=await fetch(`/api/scene-background?q=${encodeURIComponent(clean)}&bucket=${encodeURIComponent(bucket)}`)
    const data=await response.json()
    if(!response.ok||!data?.item?.url) return
    sceneBackdropState={query:clean,loading:false,...data.item}
    document.documentElement.style.setProperty('--scene-photo',`url("${String(data.item.url).replace(/"/g,'%22')}")`)
    document.documentElement.dataset.scenePhoto='on'
    try{sessionStore.setItem(cacheKey,JSON.stringify(data.item))}catch{}
    renderSceneCredit()
  }catch{
    sceneBackdropState.loading=false
  }finally{
    sceneBackdropState.loading=false
  }
}

async function maybeApplyContextScene(text){
  if(!experiencePreferences.contextualScenery) return
  const keyword=sceneQueryFromText(text)
  if(keyword) return loadSceneBackdrop(keyword)

  if(user){
    try{
      const {data:places}=await supabase.from('places').select('name,address').order('last_visited_at',{ascending:false}).limit(20)
      const lower=String(text||'').toLowerCase()
      const place=(places||[]).find(item=>{
        const name=String(item.name||'').trim().toLowerCase()
        return name.length>2&&lower.includes(name)
      })
      if(place) return loadSceneBackdrop(place.name||place.address)
    }catch{}
  }
}

const themeSceneQueries={
  aurora:'aurora borealis night landscape',
  ocean:'ocean coast',
  rose:'rose flower garden',
  forest:'forest landscape',
  solar:'sunrise golden landscape',
  lavender:'lavender field',
  arctic:'arctic snow landscape',
  ember:'warm fireplace cabin',
  neon:'neon city night',
  sakura:'cherry blossom landscape',
  copper:'autumn forest landscape',
  galaxy:'milky way night sky'
}

function sceneForTheme(themeId){
  const family=String(themeId||'').split('-')[0]
  return themeSceneQueries[family]||family||'calm landscape'
}

function detectRememberableStatement(value){
  const text=String(value||'').trim()
  if(!text||looksLikeSecret(text)) return null
  const lower=normalizeQuestion(text).toLowerCase()
  const explicit=/^(?:please\s+)?(?:remember|save)\s+(?:this\s+|that\s+)?/i.test(text)
  if(explicit){
    const cleaned=text.replace(/^(?:please\s+)?(?:remember|save)\s+(?:this\s+|that\s+)?(?:to\s+(?:my\s+)?memory\s*)?/i,'').trim()
    return cleaned||text
  }
  if(/[?]$/.test(text)) return null
  if(/^(?:i|we)\s+(?:went|visited|met|bought|purchased|got|received|started|finished|joined|moved|shifted|kept|put|left|stored|placed|attended|played|travelled|traveled|ate|changed|renewed|booked|lost|found)\b/i.test(text)) return text
  if(/^my\s+.{1,45}\s+(?:is|are|was|were)\s+.{2,}/i.test(text)) return text
  return null
}

function detectMoodStatement(value){
  const text=normalizeQuestion(String(value||'')).toLowerCase()
  if(/\b(?:do not|don't|dont)\s+(?:save|remember|store)\b/.test(text)) return null
  const explicit=/\b(?:i feel|i'm feeling|i am feeling|my mood is|today i feel|today i'm|today i am)\b/.test(text)
  if(!explicit) return null
  const tests=[
    ['prayerful',/prayerful|spiritual|want to pray|need prayer/],
    ['stressed',/stressed|overwhelmed|pressure|burned out|burnt out/],
    ['anxious',/anxious|nervous|worried|uneasy/],
    ['sad',/sad|down|unhappy|heartbroken|upset/],
    ['low',/low|not great|not good|rough/],
    ['tired',/tired|exhausted|sleepy|drained/],
    ['great',/great|amazing|fantastic|wonderful/],
    ['happy',/happy|good|excited|cheerful|joyful/],
    ['grateful',/grateful|thankful|blessed/],
    ['focused',/focused|productive|motivated/],
    ['calm',/calm|peaceful|relaxed|fine/],
    ['okay',/okay|ok|alright|so so/]
  ]
  for(const [mood,pattern] of tests) if(pattern.test(text)) return mood
  return null
}

async function recordMood(mood,note='',source='chat'){
  if(!user||!experiencePreferences.moodCheckinsEnabled||!moodCatalog[mood]) return null
  const now=new Date().toISOString()
  const label=moodCatalog[mood].label
  const {data:memory,error:memoryError}=await supabase.from('memories').insert({
    user_id:user.id,
    original_text:note||`Mood check-in: ${label}`,
    summary:`Mood check-in: ${label}`,
    memory_type:'event',
    state:'historical',
    occurred_at:now,
    source_type:'manual',
    provenance_kind:'user_stated',
    confidence:1,
    interpreted_data:{mood,source}
  }).select().single()
  if(memoryError) throw memoryError
  const {data,error}=await supabase.from('mood_logs').insert({
    user_id:user.id,
    mood,
    note:note||null,
    source,
    memory_id:memory.id,
    created_at:now
  }).select().single()
  if(error) throw error
  latestMood=data
  maybeApplyContextScene(mood)
  return data
}

async function playForMood(mood){
  const plan=moodCatalog[mood]?.audio||moodCatalog.calm.audio
  mediaPlayerState.audioView=plan.mode
  if(plan.mode==='devotional'){
    mediaPlayerState.devotionalTradition=plan.tradition||'all_faiths'
    mediaPlayerState.devotionalQuery=plan.query||''
    const items=await loadMediaLibrary('devotional',plan.query||'',100,{
      preserveCurrent:false,
      tradition:mediaPlayerState.devotionalTradition,
      language:mediaPlayerState.devotionalLanguage,
      countrycode:mediaPlayerState.radioCountry,
      sort:'popular'
    })
    if(items?.length) await selectMediaTrack(items[0],true)
  }else if(plan.mode==='music'){
    const items=await loadMediaLibrary('music',plan.query||'',50,{preserveCurrent:false,sort:'relevant'})
    if(items?.length) await selectMediaTrack(items[0],true)
  }else{
    const items=await loadMediaLibrary('nature',plan.query||'rain',100,{preserveCurrent:false})
    if(items?.length) await selectMediaTrack(items[0],true)
  }
}

async function playMemoryMix(){
  if(!user) return
  const {data}=await supabase.from('memories').select('summary,original_text,memory_type,occurred_at').order('occurred_at',{ascending:false}).limit(8)
  const text=(data||[]).map(item=>`${item.summary||''} ${item.original_text||''}`).join(' ').toLowerCase()
  let mode='music'
  let query='calm uplifting'
  let tradition='all_faiths'

  if(/wedding|marriage|love|anniversary|romantic/.test(text)) query='romantic acoustic'
  else if(/travel|trip|flight|beach|holiday|vacation/.test(text)) query='world chill travel'
  else if(/work|office|study|project|meeting|exam/.test(text)) query='focus instrumental'
  else if(/football|cricket|basketball|gym|sport|workout/.test(text)) query='energetic workout'
  else if(/church|christian|gospel|worship|prayer/.test(text)){mode='devotional';tradition='christian';query='worship'}
  else if(/temple|bhajan|hindu|aarti|mantra/.test(text)){mode='devotional';tradition='hindu';query='bhajan'}
  else if(/quran|nasheed|islam|mosque/.test(text)){mode='devotional';tradition='islamic';query='nasheed'}

  mediaPlayerState.audioView=mode
  if(mode==='devotional'){
    mediaPlayerState.devotionalTradition=tradition
    mediaPlayerState.devotionalQuery=query
    const items=await loadMediaLibrary('devotional',query,100,{preserveCurrent:false,tradition,sort:'popular'})
    if(items?.length) await selectMediaTrack(items[0],true)
  }else{
    const items=await loadMediaLibrary('music',query,50,{preserveCurrent:false,sort:'relevant'})
    if(items?.length) await selectMediaTrack(items[0],true)
  }
  maybeApplyContextScene(text)
}

async function playWorldSurprise(){
  mediaPlayerState.audioView='radio'
  mediaPlayerState.radioCountry=''
  mediaPlayerState.radioLanguage=''
  mediaPlayerState.radioSort='random'
  const items=await loadMediaLibrary('radio','',100,{preserveCurrent:false,random:true,countrycode:'',language:'',sort:'random'})
  if(items?.length) await selectMediaTrack(items[0],true)
}

async function completeOnboarding(skipped=false){
  experiencePreferences.onboardingCompleted=true
  await supabase.from('user_settings').upsert({
    user_id:user.id,
    onboarding_completed:true,
    onboarding_skipped_at:skipped?new Date().toISOString():null,
    mood_checkins_enabled:experiencePreferences.moodCheckinsEnabled,
    contextual_scenery:experiencePreferences.contextualScenery
  })
}

async function showOnboardingTour({force=false}={}){
  if(!user||(!force&&experiencePreferences.onboardingCompleted)) return
  const steps=[
    {
      eyebrow:'Welcome to Memora',
      title:'A memory companion, not just a storage app.',
      body:'Talk naturally, save moments, photos, places and files, then ask about them later. Memora can also chat with you normally when you just want to talk.',
      action:'Begin tour'
    },
    {
      eyebrow:'Remember',
      title:'Tell Memora what matters.',
      body:'Type or speak a memory, attach a photo or file, capture a place, or simply say something like “I kept my keys in the top drawer.” Memora keeps the source and context with it.'
    },
    {
      eyebrow:'Talk and check in',
      title:'Your mood can be part of your story.',
      body:'Tell Memora “I feel stressed today” or use the mood check-in on Home. Memora can remember the check-in, respond naturally, and offer audio that fits the moment.'
    },
    {
      eyebrow:'Listen',
      title:'Music, worldwide radio, devotionals and nature.',
      body:'Use one compact player for open music tracks, real live radio, devotional discovery across traditions and languages, and real nature recordings. Advanced filters stay tucked away until you need them.'
    },
    {
      eyebrow:'Private and yours',
      title:'One shared memory vault, separate conversations.',
      body:'Create different chats for work, family or anything else. They keep separate conversational context while still using the same private memory vault. You can export or delete your data from Settings.',
      action:'Enter Memora'
    }
  ]
  let index=0
  const box=modal('Welcome to Memora','<div id="tourBody"></div>')
  box.classList.add('tour-backdrop')
  box.querySelector('.modal')?.classList.add('tour-modal')
  const renderStep=()=>{
    const step=steps[index]
    const body=box.querySelector('#tourBody')
    body.innerHTML=`
      <div class="tour-progress">${steps.map((_,i)=>`<span class="${i<=index?'active':''}"></span>`).join('')}</div>
      <div class="tour-visual"><div class="tour-orb"><span></span></div><small>${esc(step.eyebrow)}</small></div>
      <h2>${esc(step.title)}</h2>
      <p>${esc(step.body)}</p>
      <div class="tour-actions">
        <button class="btn ghost" id="tourSkip">${index===steps.length-1?'Close':'Skip tour'}</button>
        <button class="btn primary" id="tourNext">${esc(step.action||(index===steps.length-1?'Enter Memora':'Next'))}</button>
      </div>`
    body.querySelector('#tourSkip').onclick=async()=>{
      await completeOnboarding(true)
      box.remove()
    }
    body.querySelector('#tourNext').onclick=async()=>{
      if(index<steps.length-1){
        index++
        renderStep()
      }else{
        await completeOnboarding(false)
        box.remove()
        setTimeout(()=>document.getElementById('memoryInput')?.focus(),80)
      }
    }
  }
  renderStep()
}

function updateVisualScene(){
  const now=new Date()
  const hour=now.getHours()
  const month=now.getMonth()+1
  const daypart=hour>=5&&hour<8?'dawn':hour>=8&&hour<12?'morning':hour>=12&&hour<17?'day':hour>=17&&hour<20?'sunset':'night'
  const season=month>=3&&month<=5?'spring':month>=6&&month<=8?'summer':month>=9&&month<=11?'autumn':'winter'
  document.documentElement.dataset.daypart=daypart
  document.documentElement.dataset.season=season
  document.documentElement.dataset.dynamicBackground=ambientPreferences.dynamicBackground?'on':'off'
}

async function loadExperiencePreferences(){
  if(!user) return ambientPreferences
  const {data}=await supabase.from('user_settings')
    .select('ambient_enabled,ambient_scene,ambient_volume,dynamic_background,reduce_motion,onboarding_completed,mood_checkins_enabled,contextual_scenery')
    .maybeSingle()
  if(data){
    ambientPreferences={
      enabled:data.ambient_enabled!==false,
      scene:data.ambient_scene||'auto',
      volume:Number(data.ambient_volume??0.24),
      dynamicBackground:data.dynamic_background!==false
    }
    experiencePreferences={
      onboardingCompleted:data.onboarding_completed===true,
      moodCheckinsEnabled:data.mood_checkins_enabled!==false,
      contextualScenery:data.contextual_scenery!==false
    }
    document.documentElement.dataset.reduceMotion=data.reduce_motion?'on':'off'
  }else{
    await supabase.from('user_settings').upsert({
      user_id:user.id,
      ambient_enabled:true,
      ambient_scene:'auto',
      ambient_volume:0.24,
      dynamic_background:true,
      onboarding_completed:false,
      mood_checkins_enabled:true,
      contextual_scenery:true
    })
  }
  const {data:moodRows}=await supabase.from('mood_logs').select('mood,intensity,note,created_at').order('created_at',{ascending:false}).limit(1)
  latestMood=moodRows?.[0]||null
  updateVisualScene()
  updateSoundButton()
  return ambientPreferences
}

async function saveExperiencePreferences(patch){
  ambientPreferences={...ambientPreferences,...patch}
  updateVisualScene()
  updateSoundButton()
  if(user){
    await supabase.from('user_settings').upsert({
      user_id:user.id,
      ambient_enabled:ambientPreferences.enabled,
      ambient_scene:ambientPreferences.scene,
      ambient_volume:ambientPreferences.volume,
      dynamic_background:ambientPreferences.dynamicBackground,
      mood_checkins_enabled:experiencePreferences.moodCheckinsEnabled,
      contextual_scenery:experiencePreferences.contextualScenery,
      onboarding_completed:experiencePreferences.onboardingCompleted,
      updated_at:new Date().toISOString()
    })
  }
}

function stopAmbientNodes(){
  for(const timer of ambientTimers) clearInterval(timer)
  ambientTimers=[]
  for(const node of ambientNodes){
    try{node.stop?.()}catch{}
    try{node.disconnect?.()}catch{}
  }
  ambientNodes=[]
  ambientCurrentScene=null
}

function noiseBuffer(ctx,kind='white'){
  const seconds=4
  const buffer=ctx.createBuffer(1,ctx.sampleRate*seconds,ctx.sampleRate)
  const data=buffer.getChannelData(0)
  let last=0
  for(let i=0;i<data.length;i++){
    const white=Math.random()*2-1
    if(kind==='brown'){
      last=(last+0.02*white)/1.02
      data[i]=last*3.2
    }else if(kind==='pink'){
      last=0.96*last+0.04*white
      data[i]=last*2.2
    }else data[i]=white
  }
  return buffer
}

function addAmbientNoise(kind,{gain=0.1,lowpass=12000,highpass=20,lfo=0}={}){
  const ctx=ambientAudioContext
  const source=ctx.createBufferSource()
  source.buffer=noiseBuffer(ctx,kind)
  source.loop=true
  const hp=ctx.createBiquadFilter()
  hp.type='highpass'
  hp.frequency.value=highpass
  const lp=ctx.createBiquadFilter()
  lp.type='lowpass'
  lp.frequency.value=lowpass
  const g=ctx.createGain()
  g.gain.value=gain
  source.connect(hp).connect(lp).connect(g).connect(ambientMasterGain)
  if(lfo>0){
    const osc=ctx.createOscillator()
    const depth=ctx.createGain()
    osc.frequency.value=lfo
    depth.gain.value=gain*0.45
    osc.connect(depth).connect(g.gain)
    osc.start()
    ambientNodes.push(osc,depth)
  }
  source.start()
  ambientNodes.push(source,hp,lp,g)
}

function addAmbientTone(freq,{gain=0.008,mod=0.12,type='sine'}={}){
  const ctx=ambientAudioContext
  const osc=ctx.createOscillator()
  const g=ctx.createGain()
  osc.type=type
  osc.frequency.value=freq
  g.gain.value=gain
  osc.connect(g).connect(ambientMasterGain)
  if(mod){
    const lfo=ctx.createOscillator()
    const depth=ctx.createGain()
    lfo.frequency.value=mod
    depth.gain.value=gain*0.75
    lfo.connect(depth).connect(g.gain)
    lfo.start()
    ambientNodes.push(lfo,depth)
  }
  osc.start()
  ambientNodes.push(osc,g)
}

async function startAmbient(sceneId=resolveAmbientScene()){
  if(!ambientPreferences.enabled) return
  if(!window.AudioContext&&!window.webkitAudioContext) return
  if(!ambientAudioContext){
    const Ctx=window.AudioContext||window.webkitAudioContext
    ambientAudioContext=new Ctx()
    ambientMasterGain=ambientAudioContext.createGain()
    ambientMasterGain.connect(ambientAudioContext.destination)
  }
  if(ambientAudioContext.state==='suspended'){
    try{await ambientAudioContext.resume()}catch{return}
  }
  stopAmbientNodes()
  ambientMasterGain.gain.setTargetAtTime(Math.max(0,Math.min(1,ambientPreferences.volume)),ambientAudioContext.currentTime,0.08)
  ambientCurrentScene=sceneId

  if(sceneId==='rain'){
    addAmbientNoise('white',{gain:.10,highpass:900,lowpass:9000,lfo:.18})
    addAmbientNoise('pink',{gain:.035,highpass:180,lowpass:2400})
  }else if(sceneId==='ocean'){
    addAmbientNoise('brown',{gain:.18,highpass:30,lowpass:1100,lfo:.075})
    addAmbientNoise('pink',{gain:.04,highpass:500,lowpass:3600,lfo:.11})
  }else if(sceneId==='forest'){
    addAmbientNoise('pink',{gain:.055,highpass:120,lowpass:5200,lfo:.05})
    addAmbientTone(430,{gain:.005,mod:.09})
    addAmbientTone(620,{gain:.0035,mod:.13})
  }else if(sceneId==='fire'){
    addAmbientNoise('brown',{gain:.11,highpass:160,lowpass:1800,lfo:.16})
    addAmbientNoise('white',{gain:.018,highpass:1600,lowpass:7000,lfo:.7})
  }else if(sceneId==='night'){
    addAmbientNoise('brown',{gain:.055,highpass:30,lowpass:900,lfo:.04})
    addAmbientTone(3300,{gain:.0018,mod:5.8})
    addAmbientTone(4100,{gain:.0012,mod:6.7})
  }else if(sceneId==='brown'){
    addAmbientNoise('brown',{gain:.20,highpass:30,lowpass:2400})
  }else{
    addAmbientNoise('brown',{gain:.11,highpass:30,lowpass:1800,lfo:.035})
    addAmbientNoise('pink',{gain:.025,highpass:800,lowpass:5000})
  }
  updateSoundButton()
  renderSceneCredit()
}

function stopAmbient(){
  stopAmbientNodes()
  if(ambientMasterGain&&ambientAudioContext){
    ambientMasterGain.gain.setTargetAtTime(0,ambientAudioContext.currentTime,0.05)
  }
  updateSoundButton()
  renderSceneCredit()
}

function mediaAudio(){
  return document.getElementById('memoraAudio')
}

function mediaPlayerVisible(){
  return Boolean(document.getElementById('memoraMediaPlayer'))
}

function ensureMediaPlayer(){
  if(!user) return null
  let player=document.getElementById('memoraMediaPlayer')
  if(player) return player

  player=document.createElement('section')
  player.id='memoraMediaPlayer'
  player.className='memora-player glass compact-player'
  player.setAttribute('role','region')
  player.setAttribute('aria-label','Memora audio mini player')
  player.innerHTML=`
    <audio id="memoraAudio" preload="metadata" playsinline></audio>
    <button class="player-mini-art" id="playerNowPlaying" aria-label="Open Now Playing">
      <img id="playerArtwork" alt="" loading="eager">
      <span class="player-art-fallback"><i></i><i></i><i></i></span>
    </button>
    <button class="player-track player-track-button" id="playerTrackOpen" aria-label="Open Now Playing">
      <small id="playerSource">Nature · Wikimedia Commons</small>
      <strong id="playerTitle">Rain, thunder and birds</strong>
      <span id="playerStatus">Ready</span>
    </button>
    <div class="player-actions mini-actions">
      <button class="player-action primary" id="playerPlay" aria-label="Play or pause">▶</button>
      <button class="player-action" id="playerNext" aria-label="Next">››</button>
      <button class="player-action" id="playerMute" aria-label="Mute or unmute">Mute</button>
      <button class="player-action expand-action" id="playerExpand" aria-label="Expand Now Playing">⌃</button>
    </div>
  `
  document.body.appendChild(player)
  document.body.classList.add('has-memora-player')

  const audio=mediaAudio()
  audio.volume=Math.max(0,Math.min(1,ambientPreferences.volume))
  audio.muted=!ambientPreferences.enabled
  audio.src=defaultNaturalTrack.url
  mediaPlayerState.current=defaultNaturalTrack

  audio.addEventListener('play',()=>{mediaPlayerState.unlocked=true;refreshMediaPlayerUI();syncNowPlayingProgress()})
  audio.addEventListener('pause',()=>{refreshMediaPlayerUI();syncNowPlayingProgress()})
  audio.addEventListener('timeupdate',syncNowPlayingProgress)
  audio.addEventListener('durationchange',syncNowPlayingProgress)
  audio.addEventListener('waiting',()=>setPlayerStatus('Buffering...'))
  audio.addEventListener('playing',refreshMediaPlayerUI)
  audio.addEventListener('error',()=>{
    if(!user) return
    const failedId=mediaPlayerState.current?.id
    clearTimeout(mediaRecoveryTimer)
    if(++mediaRecoveryAttempts>Math.min(3,mediaPlayerState.library.length)){
      audio.pause()
      setPlayerStatus('Stream unavailable. Choose another track or retry Play.')
      return
    }
    setPlayerStatus('Stream unavailable · trying next')
    mediaRecoveryTimer=setTimeout(()=>{
      if(user&&mediaPlayerState.current?.id===failedId) nextMediaTrack(true,true).catch(()=>setPlayerStatus('Choose another track to continue'))
    },650)
  })
  audio.addEventListener('ended',()=>{
    if(['nature','music'].includes(mediaPlayerState.mode)) nextMediaTrack(true)
    else refreshMediaPlayerUI()
  })

  document.getElementById('playerPlay').onclick=toggleMediaPlayback
  document.getElementById('playerNext').onclick=()=>nextMediaTrack(true)
  document.getElementById('playerMute').onclick=toggleMediaMute
  document.getElementById('playerExpand').onclick=openNowPlayingSheet
  document.getElementById('playerNowPlaying').onclick=openNowPlayingSheet
  document.getElementById('playerTrackOpen').onclick=openNowPlayingSheet

  refreshMediaPlayerUI()
  return player
}

function formatPlayerTime(seconds){
  const value=Number(seconds||0)
  if(!Number.isFinite(value)||value<0) return '0:00'
  const mins=Math.floor(value/60)
  const secs=Math.floor(value%60).toString().padStart(2,'0')
  return `${mins}:${secs}`
}

function syncNowPlayingProgress(){
  const audio=mediaAudio()
  const progress=document.getElementById('nowPlayingProgress')
  const elapsed=document.getElementById('nowPlayingElapsed')
  const total=document.getElementById('nowPlayingTotal')
  if(!audio||!progress) return
  const live=mediaPlayerState.current?.type==='radio'
  if(live){
    progress.value='0'
    progress.disabled=true
    if(elapsed) elapsed.textContent='LIVE'
    if(total) total.textContent=''
    return
  }
  const duration=Number.isFinite(audio.duration)?audio.duration:Number(mediaPlayerState.current?.duration||0)
  const current=Number.isFinite(audio.currentTime)?audio.currentTime:0
  progress.disabled=!duration
  progress.max=String(Math.max(1,duration||1))
  progress.value=String(Math.min(current,duration||current))
  if(elapsed) elapsed.textContent=formatPlayerTime(current)
  if(total) total.textContent=duration?formatPlayerTime(duration):''
}

async function previousMediaTrack(autoplay=true){
  ensureMediaPlayer()
  if(!mediaPlayerState.library.length) return
  mediaPlayerState.index=(mediaPlayerState.index-1+mediaPlayerState.library.length)%mediaPlayerState.library.length
  await selectMediaTrack(mediaPlayerState.library[mediaPlayerState.index],autoplay)
}

function nowPlayingArtwork(current){
  return current?.artwork||current?.favicon||''
}

function openNowPlayingSheet(){
  ensureMediaPlayer()
  const current=mediaPlayerState.current||defaultNaturalTrack
  const audio=mediaAudio()
  const artwork=nowPlayingArtwork(current)
  const source=current.type==='music'
    ?`Open Music · ${current.provider==='commons'?'Wikimedia Commons':'Audius'}`
    :current.devotional
      ?`Devotional · ${current.traditionLabel||'Spiritual'}`
      :current.type==='radio'
        ?'Live Radio'
        :'Nature'

  const wrap=modal('Now Playing',`
    <div class="now-playing">
      <div class="now-playing-art ${artwork?'has-image':''}">
        ${artwork?`<img src="${esc(artwork)}" alt="" referrerpolicy="no-referrer">`:'<span><i></i><i></i><i></i><i></i></span>'}
      </div>
      <div class="now-playing-copy">
        <span class="eyebrow" id="nowPlayingSource">${esc(source)}</span>
        <h3 id="nowPlayingTitle">${esc(current.title||'Memora Audio')}</h3>
        <p id="nowPlayingArtist">${esc(current.artist||current.country||current.devotionalLanguage||current.category||'')}</p>
      </div>
      <div class="now-playing-progress">
        <input id="nowPlayingProgress" type="range" min="0" max="1" value="0" step="0.1" aria-label="Playback position">
        <div><span id="nowPlayingElapsed">0:00</span><span id="nowPlayingTotal"></span></div>
      </div>
      <div class="now-playing-controls">
        <button class="now-control secondary" id="nowPrevious" aria-label="Previous">‹‹</button>
        <button class="now-control play" id="nowPlay" aria-label="Play or pause">${audio&&!audio.paused?'Ⅱ':'▶'}</button>
        <button class="now-control secondary" id="nowNext" aria-label="Next">››</button>
      </div>
      <div class="now-playing-tools">
        <button class="btn" id="nowMute">${audio?.muted?'Unmute':'Mute'}</button>
        <button class="btn" id="nowStop">Stop</button>
        <button class="btn primary" id="nowLibrary">Browse Audio</button>
      </div>
      <label class="now-volume"><span>Volume</span><input id="nowVolume" type="range" min="0" max="1" value="${ambientPreferences.volume}" step="0.01"><b>${Math.round(ambientPreferences.volume*100)}%</b></label>
      <div class="now-playing-meta">
        ${current.type==='music'?`<span>Full track from ${esc(current.provider==='commons'?'Wikimedia Commons open media':'the Audius open music catalog')}</span>`:''}
        ${current.type==='radio'?'<span>Live station stream supplied by the broadcaster</span>':''}
        ${current.type==='nature'?'<span>Open nature recording streamed from Wikimedia Commons</span>':''}
        ${current.sourcePage?`<a href="${esc(current.sourcePage)}" target="_blank" rel="noopener">Open source page ↗</a>`:''}
      </div>
    </div>
  `)
  wrap.classList.add('now-playing-backdrop')
  const modalEl=wrap.querySelector('.modal')
  modalEl?.classList.add('now-playing-modal')

  wrap.querySelector('#nowPrevious').onclick=async()=>{await previousMediaTrack(true);wrap.remove();openNowPlayingSheet()}
  wrap.querySelector('#nowPlay').onclick=async()=>{await toggleMediaPlayback();wrap.querySelector('#nowPlay').textContent=mediaAudio()?.paused?'▶':'Ⅱ'}
  wrap.querySelector('#nowNext').onclick=async()=>{await nextMediaTrack(true);wrap.remove();openNowPlayingSheet()}
  wrap.querySelector('#nowMute').onclick=async()=>{await toggleMediaMute();wrap.querySelector('#nowMute').textContent=mediaAudio()?.muted?'Unmute':'Mute'}
  wrap.querySelector('#nowStop').onclick=()=>{stopMediaPlayback();wrap.querySelector('#nowPlay').textContent='▶'}
  wrap.querySelector('#nowLibrary').onclick=()=>{wrap.remove();openSoundscapePicker()}

  const volume=wrap.querySelector('#nowVolume')
  const volumeLabel=volume?.parentElement?.querySelector('b')
  if(volume){
    volume.oninput=event=>{
      const value=Number(event.target.value)
      ambientPreferences.volume=value
      const a=mediaAudio()
      if(a) a.volume=value
      if(volumeLabel) volumeLabel.textContent=`${Math.round(value*100)}%`
    }
    volume.onchange=event=>saveExperiencePreferences({volume:Number(event.target.value)})
  }

  const progress=wrap.querySelector('#nowPlayingProgress')
  if(progress){
    progress.oninput=event=>{
      const a=mediaAudio()
      if(a&&!progress.disabled&&Number.isFinite(a.duration)) a.currentTime=Number(event.target.value)
    }
  }
  syncNowPlayingProgress()
}

function setPlayerStatus(message){
  const el=document.getElementById('playerStatus')
  if(el) el.textContent=message
}

function updateAudioVisualScene(item,playing){
  const text=(String(item?.title||'')+' '+String(item?.category||'')).toLowerCase()
  let scene='ambient'
  if(item?.devotional) scene='devotional'
  else if(item?.type==='music') scene='music'
  else if(item?.type==='radio') scene='radio'
  else if(/rain|storm|thunder/.test(text)) scene='rain'
  else if(/ocean|wave|sea|beach/.test(text)) scene='ocean'
  else if(/forest|bird|rainforest|wood/.test(text)) scene='forest'
  else if(/night|cricket|owl/.test(text)) scene='night'
  else if(/river|waterfall|stream|water/.test(text)) scene='water'
  else if(/wind/.test(text)) scene='wind'
  document.documentElement.dataset.audioScene=scene
  document.documentElement.dataset.audioPlaying=playing?'true':'false'
  if(playing){
    const query=scene==='radio'?'city night':scene==='devotional'?'sacred peaceful architecture':scene==='ambient'?'abstract calm landscape':scene
    loadSceneBackdrop(query)
  }
}

function refreshMediaPlayerUI(){
  const player=document.getElementById('memoraMediaPlayer')
  const audio=mediaAudio()
  if(!player||!audio) return

  const current=mediaPlayerState.current||defaultNaturalTrack
  const playing=!audio.paused&&!audio.ended
  player.classList.toggle('playing',playing)
  player.dataset.mode=current.devotional?'devotional':(current.type||mediaPlayerState.mode)

  const title=document.getElementById('playerTitle')
  const source=document.getElementById('playerSource')
  const status=document.getElementById('playerStatus')
  const play=document.getElementById('playerPlay')
  const mute=document.getElementById('playerMute')
  const artwork=document.getElementById('playerArtwork')
  const artButton=document.getElementById('playerNowPlaying')

  if(title) title.textContent=current.title||'Memora Audio'
  if(source){
    if(current.type==='music'){
      source.textContent=['Open Music',current.artist,current.genre].filter(Boolean).join(' · ')
    }else if(current.type==='radio'){
      source.textContent=current.devotional
        ?[`${current.traditionLabel||'Devotional'} · Live`,current.devotionalLanguage||current.language,current.country||current.countrycode||'Worldwide'].filter(Boolean).join(' · ')
        :`Live Radio · ${current.country||current.countrycode||'Worldwide'}`
    }else{
      source.textContent=`Nature · ${current.category||'Open recording'}`
    }
  }
  if(status){
    if(playing) status.textContent=current.type==='radio'?'LIVE':current.type==='music'?'Playing':'Playing'
    else if(!ambientPreferences.enabled||audio.muted) status.textContent='Muted'
    else status.textContent='Paused'
  }
  if(play) play.textContent=playing?'Ⅱ':'▶'
  if(mute) mute.textContent=audio.muted?'Unmute':'Mute'

  const artworkUrl=nowPlayingArtwork(current)
  if(artwork){
    if(artworkUrl){
      artwork.src=artworkUrl
      artwork.classList.remove('hidden')
      artButton?.classList.add('has-image')
    }else{
      artwork.removeAttribute('src')
      artwork.classList.add('hidden')
      artButton?.classList.remove('has-image')
    }
  }

  updateAudioVisualScene(current,playing)
  updateSoundButton()
  syncNowPlayingProgress()
}

async function loadRadioCountries(){
  if(mediaPlayerState.countries.length) return mediaPlayerState.countries
  const data=await fetchApi('/api/audio-library?mode=countries',{cache:'no-store'})
  mediaPlayerState.countries=Array.isArray(data.countries)?data.countries:[]
  return mediaPlayerState.countries
}

async function loadRadioLanguages(){
  if(mediaPlayerState.languages.length) return mediaPlayerState.languages
  const data=await fetchApi('/api/audio-library?mode=languages',{cache:'no-store'})
  mediaPlayerState.languages=Array.isArray(data.languages)?data.languages:[]
  return mediaPlayerState.languages
}

async function loadMediaLibrary(mode='nature',query='',limit=100,{preserveCurrent=false,append=false,random=null,countrycode=null,sort=null,tradition=null,language=null,genre=null}={}){
  const requestId=++mediaLibraryRequest
  mediaPlayerState.loading=true
  const safeMode=['radio','devotional','music'].includes(mode)?mode:'nature'
  const safeQuery=String(query||'').trim()

  if(safeMode==='music'){
    try{
      const requestedSort=['relevant','popular','recent'].includes(sort)?sort:(mediaPlayerState.musicSort||'relevant')
      const requestedGenre=genre===null?mediaPlayerState.musicGenre:String(genre||'').trim()
      const sameSelection=mediaPlayerState.mode==='music'
        &&mediaPlayerState.musicQuery===safeQuery
        &&mediaPlayerState.musicSort===requestedSort
        &&mediaPlayerState.musicGenre===requestedGenre
      const shouldAppend=append&&sameSelection
      const offset=shouldAppend?mediaPlayerState.musicOffset:0
      const params=new URLSearchParams({
        mode:safeQuery?'search':'trending',
        q:safeQuery,
        limit:String(Math.min(50,limit)),
        offset:String(offset),
        sort:requestedSort
      })
      if(requestedGenre) params.set('genre',requestedGenre)
      params.set('nonce',String(Date.now()))

      const data=await fetchApi(`/api/open-music?${params.toString()}`,{cache:'no-store'})
      if(requestId!==mediaLibraryRequest) return mediaPlayerState.library

      const incoming=Array.isArray(data.items)?data.items:[]
      mediaPlayerState.mode='music'
      mediaPlayerState.audioView='music'
      mediaPlayerState.query=safeQuery
      mediaPlayerState.musicQuery=safeQuery
      mediaPlayerState.musicSort=requestedSort
      mediaPlayerState.musicGenre=requestedGenre
      mediaPlayerState.musicOffset=Number(data.nextOffset||offset+incoming.length)
      mediaPlayerState.musicHasMore=data.hasMore!==false

      if(shouldAppend){
        const existing=new Set(mediaPlayerState.library.map(item=>item.id))
        mediaPlayerState.library=[...mediaPlayerState.library,...incoming.filter(item=>!existing.has(item.id))]
      }else{
        mediaPlayerState.library=incoming
        mediaPlayerState.index=0
      }

      localStore.setItem('memora-player-mode','music')
      localStore.setItem('memora-audio-view','music')
      localStore.setItem('memora-player-query',safeQuery)
      localStore.setItem('memora-music-query',safeQuery)
      localStore.setItem('memora-music-sort',requestedSort)
      localStore.setItem('memora-music-genre',requestedGenre)

      if(!preserveCurrent&&mediaPlayerState.library.length){
        mediaPlayerState.index=0
        await selectMediaTrack(mediaPlayerState.library[0],false)
      }else if(preserveCurrent&&mediaPlayerState.current?.type==='music'){
        const found=mediaPlayerState.library.findIndex(item=>item.id===mediaPlayerState.current.id)
        if(found>=0) mediaPlayerState.index=found
      }
      return mediaPlayerState.library
    }finally{
      if(requestId===mediaLibraryRequest) mediaPlayerState.loading=false
    }
  }
  const requestedCountry=countrycode===null?mediaPlayerState.radioCountry:String(countrycode||'').toUpperCase()
  const requestedSort=sort||mediaPlayerState.radioSort||'popular'
  const useRandom=random===null?requestedSort==='random':Boolean(random)
  const requestedTradition=tradition||mediaPlayerState.devotionalTradition||'all_faiths'
  const requestedLanguage=language===null
    ?(safeMode==='devotional'?mediaPlayerState.devotionalLanguage:mediaPlayerState.radioLanguage)
    :String(language||'').trim()

  const sameRadioSelection=
    ['radio','devotional'].includes(mediaPlayerState.mode)
    &&mediaPlayerState.mode===safeMode
    &&mediaPlayerState.query===safeQuery
    &&mediaPlayerState.radioCountry===requestedCountry
    &&mediaPlayerState.radioSort===requestedSort
    &&(safeMode==='devotional'
      ?mediaPlayerState.devotionalTradition===requestedTradition&&mediaPlayerState.devotionalLanguage===requestedLanguage
      :mediaPlayerState.radioLanguage===requestedLanguage)

  const shouldAppend=append&&['radio','devotional'].includes(safeMode)&&sameRadioSelection

  try{
    const params=new URLSearchParams({
      mode:safeMode,
      q:safeQuery,
      limit:String(Math.min(100,limit))
    })

    if(['radio','devotional'].includes(safeMode)){
      const offset=shouldAppend&&requestedSort!=='random'?mediaPlayerState.radioOffset:0
      params.set('countrycode',requestedCountry)
      params.set('sort',requestedSort)
      params.set('random',useRandom?'1':'0')
      params.set('offset',String(offset))
      params.set('nonce',String(Date.now()))
      if(requestedLanguage) params.set('language',requestedLanguage)
      if(safeMode==='devotional'){
        params.set('tradition',requestedTradition)
        if(requestedLanguage) params.set('language',requestedLanguage)
      }else if(requestedLanguage){
        params.set('language',requestedLanguage)
      }
    }

    const data=await fetchApi(`/api/audio-library?${params.toString()}`,{cache:'no-store'})
    if(requestId!==mediaLibraryRequest) return mediaPlayerState.library

    mediaPlayerState.mode=safeMode
    mediaPlayerState.query=safeQuery
    const incoming=Array.isArray(data.items)?data.items:[]

    if(['radio','devotional'].includes(safeMode)){
      mediaPlayerState.radioCountry=requestedCountry
      mediaPlayerState.radioSort=requestedSort
      localStore.setItem('memora-radio-country',requestedCountry)
      localStore.setItem('memora-radio-sort',requestedSort)

      if(safeMode==='radio'){
        mediaPlayerState.radioLanguage=requestedLanguage
        localStore.setItem('memora-radio-language',requestedLanguage)
      }

      if(safeMode==='devotional'){
        mediaPlayerState.devotionalTradition=requestedTradition
        mediaPlayerState.devotionalLanguage=requestedLanguage
        mediaPlayerState.devotionalQuery=safeQuery
        localStore.setItem('memora-devotional-tradition',requestedTradition)
        localStore.setItem('memora-devotional-language',requestedLanguage)
        localStore.setItem('memora-devotional-query',safeQuery)
      }
    }

    if(shouldAppend){
      const existingIds=new Set(mediaPlayerState.library.map(item=>item.id))
      const fresh=incoming.filter(item=>!existingIds.has(item.id))
      mediaPlayerState.library=[...mediaPlayerState.library,...fresh]
      if(fresh.length) mediaPlayerState.radioBatches+=1
    }else{
      mediaPlayerState.library=incoming
      mediaPlayerState.index=0
      mediaPlayerState.radioBatches=['radio','devotional'].includes(safeMode)&&incoming.length?1:0
    }

    if(['radio','devotional'].includes(safeMode)){
      mediaPlayerState.radioOffset=Number(data.nextOffset||mediaPlayerState.library.length||0)
      mediaPlayerState.radioHasMore=data.hasMore!==false
    }else{
      mediaPlayerState.radioOffset=0
      mediaPlayerState.radioHasMore=true
    }

    localStore.setItem('memora-player-mode',safeMode)
    localStore.setItem('memora-player-query',mediaPlayerState.query)

    if(!preserveCurrent&&mediaPlayerState.library.length){
      mediaPlayerState.index=0
      await selectMediaTrack(mediaPlayerState.library[0],false)
    }else if(preserveCurrent&&mediaPlayerState.current){
      const found=mediaPlayerState.library.findIndex(item=>item.id===mediaPlayerState.current.id)
      if(found>=0){
        mediaPlayerState.index=found
        const refreshed=mediaPlayerState.library[found]
        const audio=mediaAudio()
        const wasPlaying=audio&&!audio.paused
        mediaPlayerState.current=refreshed
        if(audio&&!wasPlaying&&audio.src!==refreshed.url){
          audio.src=refreshed.url
          audio.load()
        }
        refreshMediaPlayerUI()
      }
    }
    return mediaPlayerState.library
  }finally{
    if(requestId===mediaLibraryRequest) mediaPlayerState.loading=false
  }
}

async function selectMediaTrack(item,autoplay=true,recovering=false){
  clearTimeout(mediaRecoveryTimer)
  if(!recovering) mediaRecoveryAttempts=0
  if(!item?.url) return
  ensureMediaPlayer()
  const audio=mediaAudio()
  if(!audio) return

  stopAmbient()
  mediaPlayerState.current=item
  const found=mediaPlayerState.library.findIndex(entry=>entry.id===item.id)
  if(found>=0) mediaPlayerState.index=found
  mediaPlayerState.mode=item.devotional?'devotional':(item.type==='radio'?'radio':item.type==='music'?'music':'nature')
  mediaPlayerState.audioView=mediaPlayerState.mode
  localStore.setItem('memora-audio-view',mediaPlayerState.audioView)
  localStore.setItem('memora-player-mode',mediaPlayerState.mode)
  localStore.setItem('memora-player-query',mediaPlayerState.query||'')

  audio.pause()
  audio.src=item.url
  audio.loop=item.type==='nature'
  audio.volume=Math.max(0,Math.min(1,ambientPreferences.volume))
  audio.muted=!ambientPreferences.enabled
  audio.load()
  refreshMediaPlayerUI()

  if(autoplay&&ambientPreferences.enabled){
    try{
      await audio.play()
    }catch{
      setPlayerStatus('Tap Play to start audio')
    }
  }
}

async function toggleMediaPlayback(){
  ensureMediaPlayer()
  const audio=mediaAudio()
  if(!audio) return

  if(!ambientPreferences.enabled){
    await saveExperiencePreferences({enabled:true})
    audio.muted=false
  }
  if(audio.paused){
    mediaRecoveryAttempts=0
    if(audio.error) audio.load()
    try{
      await audio.play()
    }catch{
      setPlayerStatus('Tap Play again to allow audio in this browser')
    }
  }else{
    audio.pause()
  }
  refreshMediaPlayerUI()
}

async function toggleMediaMute(){
  ensureMediaPlayer()
  const audio=mediaAudio()
  if(!audio) return
  audio.muted=!audio.muted
  await saveExperiencePreferences({enabled:!audio.muted})
  refreshMediaPlayerUI()
}

function stopMediaPlayback(){
  const audio=mediaAudio()
  if(!audio) return
  audio.pause()
  try{audio.currentTime=0}catch{}
  setPlayerStatus('Stopped')
  refreshMediaPlayerUI()
}

async function nextMediaTrack(autoplay=true,recovering=false){
  ensureMediaPlayer()

  if(!mediaPlayerState.library.length){
    try{
      if(mediaPlayerState.mode==='music'){
        await loadMediaLibrary('music',mediaPlayerState.musicQuery,50,{
          preserveCurrent:true,
          sort:mediaPlayerState.musicSort,
          genre:mediaPlayerState.musicGenre
        })
      }else{
        await loadMediaLibrary(mediaPlayerState.mode,mediaPlayerState.query,100,{
          preserveCurrent:true,
          random:['radio','devotional'].includes(mediaPlayerState.mode)&&mediaPlayerState.radioSort==='random',
          countrycode:mediaPlayerState.radioCountry,
          sort:mediaPlayerState.radioSort,
          tradition:mediaPlayerState.devotionalTradition,
          language:mediaPlayerState.mode==='devotional'?mediaPlayerState.devotionalLanguage:mediaPlayerState.radioLanguage
        })
      }
    }catch{
      if(mediaPlayerState.mode==='nature') mediaPlayerState.library=[defaultNaturalTrack]
    }
  }
  if(!mediaPlayerState.library.length) return

  if(mediaPlayerState.mode==='music'){
    const nearEnd=mediaPlayerState.index>=Math.max(0,mediaPlayerState.library.length-4)
    if(nearEnd&&mediaPlayerState.musicHasMore&&!mediaPlayerState.loading){
      try{
        await loadMediaLibrary('music',mediaPlayerState.musicQuery,50,{
          preserveCurrent:true,
          append:true,
          sort:mediaPlayerState.musicSort,
          genre:mediaPlayerState.musicGenre
        })
      }catch{}
    }
  }

  if(['radio','devotional'].includes(mediaPlayerState.mode)){
    const nearEnd=mediaPlayerState.index>=Math.max(0,mediaPlayerState.library.length-4)
    if(nearEnd&&!mediaPlayerState.loading){
      const before=mediaPlayerState.library.length
      try{
        await loadMediaLibrary(mediaPlayerState.mode,mediaPlayerState.query,100,{
          preserveCurrent:true,
          append:true,
          random:mediaPlayerState.radioSort==='random',
          countrycode:mediaPlayerState.radioCountry,
          sort:mediaPlayerState.radioSort,
          tradition:mediaPlayerState.devotionalTradition,
          language:mediaPlayerState.mode==='devotional'?mediaPlayerState.devotionalLanguage:mediaPlayerState.radioLanguage
        })
      }catch{}
      if(mediaPlayerState.library.length===before&&mediaPlayerState.library.length>1){
        let randomIndex=Math.floor(Math.random()*mediaPlayerState.library.length)
        if(randomIndex===mediaPlayerState.index) randomIndex=(randomIndex+1)%mediaPlayerState.library.length
        mediaPlayerState.index=randomIndex
        await selectMediaTrack(mediaPlayerState.library[randomIndex],autoplay,recovering)
        return
      }
    }
  }

  mediaPlayerState.index=(mediaPlayerState.index+1)%mediaPlayerState.library.length
  await selectMediaTrack(mediaPlayerState.library[mediaPlayerState.index],autoplay,recovering)
}

function updateSoundButton(){
  const button=document.getElementById('soundButton')
  const audio=mediaAudio()
  const active=ambientPreferences.enabled&&audio&&!audio.muted
  if(button){
    button.dataset.enabled=active?'true':'false'
    button.title=active?'Open Memora Audio':'Audio is muted'
    const label=button.querySelector('.sound-label')
    if(label) label.textContent=active?'Audio':'Muted'
  }
}

async function setAmbientEnabled(enabled){
  await saveExperiencePreferences({enabled})
  ensureMediaPlayer()
  const audio=mediaAudio()
  if(audio) audio.muted=!enabled
  if(!enabled) stopAmbient()
  if(enabled&&audio?.paused){
    try{await audio.play()}catch{}
  }
  refreshMediaPlayerUI()
}

let musicCollectionRequest=0
async function loadMusicCollections(query='',{append=false}={}){
  const requestId=++musicCollectionRequest
  const safeQuery=String(query||'').trim()
  const sameQuery=mediaPlayerState.musicQuery===safeQuery
  const offset=append&&sameQuery?mediaPlayerState.musicCollectionOffset:0
  const params=new URLSearchParams({
    mode:'collections',
    q:safeQuery,
    limit:'30',
    offset:String(offset),
    nonce:String(Date.now())
  })
  const data=await fetchApi(`/api/open-music?${params.toString()}`,{cache:'no-store'})
  if(requestId!==musicCollectionRequest)return mediaPlayerState.musicCollections
  const incoming=Array.isArray(data.items)?data.items:[]
  if(append&&sameQuery){
    const seen=new Set(mediaPlayerState.musicCollections.map(item=>item.id))
    mediaPlayerState.musicCollections=[...mediaPlayerState.musicCollections,...incoming.filter(item=>!seen.has(item.id))]
  }else{
    mediaPlayerState.musicCollections=incoming
  }
  mediaPlayerState.musicQuery=safeQuery
  mediaPlayerState.musicCollectionOffset=Number(data.nextOffset||mediaPlayerState.musicCollections.length)
  mediaPlayerState.musicCollectionHasMore=data.hasMore!==false
  mediaPlayerState.activeCollection=null
  return mediaPlayerState.musicCollections
}

function musicCollectionCard(item,index){
  const artwork=item.artwork
    ?`<span class="collection-art"><img src="${esc(item.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('fallback');this.remove()"></span>`
    :'<span class="collection-art fallback"></span>'
  return `
    <button class="music-collection-card" data-collection-index="${index}">
      ${artwork}
      <span class="collection-copy">
        <small>${esc(item.kind==='album'?'Album':'Playlist')}</small>
        <b>${esc(item.title||'Untitled collection')}</b>
        <span>${esc(item.artist||'Audius creator')}${item.trackCount?` · ${item.trackCount} tracks`:''}</span>
      </span>
      <span class="collection-arrow">›</span>
    </button>
  `
}

function renderMusicCollections(box){
  const target=box.querySelector('#audioLibraryResults')
  const count=box.querySelector('#audioLibraryCount')
  const note=box.querySelector('#audioSourceNote')
  if(!target) return
  if(count) count.textContent=`${mediaPlayerState.musicCollections.length} albums and playlists loaded`
  target.innerHTML=mediaPlayerState.musicCollections.length
    ?`<div class="music-collection-grid">${mediaPlayerState.musicCollections.map(musicCollectionCard).join('')}</div>`
    :'<div class="empty compact-empty"><strong>No collections found</strong>Try another artist, album or playlist search.</div>'
  if(note) note.innerHTML='Albums and playlists are discovered from the open <a href="https://audius.co" target="_blank" rel="noopener">Audius</a> catalog.'
  target.querySelectorAll('[data-collection-index]').forEach(button=>button.onclick=async()=>{
    const item=mediaPlayerState.musicCollections[Number(button.dataset.collectionIndex)]
    if(!item) return
    try{await openMusicCollection(item,box)}catch(error){target.innerHTML=`<p role="alert">${esc(error.message)}</p><button class="btn" id="retryCollections">Back to albums & playlists</button>`;target.querySelector('#retryCollections').onclick=()=>renderMusicCollections(box)}
  })
}

async function openMusicCollection(collection,box){
  const target=box.querySelector('#audioLibraryResults')
  const count=box.querySelector('#audioLibraryCount')
  if(!target) return
  target.innerHTML='<div class="audio-loading"><span></span><span></span><span></span>Opening collection...</div>'
  const data=await fetchApi(`/api/open-music?mode=collection_tracks&id=${encodeURIComponent(collection.collectionId)}&limit=100`,{cache:'no-store'})
  if(!box.isConnected)return
  mediaPlayerState.activeCollection=collection
  mediaPlayerState.library=Array.isArray(data.items)?data.items:[]
  mediaPlayerState.mode='music'
  mediaPlayerState.audioView='music'
  if(count) count.textContent=`${mediaPlayerState.library.length} tracks · ${collection.title}`
  target.innerHTML=`
    <div class="collection-open-head">
      <button class="btn compact" id="collectionBack">‹ Albums & playlists</button>
      <div><small>${esc(collection.kind==='album'?'Album':'Playlist')} · ${esc(collection.artist||'Audius')}</small><strong>${esc(collection.title)}</strong></div>
      ${collection.sourcePage?`<a class="btn compact" href="${esc(collection.sourcePage)}" target="_blank" rel="noopener">Audius</a>`:''}
    </div>
    ${mediaPlayerState.library.length?mediaPlayerState.library.map(audioLibraryCard).join(''):'<div class="empty compact-empty"><strong>No playable tracks</strong>This collection does not currently expose playable tracks.</div>'}
  `
  target.querySelector('#collectionBack').onclick=()=>renderMusicCollections(box)
  target.querySelectorAll('[data-audio-index]').forEach(button=>button.onclick=async()=>{
    const item=mediaPlayerState.library[Number(button.dataset.audioIndex)]
    await selectMediaTrack(item,true)
    target.querySelectorAll('[data-audio-index]').forEach(row=>{row.classList.toggle('selected',row===button);row.querySelector('.audio-card-play').textContent=row===button&&!mediaAudio()?.paused?'Playing':'Play'})
  })
}

function audioLibraryCard(item,index){
  const meta=item.type==='radio'
    ?[item.devotional?item.traditionLabel:null,item.devotionalLanguage||item.language,item.country,item.codec,item.bitrate?item.bitrate+' kbps':''].filter(Boolean).join(' · ')
    :item.type==='music'
      ?[item.artist,item.genre,item.provider==='commons'?'Wikimedia Commons':'Audius',item.license].filter(Boolean).join(' · ')
      :[item.artist,item.category,item.license].filter(Boolean).join(' · ')
  const artUrl=item.artwork||item.favicon||''
  const artwork=artUrl
    ?`<span class="audio-card-art"><img src="${esc(artUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('fallback');this.remove()"></span>`
    :'<span class="audio-card-art fallback"></span>'
  return `
    <button class="audio-library-card ${mediaPlayerState.current?.id===item.id?'selected':''}" data-audio-index="${index}">
      ${artwork}
      <span class="audio-card-copy"><b>${esc(item.title||'Untitled audio')}</b><small>${esc(meta||'Audio')}</small></span>
      <span class="audio-card-play">${mediaPlayerState.current?.id===item.id&&!mediaAudio()?.paused?'Playing':'Play'}</span>
    </button>
  `
}

function renderAudioLibraryResults(box){
  const target=box.querySelector('#audioLibraryResults')
  const count=box.querySelector('#audioLibraryCount')
  if(!target) return

  if(count){
    count.textContent=mediaPlayerState.mode==='music'
      ?`${mediaPlayerState.library.length} open tracks loaded`
      :mediaPlayerState.mode==='devotional'
        ?`${mediaPlayerState.library.length} devotional stations loaded`
        :mediaPlayerState.mode==='radio'
          ?`${mediaPlayerState.library.length} live stations loaded`
          :`${mediaPlayerState.library.length} nature recordings found`
  }

  target.innerHTML=mediaPlayerState.library.length
    ?mediaPlayerState.library.map(audioLibraryCard).join('')
    :'<div class="empty compact-empty"><strong>No audio found</strong>Try another search, language, tradition, country or genre.</div>'

  target.querySelectorAll('[data-audio-index]').forEach(button=>button.onclick=async()=>{
    const item=mediaPlayerState.library[Number(button.dataset.audioIndex)]
    await selectMediaTrack(item,true)
    renderAudioLibraryResults(box)
  })

  const note=box.querySelector('#audioSourceNote')
  if(note){
    const current=mediaPlayerState.current
    if(current?.type==='music'){
      const providerName=current.provider==='commons'?'Wikimedia Commons':'Audius'
      const providerHome=current.provider==='commons'?'https://commons.wikimedia.org':'https://audius.co'
      note.innerHTML=`Open Music track from <a href="${esc(current.sourcePage||providerHome)}" target="_blank" rel="noopener">${providerName}</a>${current.artist?` · ${esc(current.artist)}`:''}${current.license?` · ${esc(current.license)}`:''}. Memora streams from the source and does not copy Spotify, Apple Music or Amazon Music catalogs.`
    }else if(current?.type==='nature'&&current.sourcePage){
      note.innerHTML=`Now playing from <a href="${esc(current.sourcePage)}" target="_blank" rel="noopener">Wikimedia Commons</a>${current.artist?` · ${esc(current.artist)}`:''}${current.license?` · ${esc(current.license)}`:''}`
    }else if(current?.devotional){
      note.innerHTML=`Live ${esc(current.traditionLabel||'devotional')} station stream${current.country?` from ${esc(current.country)}`:''}. The broadcaster supplies the stream and Radio Browser supplies discovery${current.homepage?` · <a href="${esc(current.homepage)}" target="_blank" rel="noopener">station website</a>`:''}`
    }else if(current?.type==='radio'){
      note.innerHTML=`Real live internet-radio stream. The station supplies the audio and Radio Browser supplies discovery${current.homepage?` · <a href="${esc(current.homepage)}" target="_blank" rel="noopener">station website</a>`:''}`
    }else{
      note.textContent=''
    }
  }
}

async function openSoundscapePicker(){
  ensureMediaPlayer()

  const currentMode=['music','radio','devotional','nature'].includes(mediaPlayerState.audioView)
    ?mediaPlayerState.audioView
    :(['music','radio','devotional','nature'].includes(mediaPlayerState.mode)?mediaPlayerState.mode:'music')

  let countries=[]
  let languages=[]
  // Directory metadata must not block opening the audio controls.
  const directoryPromise=Promise.allSettled([loadRadioCountries(),loadRadioLanguages()])

  const preferredLanguages=[
    'English','Tamil','Malayalam','Hindi','Telugu','Kannada','Marathi','Bengali','Punjabi','Gujarati',
    'Urdu','Arabic','Spanish','Portuguese','French','German','Italian','Latin','Greek','Russian',
    'Hebrew','Persian','Turkish','Indonesian','Malay','Sinhala','Nepali','Japanese','Korean','Chinese'
  ]
  const languageRows=[...languages].sort((a,b)=>{
    const ai=preferredLanguages.findIndex(x=>x.toLowerCase()===String(a.name||'').toLowerCase())
    const bi=preferredLanguages.findIndex(x=>x.toLowerCase()===String(b.name||'').toLowerCase())
    if(ai>=0||bi>=0){
      if(ai<0) return 1
      if(bi<0) return -1
      return ai-bi
    }
    return Number(b.stationcount||0)-Number(a.stationcount||0)
  })

  const countryOptions=[
    '<option value="">Worldwide</option>',
    ...(mediaPlayerState.radioCountry?[`<option value="${esc(mediaPlayerState.radioCountry)}" selected>${esc(mediaPlayerState.radioCountry)}</option>`]:[]),
    ...countries.map(country=>`<option value="${esc(country.code)}" ${mediaPlayerState.radioCountry===country.code?'selected':''}>${esc(country.name)} · ${Number(country.stationcount||0).toLocaleString()} stations</option>`)
  ].join('')

  const selectedLanguage=currentMode==='devotional'?mediaPlayerState.devotionalLanguage:mediaPlayerState.radioLanguage
  const languageOptions=[
    '<option value="">All languages</option>',
    ...(selectedLanguage?[`<option value="${esc(selectedLanguage)}" selected>${esc(selectedLanguage)}</option>`]:[]),
    ...languageRows.map(language=>`<option value="${esc(language.name)}" ${selectedLanguage.toLowerCase()===String(language.name||'').toLowerCase()?'selected':''}>${esc(language.name)} · ${Number(language.stationcount||0).toLocaleString()}</option>`)
  ].join('')

  const devotionalGroups=[
    {
      title:'Christian',
      items:[
        ['christian','','Christian music'],
        ['christian','worship','Worship and praise'],
        ['christian','gospel','Gospel'],
        ['christian','hymn','Hymns'],
        ['christian_prayer','','Prayer and Scripture'],
        ['catholic','','Catholic'],
        ['orthodox','','Orthodox'],
        ['gregorian','','Gregorian chant'],
        ['protestant','','Protestant'],
        ['pentecostal','','Pentecostal'],
        ['adventist','','Adventist']
      ]
    },
    {
      title:'Islamic, Sufi and Ghazal',
      items:[
        ['islamic','','Islamic'],
        ['islamic','quran','Quran'],
        ['islamic','nasheed','Nasheed'],
        ['sufi','','Sufi'],
        ['sufi','qawwali','Qawwali'],
        ['ghazal','','Ghazal'],
        ['ghazal','urdu ghazal','Urdu Ghazal'],
        ['ghazal','hindi ghazal','Hindi Ghazal']
      ]
    },
    {
      title:'Hindu and Sikh',
      items:[
        ['hindu','','Hindu devotional'],
        ['hindu','bhajan','Bhajan'],
        ['hindu','kirtan','Kirtan'],
        ['hindu','mantra','Mantra'],
        ['carnatic_devotional','','Carnatic devotional'],
        ['sikh','','Sikh and Gurbani'],
        ['sikh','shabad','Shabad Kirtan']
      ]
    },
    {
      title:'Other traditions',
      items:[
        ['buddhist','','Buddhist'],
        ['buddhist','tibetan buddhist','Tibetan Buddhist'],
        ['jewish','','Jewish'],
        ['jain','','Jain'],
        ['bahai','','Baha\'i'],
        ['zoroastrian','','Zoroastrian'],
        ['taoist','','Taoist / Daoist'],
        ['shinto','','Shinto'],
        ['spiritual','','Interfaith and spiritual'],
        ['spiritual','meditation','Meditation']
      ]
    }
  ]

  const devotionalDirectory=devotionalGroups.map(group=>`
    <section class="devotional-group">
      <h4>${esc(group.title)}</h4>
      <div class="devotional-grid">
        ${group.items.map(([tradition,query,label])=>`
          <button class="devotional-chip" data-devotional="${esc(tradition)}" data-devotional-query="${esc(query)}">${esc(label)}</button>
        `).join('')}
      </div>
    </section>
  `).join('')

  const box=modal('Memora Audio',`
    <div class="audio-hub">
      <div class="audio-library-head compact-head">
        <div>
          <div class="eyebrow">Music · Radio · Devotional · Nature</div>
          <h3>Your world of sound.</h3>
          <p class="muted">A compact audio hub for open music tracks, real live radio, worldwide devotional discovery and open nature recordings.</p>
        </div>
        <button class="btn ${ambientPreferences.enabled?'primary':''}" id="libraryMute">${ambientPreferences.enabled?'Mute':'Enable audio'}</button>
      </div>

      <div class="audio-mode-tabs four" role="tablist" aria-label="Audio type">
        <button class="audio-mode-tab ${currentMode==='music'?'active':''}" data-audio-mode="music">Open Music</button>
        <button class="audio-mode-tab ${currentMode==='radio'?'active':''}" data-audio-mode="radio">World Radio</button>
        <button class="audio-mode-tab ${currentMode==='devotional'?'active':''}" data-audio-mode="devotional">Devotional</button>
        <button class="audio-mode-tab ${currentMode==='nature'?'active':''}" data-audio-mode="nature">Nature</button>
      </div>

      <div class="audio-for-you">
        <div><span class="eyebrow">For you</span><strong>${latestMood&&moodCatalog[latestMood.mood]?`Your ${esc(moodCatalog[latestMood.mood].label.toLowerCase())} check-in can guide the next sound.`:'Personalized without clutter.'}</strong><small>Use your mood, recent memories, or discover a random live station from anywhere in the world.</small></div>
        <div class="audio-for-you-actions">
          ${latestMood&&moodCatalog[latestMood.mood]?'<button class="btn primary compact" id="audioMoodForYou">For my mood</button>':''}
          <button class="btn compact" id="audioMemoryMix">Memory Mix</button>
          <button class="btn compact" id="audioWorldSurprise">Surprise me</button>
        </div>
      </div>

      <section class="audio-mode-panel ${currentMode==='music'?'active':''}" data-audio-panel="music">
        <button class="btn primary" id="worldSongFinder">Find artists, movie songs, albums & playlists</button>
        <div class="audio-section-intro">
          <div><span class="eyebrow">Open catalog</span><strong>Tracks, albums and playlists.</strong><small>Stream full tracks and browse open Audius albums/playlists, with Wikimedia Commons as an open-recording source.</small></div>
          <span class="source-pill">Audius + Commons</span>
        </div>
        <div class="music-kind-switch" role="group" aria-label="Music browsing">
          <button class="music-kind-btn ${mediaPlayerState.musicBrowseKind==='tracks'?'active':''}" data-music-kind="tracks">Tracks</button>
          <button class="music-kind-btn ${mediaPlayerState.musicBrowseKind==='collections'?'active':''}" data-music-kind="collections">Albums & playlists</button>
        </div>
        <div class="audio-search-row">
          <input class="input" id="musicSearch" value="${esc(mediaPlayerState.musicQuery)}" placeholder="Search song, artist, genre, language or devotional style">
          <button class="btn primary" id="musicSearchButton">Search</button>
        </div>
        <div class="radio-sort-switch three music-sort" role="group" aria-label="Open music sorting">
          <button class="radio-sort-btn ${mediaPlayerState.musicSort==='relevant'?'active':''}" data-music-sort="relevant">Relevant</button>
          <button class="radio-sort-btn ${mediaPlayerState.musicSort==='popular'?'active':''}" data-music-sort="popular">Popular</button>
          <button class="radio-sort-btn ${mediaPlayerState.musicSort==='recent'?'active':''}" data-music-sort="recent">Recent</button>
        </div>
        <div class="audio-presets music-presets">
          ${['Trending','Pop','Rock','Electronic','Hip-Hop','R&B','Jazz','Classical','Ambient','Afrobeats','Latin','Arabic','Indian','Tamil','Malayalam','Hindi','Telugu','Kannada','Punjabi','Bengali','Korean','Japanese','Gospel','Christian','Worship','Qawwali','Bhajan','Ghazal','Nasheed','Gurbani'].map(label=>`<button class="chip" data-music-query="${label==='Trending'?'':esc(label)}">${esc(label)}</button>`).join('')}
        </div>
        <details class="audio-disclosure">
          <summary>Browse music by region and language</summary>
          <div class="music-world-grid">
            ${[
              ['South Asia',['Tamil','Malayalam','Hindi','Telugu','Kannada','Punjabi','Bengali','Marathi','Gujarati','Urdu','Sinhala','Nepali']],
              ['Middle East',['Arabic','Persian','Turkish','Hebrew']],
              ['Europe',['English','Spanish','Portuguese','French','German','Italian','Greek','Russian','Ukrainian']],
              ['Africa',['Afrobeats','Swahili','Gospel Africa','Amapiano','Highlife']],
              ['East & Southeast Asia',['Korean','Japanese','Chinese','Indonesian','Malay','Tagalog','Vietnamese']]
            ].map(([group,items])=>`<section><h4>${esc(group)}</h4><div>${items.map(item=>`<button class="chip" data-music-query="${esc(item)}">${esc(item)}</button>`).join('')}</div></section>`).join('')}
          </div>
        </details>
        <div class="open-music-note">Commercial catalogs such as Spotify and Apple Music are not copied into Memora. Their playback requires each provider's own account, licensing and authorization.</div>
      </section>

      <section class="audio-mode-panel ${currentMode==='radio'?'active':''}" data-audio-panel="radio">
        <div class="world-filter-grid">
          <label class="radio-country-field"><span>Country</span><select class="input" id="radioCountry">${countryOptions}</select></label>
          <label class="radio-country-field"><span>Language</span><select class="input" id="radioLanguage">${languageOptions}</select></label>
        </div>
        <div class="radio-sort-switch three" role="group" aria-label="Radio sorting">
          <button class="radio-sort-btn ${mediaPlayerState.radioSort==='popular'?'active':''}" data-radio-sort="popular">Popular / major</button>
          <button class="radio-sort-btn ${mediaPlayerState.radioSort==='quality'?'active':''}" data-radio-sort="quality">Best quality</button>
          <button class="radio-sort-btn ${mediaPlayerState.radioSort==='random'?'active':''}" data-radio-sort="random">Random</button>
        </div>
        <div class="radio-country-quick">
          ${[['','Worldwide'],['IN','India'],['US','USA'],['GB','UK'],['CA','Canada'],['AU','Australia'],['BR','Brazil'],['DE','Germany'],['FR','France'],['ZA','South Africa'],['NG','Nigeria'],['PH','Philippines'],['JP','Japan'],['SG','Singapore'],['AE','UAE']].map(([code,label])=>`<button class="chip" data-radio-country-quick="${code}">${label}</button>`).join('')}
        </div>
        <div class="audio-search-row">
          <input class="input" id="radioSearch" value="${esc(mediaPlayerState.mode==='radio'?mediaPlayerState.query:'')}" placeholder="Station, FM, genre, language or city">
          <button class="btn primary" id="radioSearchButton">Find stations</button>
        </div>
      </section>

      <section class="audio-mode-panel ${currentMode==='devotional'?'active':''}" data-audio-panel="devotional">
        <div class="devotional-feature-row compact-features">
          <button class="devotional-feature ${mediaPlayerState.devotionalTradition==='all_faiths'?'selected':''}" data-devotional="all_faiths" data-devotional-query=""><span>✦</span><div><b>All traditions</b><small>Worldwide spiritual discovery</small></div></button>
          <button class="devotional-feature ${mediaPlayerState.devotionalTradition==='christian'?'selected':''}" data-devotional="christian" data-devotional-query=""><span>♫</span><div><b>Christian</b><small>Worship, Gospel, hymns and more</small></div></button>
          <button class="devotional-feature ${mediaPlayerState.devotionalTradition==='ghazal'?'selected':''}" data-devotional="ghazal" data-devotional-query=""><span>♪</span><div><b>Ghazal</b><small>Ghazal and related stations</small></div></button>
        </div>

        <div class="world-filter-grid">
          <label class="radio-country-field"><span>Country</span><select class="input" id="devotionalCountry">${countryOptions}</select></label>
          <label class="radio-country-field"><span>Language</span><select class="input" id="devotionalLanguage">${languageOptions}</select></label>
        </div>

        <div class="radio-sort-switch three" role="group" aria-label="Devotional sorting">
          <button class="radio-sort-btn ${mediaPlayerState.radioSort==='popular'?'active':''}" data-devotional-sort="popular">Popular</button>
          <button class="radio-sort-btn ${mediaPlayerState.radioSort==='quality'?'active':''}" data-devotional-sort="quality">Best quality</button>
          <button class="radio-sort-btn ${mediaPlayerState.radioSort==='random'?'active':''}" data-devotional-sort="random">Random</button>
        </div>

        <div class="regional-devotional">
          <span>Christian music by language</span>
          <div>
            ${[
              'English','Tamil','Malayalam','Hindi','Telugu','Kannada','Marathi','Bengali','Punjabi','Gujarati',
              'Urdu','Arabic','Spanish','Portuguese','French','German','Italian','Russian','Ukrainian','Polish',
              'Romanian','Dutch','Swedish','Norwegian','Finnish','Czech','Hungarian','Greek','Armenian','Georgian',
              'Korean','Japanese','Chinese','Tagalog','Indonesian','Malay','Thai','Vietnamese','Swahili','Amharic',
              'Hausa','Yoruba','Zulu','Afrikaans','Sinhala','Nepali'
            ].map(language=>`<button class="chip" data-regional-language="${esc(language)}" data-devotional="christian" data-devotional-query="">${esc(language)}</button>`).join('')}
          </div>
        </div>

        <div class="devotional-language-quick">
          <span>Apply language to the selected tradition</span>
          <div>
            ${[
              'All languages','English','Tamil','Malayalam','Hindi','Telugu','Kannada','Punjabi','Urdu','Arabic',
              'Spanish','Portuguese','French','German','Russian','Hebrew','Persian','Turkish','Indonesian','Malay',
              'Swahili','Amharic','Hausa','Yoruba','Zulu','Afrikaans','Sinhala','Nepali','Korean','Japanese',
              'Chinese','Tagalog','Thai','Vietnamese','Polish','Romanian','Dutch','Swedish','Norwegian'
            ].map(language=>`<button class="chip ${(language==='All languages'&&!mediaPlayerState.devotionalLanguage)||mediaPlayerState.devotionalLanguage===language?'active':''}" data-devotional-language-quick="${language==='All languages'?'':esc(language)}">${esc(language)}</button>`).join('')}
          </div>
        </div>

        <details class="audio-disclosure">
          <summary>Browse more traditions and styles</summary>
          <div class="devotional-directory">${devotionalDirectory}</div>
        </details>

        <div class="audio-search-row">
          <input class="input" id="devotionalSearch" value="${esc(mediaPlayerState.devotionalQuery)}" placeholder="Worship, Gospel, qawwali, bhajan, Gurbani, Quran, chant...">
          <button class="btn primary" id="devotionalSearchButton">Search devotionals</button>
        </div>
      </section>

      <section class="audio-mode-panel ${currentMode==='nature'?'active':''}" data-audio-panel="nature">
        <div class="audio-section-intro">
          <div><span class="eyebrow">Open recordings</span><strong>Natural soundscapes.</strong><small>Real recordings streamed on demand from Wikimedia Commons.</small></div>
          <span class="source-pill">Commons</span>
        </div>
        <div class="audio-search-row">
          <input class="input" id="natureSearch" value="${esc(mediaPlayerState.mode==='nature'?mediaPlayerState.query:'rain')}" placeholder="Rain, forest, ocean, night, river...">
          <button class="btn primary" id="natureSearchButton">Search</button>
        </div>
        <div class="audio-presets">
          ${['rain','forest','ocean','night','thunder','river','birds','waterfall','wind','beach'].map(label=>`<button class="chip" data-nature-query="${label}">${label}</button>`).join('')}
        </div>
      </section>

      <div class="audio-library-toolbar">
        <div><b id="audioLibraryCount">Loading...</b><span class="muted small" id="audioLibraryHint"></span></div>
        <button class="btn compact" id="audioDiscoverMore">Load more</button>
      </div>

      <div class="audio-library-results" id="audioLibraryResults"><div class="audio-loading"><span></span><span></span><span></span>Finding audio...</div></div>
      <div class="audio-source-note" id="audioSourceNote"></div>

      <details class="audio-settings-disclosure">
        <summary>Playback and visual settings</summary>
        <div class="audio-library-footer">
          <label class="volume-row"><span>Volume</span><input id="libraryVolume" type="range" min="0" max="1" value="${ambientPreferences.volume}" step="0.01"><b id="libraryVolumeLabel">${Math.round(ambientPreferences.volume*100)}%</b></label>
          <label class="setting-switch"><input id="dynamicBackgroundToggle" type="checkbox" ${ambientPreferences.dynamicBackground?'checked':''}><span>Audio-reactive and seasonal background motion</span></label>
        </div>
      </details>
    </div>
  `)

  directoryPromise.then(rows=>{
    if(!box.isConnected) return
    const countryRows=rows[0].status==='fulfilled'?rows[0].value:[]
    const languageRows=rows[1].status==='fulfilled'?rows[1].value:[]
    for(const id of ['radioCountry','devotionalCountry']){
      const select=box.querySelector('#'+id);if(!select)continue
      const selected=mediaPlayerState.radioCountry||''
      countryRows.forEach(row=>{const old=[...select.options].find(o=>o.value===row.code);if(old)old.textContent=row.name;else select.add(new Option(row.name+' · '+Number(row.stationcount||0).toLocaleString()+' stations',row.code))})
      select.value=selected
    }
    for(const id of ['radioLanguage','devotionalLanguage']){
      const select=box.querySelector('#'+id);if(!select)continue
      const selected=id==='radioLanguage'?mediaPlayerState.radioLanguage:mediaPlayerState.devotionalLanguage
      languageRows.forEach(row=>{if(![...select.options].some(o=>o.value===row.name))select.add(new Option(row.name,row.name))})
      select.value=selected||''
    }
  }).catch(()=>{})
  box.classList.add('audio-hub-backdrop')
  box.querySelector('.modal')?.classList.add('audio-hub-modal')
  const modeTabs=[...box.querySelectorAll('[data-audio-mode]')]
  const panels=[...box.querySelectorAll('[data-audio-panel]')]
  const discoverMore=box.querySelector('#audioDiscoverMore')
  const count=box.querySelector('#audioLibraryCount')
  const hint=box.querySelector('#audioLibraryHint')
  const radioCountry=box.querySelector('#radioCountry')
  const radioLanguage=box.querySelector('#radioLanguage')
  const devotionalCountry=box.querySelector('#devotionalCountry')
  const devotionalLanguage=box.querySelector('#devotionalLanguage')

  for(const name of ['music','radio','devotional']){
    const panel=box.querySelector(`[data-audio-panel="${name}"]`)
    const searchRow=panel?.querySelector('.audio-search-row')
    if(!panel||!searchRow) continue
    const toggle=document.createElement('button')
    toggle.type='button'
    toggle.className='audio-filter-toggle'
    toggle.textContent='Filters'
    toggle.setAttribute('aria-expanded','false')
    searchRow.insertAdjacentElement('afterend',toggle)
    toggle.onclick=()=>{
      const open=panel.classList.toggle('filters-open')
      toggle.textContent=open?'Hide filters':'Filters'
      toggle.setAttribute('aria-expanded',open?'true':'false')
    }
  }

  box.querySelector('#audioMoodForYou')?.addEventListener('click',async event=>{
    const button=event.currentTarget
    button.disabled=true
    button.textContent='Finding something...'
    try{
      await playForMood(latestMood?.mood||'calm')
      button.textContent='Playing'
    }catch{
      button.disabled=false
      button.textContent='Try again'
    }
  })
  box.querySelector('#audioMemoryMix')?.addEventListener('click',async event=>{
    const button=event.currentTarget
    button.disabled=true
    button.textContent='Building mix...'
    try{await playMemoryMix();button.textContent='Playing'}catch{button.disabled=false;button.textContent='Try again'}
  })
  box.querySelector('#audioWorldSurprise')?.addEventListener('click',async event=>{
    const button=event.currentTarget
    button.disabled=true
    button.textContent='Tuning...'
    try{await playWorldSurprise();button.textContent='Playing'}catch{button.disabled=false;button.textContent='Try again'}
  })

  const activeMode=()=>modeTabs.find(tab=>tab.classList.contains('active'))?.dataset.audioMode||'music'
  const activeRadioSort=()=>box.querySelector('[data-radio-sort].active')?.dataset.radioSort||'popular'
  const activeDevotionalSort=()=>box.querySelector('[data-devotional-sort].active')?.dataset.devotionalSort||'popular'
  const activeMusicSort=()=>box.querySelector('[data-music-sort].active')?.dataset.musicSort||'relevant'

  const syncToolbar=mode=>{
    discoverMore.hidden=mode==='nature'
    discoverMore.textContent=mode==='music'
      ?(mediaPlayerState.musicBrowseKind==='collections'?'Load more albums':'Load more tracks')
      :mode==='devotional'?'Load more devotionals':'Load more stations'
    hint.textContent=mode==='music'
      ?'Full tracks from the open Audius catalog.'
      :mode==='radio'
        ?'Real live station streams. 100 is only a discovery batch.'
        :mode==='devotional'
          ?'Live spiritual and devotional stations. Availability depends on broadcaster metadata.'
          :'Open recordings streamed from Wikimedia Commons.'
  }

  const setMode=mode=>{
    modeTabs.forEach(tab=>tab.classList.toggle('active',tab.dataset.audioMode===mode))
    panels.forEach(panel=>panel.classList.toggle('active',panel.dataset.audioPanel===mode))
    mediaPlayerState.audioView=mode
    localStore.setItem('memora-audio-view',mode)
    syncToolbar(mode)
  }

  const setDevotional=(tradition,query='',language=null)=>{
    mediaPlayerState.devotionalTradition=tradition||'all_faiths'
    mediaPlayerState.devotionalQuery=String(query||'').trim()
    if(language!==null){
      mediaPlayerState.devotionalLanguage=String(language||'')
      if(devotionalLanguage) devotionalLanguage.value=mediaPlayerState.devotionalLanguage
    }
    localStore.setItem('memora-devotional-tradition',mediaPlayerState.devotionalTradition)
    localStore.setItem('memora-devotional-query',mediaPlayerState.devotionalQuery)
    localStore.setItem('memora-devotional-language',mediaPlayerState.devotionalLanguage)
    box.querySelectorAll('[data-devotional]').forEach(button=>{
      const sameTradition=button.dataset.devotional===mediaPlayerState.devotionalTradition
      const sameQuery=String(button.dataset.devotionalQuery||'')===mediaPlayerState.devotionalQuery
      button.classList.toggle('selected',sameTradition&&sameQuery)
    })
  }

  let panelRequest=0
  const runLoad=async(mode,{append=false}={})=>{
    const requestId=++panelRequest
    const results=box.querySelector('#audioLibraryResults')
    if(!append) results.innerHTML='<div class="audio-loading"><span></span><span></span><span></span>Finding the best available audio...</div>'
    discoverMore.disabled=true

    try{
      if(mode==='music'){
        const query=box.querySelector('#musicSearch')?.value.trim()||''
        mediaPlayerState.musicQuery=query
        localStore.setItem('memora-music-query',query)
        if(mediaPlayerState.musicBrowseKind==='collections'){
          await loadMusicCollections(query,{append})
        }else{
          mediaPlayerState.musicSort=activeMusicSort()
          localStore.setItem('memora-music-sort',mediaPlayerState.musicSort)
          await loadMediaLibrary('music',query,50,{
            preserveCurrent:true,
            append,
            sort:mediaPlayerState.musicSort,
            genre:mediaPlayerState.musicGenre
          })
        }
      }else if(mode==='radio'){
        const query=box.querySelector('#radioSearch')?.value.trim()||''
        mediaPlayerState.radioCountry=radioCountry?.value||''
        mediaPlayerState.radioLanguage=radioLanguage?.value||''
        mediaPlayerState.radioSort=activeRadioSort()
        localStore.setItem('memora-radio-country',mediaPlayerState.radioCountry)
        localStore.setItem('memora-radio-language',mediaPlayerState.radioLanguage)
        localStore.setItem('memora-radio-sort',mediaPlayerState.radioSort)
        await loadMediaLibrary('radio',query,100,{
          preserveCurrent:true,
          append,
          random:mediaPlayerState.radioSort==='random',
          countrycode:mediaPlayerState.radioCountry,
          language:mediaPlayerState.radioLanguage,
          sort:mediaPlayerState.radioSort
        })
      }else if(mode==='devotional'){
        const query=box.querySelector('#devotionalSearch')?.value.trim()||mediaPlayerState.devotionalQuery||''
        mediaPlayerState.devotionalQuery=query
        mediaPlayerState.radioCountry=devotionalCountry?.value||''
        mediaPlayerState.devotionalLanguage=devotionalLanguage?.value||''
        mediaPlayerState.radioSort=activeDevotionalSort()
        localStore.setItem('memora-radio-country',mediaPlayerState.radioCountry)
        localStore.setItem('memora-devotional-language',mediaPlayerState.devotionalLanguage)
        localStore.setItem('memora-devotional-query',query)
        localStore.setItem('memora-radio-sort',mediaPlayerState.radioSort)
        await loadMediaLibrary('devotional',query,100,{
          preserveCurrent:true,
          append,
          random:mediaPlayerState.radioSort==='random',
          countrycode:mediaPlayerState.radioCountry,
          language:mediaPlayerState.devotionalLanguage,
          sort:mediaPlayerState.radioSort,
          tradition:mediaPlayerState.devotionalTradition
        })
      }else{
        const query=box.querySelector('#natureSearch')?.value.trim()||'rain'
        await loadMediaLibrary('nature',query,100,{preserveCurrent:true})
      }

      if(requestId!==panelRequest||!box.isConnected)return
      setMode(mode)
      if(mode==='music'&&mediaPlayerState.musicBrowseKind==='collections') renderMusicCollections(box)
      else renderAudioLibraryResults(box)
      if(append) results.scrollTop=results.scrollHeight
    }catch(error){
      if(requestId!==panelRequest||!box.isConnected)return
      if(!append) results.innerHTML=`<div class="empty compact-empty"><strong>Audio is temporarily unavailable</strong>${esc(error.message)}</div>`
      else toast('Could not load another batch just now')
    }finally{
      if(requestId!==panelRequest||!box.isConnected)return
      const modeNow=activeMode()
      discoverMore.disabled=modeNow==='music'
        ?(mediaPlayerState.musicBrowseKind==='collections'?!mediaPlayerState.musicCollectionHasMore:!mediaPlayerState.musicHasMore)
        :['radio','devotional'].includes(modeNow)
          ?!mediaPlayerState.radioHasMore&&mediaPlayerState.radioSort!=='random'
          :true
    }
  }

  box.querySelector('#libraryMute').onclick=async()=>{
    await setAmbientEnabled(!ambientPreferences.enabled)
    box.querySelector('#libraryMute').textContent=ambientPreferences.enabled?'Mute':'Enable audio'
    box.querySelector('#libraryMute').classList.toggle('primary',ambientPreferences.enabled)
  }

  modeTabs.forEach(tab=>tab.onclick=async()=>{
    const mode=tab.dataset.audioMode
    setMode(mode)
    await runLoad(mode)
  })

  box.querySelectorAll('[data-music-kind]').forEach(button=>button.onclick=async()=>{
    box.querySelectorAll('[data-music-kind]').forEach(item=>item.classList.toggle('active',item===button))
    mediaPlayerState.musicBrowseKind=button.dataset.musicKind
    localStore.setItem('memora-music-browse-kind',mediaPlayerState.musicBrowseKind)
    await runLoad('music')
  })
  box.querySelector('#worldSongFinder').onclick=()=>openMusicFinder(box.querySelector('#musicSearch').value)
  box.querySelector('#musicSearchButton').onclick=()=>runLoad('music')
  box.querySelector('#musicSearch').onkeydown=e=>{if(e.key==='Enter') runLoad('music')}
  box.querySelectorAll('[data-music-sort]').forEach(button=>button.onclick=async()=>{
    box.querySelectorAll('[data-music-sort]').forEach(item=>item.classList.toggle('active',item===button))
    mediaPlayerState.musicSort=button.dataset.musicSort
    await runLoad('music')
  })
  box.querySelectorAll('[data-music-query]').forEach(button=>button.onclick=async()=>{
    const value=button.dataset.musicQuery
    box.querySelector('#musicSearch').value=value
    mediaPlayerState.musicQuery=value
    await runLoad('music')
  })

  box.querySelector('#radioSearchButton').onclick=()=>runLoad('radio')
  box.querySelector('#radioSearch').onkeydown=e=>{if(e.key==='Enter') runLoad('radio')}
  box.querySelectorAll('[data-radio-sort]').forEach(button=>button.onclick=async()=>{
    box.querySelectorAll('[data-radio-sort]').forEach(item=>item.classList.toggle('active',item===button))
    await runLoad('radio')
  })
  radioCountry.onchange=()=>runLoad('radio')
  radioLanguage.onchange=()=>runLoad('radio')
  box.querySelectorAll('[data-radio-country-quick]').forEach(button=>button.onclick=async()=>{
    radioCountry.value=button.dataset.radioCountryQuick
    await runLoad('radio')
  })

  box.querySelector('#devotionalSearchButton').onclick=()=>{
    mediaPlayerState.devotionalQuery=box.querySelector('#devotionalSearch').value.trim()
    runLoad('devotional')
  }
  box.querySelector('#devotionalSearch').onkeydown=e=>{if(e.key==='Enter') box.querySelector('#devotionalSearchButton').click()}
  box.querySelectorAll('[data-devotional-sort]').forEach(button=>button.onclick=async()=>{
    box.querySelectorAll('[data-devotional-sort]').forEach(item=>item.classList.toggle('active',item===button))
    await runLoad('devotional')
  })
  devotionalCountry.onchange=()=>runLoad('devotional')
  devotionalLanguage.onchange=async()=>{
    mediaPlayerState.devotionalLanguage=devotionalLanguage.value
    box.querySelectorAll('[data-devotional-language-quick]').forEach(item=>item.classList.toggle('active',item.dataset.devotionalLanguageQuick===mediaPlayerState.devotionalLanguage))
    await runLoad('devotional')
  }
  box.querySelectorAll('[data-devotional-language-quick]').forEach(button=>button.onclick=async()=>{
    mediaPlayerState.devotionalLanguage=button.dataset.devotionalLanguageQuick||''
    devotionalLanguage.value=mediaPlayerState.devotionalLanguage
    box.querySelectorAll('[data-devotional-language-quick]').forEach(item=>item.classList.toggle('active',item===button))
    await runLoad('devotional')
  })
  box.querySelectorAll('[data-devotional]').forEach(button=>button.onclick=async()=>{
    const language=button.dataset.regionalLanguage??null
    setDevotional(button.dataset.devotional||'all_faiths',button.dataset.devotionalQuery||'',language)
    box.querySelector('#devotionalSearch').value=button.dataset.devotionalQuery||''
    await runLoad('devotional')
  })

  box.querySelector('#natureSearchButton').onclick=()=>runLoad('nature')
  box.querySelector('#natureSearch').onkeydown=e=>{if(e.key==='Enter') runLoad('nature')}
  box.querySelectorAll('[data-nature-query]').forEach(button=>button.onclick=async()=>{
    box.querySelector('#natureSearch').value=button.dataset.natureQuery
    await runLoad('nature')
  })

  discoverMore.onclick=()=>runLoad(activeMode(),{append:true})

  const volume=box.querySelector('#libraryVolume')
  volume.oninput=event=>{
    const value=Number(event.target.value)
    ambientPreferences.volume=value
    const audio=mediaAudio()
    if(audio) audio.volume=value
    box.querySelector('#libraryVolumeLabel').textContent=`${Math.round(value*100)}%`
  }
  volume.onchange=event=>saveExperiencePreferences({volume:Number(event.target.value)})
  box.querySelector('#dynamicBackgroundToggle').onchange=event=>saveExperiencePreferences({dynamicBackground:event.target.checked})

  syncToolbar(currentMode)
  await runLoad(currentMode)
}

function setupAmbientUnlock(){
  const unlock=async()=>{
    if(!user||!ambientPreferences.enabled) return
    ensureMediaPlayer()
    const audio=mediaAudio()
    if(audio&&audio.paused){
      audio.muted=false
      try{await audio.play()}catch{}
    }
    document.removeEventListener('pointerdown',unlock)
    document.removeEventListener('keydown',unlock)
  }
  document.addEventListener('pointerdown',unlock)
  document.addEventListener('keydown',unlock)
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
  updateVisualScene()
  if(document.documentElement.dataset.audioPlaying!=='true') loadSceneBackdrop(sceneForTheme(theme.id))
  lastThemeHour=hour
}

function updateTheme(){
  const mode=localStore.getItem('memora-theme')||'auto'
  if(mode==='auto') adaptiveTheme()
  else {
    const theme=manualThemes[mode]||themeCatalog[0]
    applyTheme(theme,theme.label)
    if(document.documentElement.dataset.audioPlaying!=='true') loadSceneBackdrop(sceneForTheme(theme.id||mode))
  }
}

function setupAtmosphere(){
  updateTheme()
  updateVisualScene()
  setupAmbientUnlock()
  document.addEventListener('pointermove',event=>{
    const x=Math.round(event.clientX/window.innerWidth*100)
    const y=Math.round(event.clientY/window.innerHeight*100)
    document.documentElement.style.setProperty('--pointer-x',`${x}%`)
    document.documentElement.style.setProperty('--pointer-y',`${y}%`)
  },{passive:true})
  setInterval(()=>{
    const mode=localStore.getItem('memora-theme')||'auto'
    const hour=new Date().getHours()
    if(mode==='auto'&&hour!==lastThemeHour) adaptiveTheme()
    else updateVisualScene()
    if(ambientPreferences.enabled&&ambientPreferences.scene==='auto'&&ambientAudioContext?.state==='running'){
      const nextScene=resolveAmbientScene()
      if(nextScene!==ambientCurrentScene) startAmbient(nextScene)
    }
  },60000)
}

function openThemePicker(){
  const current=localStore.getItem('memora-theme')||'auto'
  const body=`
    <p class="muted">Adaptive changes the atmosphere every hour. Or choose from ${themeCatalog.length} visual combinations.</p>
    <div class="theme-picker-tools">
      <input class="input" id="themeSearch" placeholder="Search Ocean, Velvet, Sakura, Galaxy...">
      <button class="btn" id="randomTheme">Surprise me</button>
      <button class="btn ${current==='auto'?'primary':''}" data-theme="auto">Adaptive hourly</button>
    </div>
    <div class="theme-gallery" id="themeGallery">
      ${themeCatalog.map(theme=>`<button class="theme-card ${current===theme.id?'selected':''}" data-theme="${theme.id}" data-theme-name="${theme.label.toLowerCase()}" style="--t1:${theme.c1};--t2:${theme.c2};--t3:${theme.c3};--tb:${theme.bg1}"><span></span><small>${theme.label}</small></button>`).join('')}
    </div>`
  const box=modal('Theme Universe',body)

  const choose=id=>{
    localStore.setItem('memora-theme',id)
    updateTheme()
    box.remove()
    toast(id==='auto'?'Adaptive hourly theme enabled':'Theme updated')
  }

  box.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>choose(button.dataset.theme))
  box.querySelector('#randomTheme').onclick=()=>{
    const theme=themeCatalog[Math.floor(Math.random()*themeCatalog.length)]
    choose(theme.id)
  }
  box.querySelector('#themeSearch').oninput=event=>{
    const term=event.target.value.trim().toLowerCase()
    box.querySelectorAll('.theme-card').forEach(card=>card.classList.toggle('hidden',term&&!card.dataset.themeName.includes(term)))
  }
}

let authProviderCache=null
let mediaLibraryRequest=0
let mediaRecoveryAttempts=0
let mediaRecoveryTimer=null

async function getAuthProviderSettings(force=false){
  if(authProviderCache&&!force) return authProviderCache
  try{
    const data=await fetchApi(`${SUPABASE_URL}/auth/v1/settings`,{
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY}
    })
    authProviderCache=data?.external||{}
    return authProviderCache
  }catch{
    authProviderCache={}
    return authProviderCache
  }
}

function providerIcon(provider){
  const svg=body=>`<svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`
  if(provider==='google')return svg('<path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.51l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"/>')
  if(provider==='facebook')return svg('<circle cx="12" cy="12" r="12" fill="#0866FF"/><path fill="white" d="M13.7 24v-9.3h3.1l.5-3.6h-3.6V8.8c0-1 .3-1.8 1.8-1.8h1.9V3.8c-.3 0-1.5-.1-2.8-.1-2.8 0-4.7 1.7-4.7 4.9v2.5H6.8v3.6h3.1V24Z"/>')
  if(provider==='azure')return svg('<path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M13 1h10v10H13z"/><path fill="#00a4ef" d="M1 13h10v10H1z"/><path fill="#ffb900" d="M13 13h10v10H13z"/>')
  return ''
}

function providerLabel(provider){
  return ({google:'Google',facebook:'Facebook',azure:'Microsoft',apple:'Apple',github:'GitHub'})[provider]||provider
}

function providerSetupHelp(provider){
  const label=providerLabel(provider)
  const details={
    google:'Create Google OAuth credentials, then enable Google in Supabase Authentication > Sign In / Providers.',
    facebook:'Create a Meta app with Facebook Login, then enable Facebook in Supabase Authentication > Sign In / Providers.',
    azure:'Create a Microsoft Entra application registration, then enable Azure in Supabase Authentication > Sign In / Providers.',
    apple:'Create an Apple Services ID and Sign in with Apple credentials, then enable Apple in Supabase Authentication > Sign In / Providers.',
    github:'Create a GitHub OAuth App, then enable GitHub in Supabase Authentication > Sign In / Providers.'
  }
  modal(`${label} sign-in setup`,`
    <p class="muted">${details[provider]||'This sign-in provider is not enabled yet.'}</p>
    <p class="small muted">Until it is enabled, Memora keeps email and password sign-in available and will not redirect you to a broken provider page.</p>
  `)
}

async function oauthSignIn(provider,scopes){
  const external=await getAuthProviderSettings(true)
  if(!external?.[provider]){
    providerSetupHelp(provider)
    return
  }
  const options={redirectTo:window.location.origin+'/'}
  if(scopes) options.scopes=scopes
  const {error}=await supabase.auth.signInWithOAuth({provider,options})
  if(error) toast(error.message)
}

async function magicLink(email){
  if(!email||!document.getElementById('email')?.checkValidity()) return toast('Enter a valid email first')
  const button=document.getElementById('magicLink')
  if(button?.disabled) return
  if(button) button.disabled=true
  try{
  const {error}=await supabase.auth.signInWithOtp({
    email,
    options:{emailRedirectTo:window.location.origin,shouldCreateUser:true}
  })
  toast(error?error.message:'Magic link sent. Check your inbox and spam folder.')
  }catch{toast('Could not send the link. Please try again.')}
  finally{if(button) button.disabled=false}
}

async function authScreen(mode='login'){
  app.innerHTML=`<div class="auth-wrap"><div class="glass auth-card auth-loading"><div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>Preparing your private universe...</small></div></div><div class="auth-loader"><span></span><span></span><span></span></div></div></div>`
  const external=authProviderCache||{}

  const socialButton=(provider,label)=>{
    const enabled=Boolean(external?.[provider])
    if(!enabled) return ''
    return `<button class="social ${enabled?'':'provider-disabled'}" ${enabled?`data-oauth="${provider}"`:`data-provider-setup="${provider}"`}>${providerIcon(provider)}${enabled?`Continue with ${label}`:`${label} setup required`}</button>`
  }

  app.innerHTML=`
  <div class="auth-wrap">
    <div class="glass auth-card">
      <div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>A private universe for your life</small></div></div>
      <div class="eyebrow">Your memory, beautifully organized</div>
      <h2>${mode==='login'?'Welcome back':'Create your private universe'}</h2>
      <p class="muted">Memories can include text, photos, video, voice, places, files and connected sources.</p>
      <div class="social-grid">
        ${socialButton('google','Google')}
        ${socialButton('azure','Microsoft')}
        ${socialButton('apple','Apple')}
        ${socialButton('facebook','Facebook')}
        ${socialButton('github','GitHub')}
      </div>
      <div class="divider">OR USE EMAIL</div>
      <form id="authForm">
        ${mode==='signup'?'<input class="input" id="name" placeholder="Your name" required>':''}
        <input class="input" id="email" name="email" type="email" autocomplete="username" aria-label="Email" placeholder="Email" required>
        <input class="input" id="password" name="password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" aria-label="Password" ${mode==='signup'?'minlength="8"':''} placeholder="Password" required>
        <button class="btn primary" type="submit">${mode==='login'?'Enter Memora':'Create account'}</button>
      </form>
      <div class="grid two" style="margin-top:9px">
        <button class="btn" id="magicLink">Email me a magic link</button>
        <button class="btn" id="switchMode">${mode==='login'?'Create new account':'I already have an account'}</button>
      </div>
      <p class="small muted">A magic link signs you in from your email inbox. No password is needed. Request a new link if yours expires.</p>
      <p id="authMsg" class="muted" role="status" aria-live="polite"></p>

      <div class="auth-public-footer">
        <span>© 2026 Memora. Created by John Abijit J A. All rights reserved.</span>
        <a href="mailto:johnabijit@gmail.com?subject=Memora%20support">Contact & feedback</a>
      </div>
    </div>
  </div>`

  document.querySelectorAll('[data-oauth]').forEach(button=>button.onclick=()=>{
    const provider=button.dataset.oauth
    oauthSignIn(provider,['azure','facebook'].includes(provider)?'email':undefined)
  })
  document.querySelectorAll('[data-provider-setup]').forEach(button=>button.onclick=()=>providerSetupHelp(button.dataset.providerSetup))
  const socialGrid=app.querySelector('.social-grid')
  const socialDivider=app.querySelector('.divider')
  socialGrid.hidden=!socialGrid.querySelector('.social')
  socialDivider.hidden=socialGrid.hidden
  // Email sign-in must never wait for optional provider discovery.
  getAuthProviderSettings().then(settings=>{
    if(!socialGrid.isConnected) return
    socialGrid.innerHTML=['google','apple','facebook','azure','github']
      .filter(provider=>settings[provider])
      .map(provider=>`<button class="social" data-oauth="${provider}">${providerIcon(provider)}Continue with ${providerLabel(provider)}</button>`).join('')
    socialGrid.hidden=!socialGrid.children.length
    socialDivider.hidden=socialGrid.hidden
    socialGrid.querySelectorAll('[data-oauth]').forEach(button=>button.onclick=()=>{
      const provider=button.dataset.oauth
      oauthSignIn(provider,['azure','facebook'].includes(provider)?'email':undefined)
    })
  })
  document.getElementById('magicLink').onclick=()=>magicLink(document.getElementById('email').value.trim())
  document.getElementById('switchMode').onclick=()=>authScreen(mode==='login'?'signup':'login')
  document.getElementById('authForm').onsubmit=async event=>{
    event.preventDefault()
    const email=document.getElementById('email').value.trim()
    const password=document.getElementById('password').value
    const msg=document.getElementById('authMsg')
    const submit=event.currentTarget.querySelector('[type="submit"]')
    if(submit.disabled) return
    submit.disabled=true
    msg.textContent='Working...'
    try{
    if(mode==='signup'){
      const display_name=document.getElementById('name').value.trim()
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name},emailRedirectTo:window.location.origin}})
      if(error) return msg.textContent=error.message
      if(data.session){user=data.user;await bootstrapSignedIn()}else msg.textContent='Account created. Check your email to confirm, then return here and sign in.'
    }else{
      const {data,error}=await supabase.auth.signInWithPassword({email,password})
      if(error) return msg.textContent=error.message
      user=data.user
      await bootstrapSignedIn()
    }
    }catch(error){
      msg.textContent=error.message||'Sign-in could not finish. Please try again.'
    }finally{
      submit.disabled=false
    }
  }
}

const dockItems=[
  ['home','⌂','Home'],
  ['ask','◎','Ask'],
  ['capture','＋',''],
  ['timeline','◷','Timeline'],
  ['vault','◇','Vault']
]

function routeUrl(next=view,threadId=currentThreadId){
  const url=new URL(window.location.href)
  url.search=''
  url.searchParams.set('view',next)
  if(next==='ask'&&threadId) url.searchParams.set('thread',threadId)
  return url.pathname+url.search
}

function routeState(next=view){
  return {memora:true,view:next,threadId:next==='ask'?currentThreadId:null}
}

function shell(content,title,subtitle=''){
  const canBack=view!=='home'
  return `
  <div class="app">
    <a class="skip-link" href="#mainContent">Skip to content</a>
    <div class="scene-photo-layer" aria-hidden="true"></div>
    <div class="scene-layer" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
    <header class="topbar" role="banner">
      <div class="top-left">
        ${canBack?'<button class="back-btn" id="appBackButton" aria-label="Go back">‹</button>':''}
        <button class="brand brand-button" id="brandHome" aria-label="Memora home"><span class="logo">M</span><span><strong>Memora</strong><small>Your life, remembered beautifully</small></span></button>
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="globalSearchButton" aria-label="Search Memora and music" title="Search">⌕<span class="global-search-label"> Search</span></button>
        <button class="icon-btn sound-button" id="soundButton" title="Memora Audio" aria-label="Open Memora Audio"><span class="sound-icon">♫</span><span class="sound-label">${ambientPreferences.enabled?'Audio':'Muted'}</span></button>
        <button class="icon-btn" id="themeButton" aria-label="Choose visual theme"><span class="theme-text" id="themeLabel">${esc(document.documentElement.dataset.themeLabel||'Adaptive')}</span> ✦</button>
        <button class="icon-btn" id="settingsButton" aria-label="Profile and settings">Profile</button>
      </div>
    </header>
    <main class="main" id="mainContent" tabindex="-1">
      ${title?`<div class="page-head"><div><div class="eyebrow">Memora</div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div>`:''}
      ${content}
      <footer class="app-footer" aria-label="Memora footer">
        <div class="footer-copy">
          <strong>Memora</strong>
          <span>© 2026 Memora. Created by John Abijit J A. All rights reserved.</span>
        </div>
        <div class="footer-actions">
          <a class="scene-credit hidden" id="sceneCredit" target="_blank" rel="noopener">Scene: Wikimedia Commons</a>
          <button class="footer-help" data-nav="help">Help & feedback</button>
        </div>
      </footer>
    </main>
    <nav class="dock" aria-label="Primary navigation">
      ${dockItems.map(([id,icon,label])=>id==='capture'
        ?`<button class="capture" id="dockCapture" aria-label="Create a new memory">${icon}</button>`
        :`<button data-nav="${id}" class="${view===id?'active':''}" aria-label="${esc(label)}" ${view===id?'aria-current="page"':''}><span aria-hidden="true">${icon}</span><small>${label}</small></button>`
      ).join('')}
    </nav>
  </div>`
}

function memorySearchSnippet(item){
  const title=String(item.summary||item.title||'').trim()
  let text=String(item.original_text||'').split(/\s*\{["\s]/)[0].replace(/\s+/g,' ').trim()
  if(title&&text.startsWith(title)) text=text.slice(title.length).trim()
  if(title&&text.startsWith(title)) text=text.slice(title.length).trim()
  return (text||title).slice(0,400)+(text.length>400?'…':'')
}

function youtubeTarget(value){
  try{
    const u=new URL(value), host=u.hostname.toLowerCase()
    if(u.protocol!=='https:'||u.username||u.password||u.port) return null
    if(!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(host)) return null
    const id=host==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1]
    const list=u.searchParams.get('list')
    if(id&&/^[A-Za-z0-9_-]{11}$/.test(id)) return {embed:'https://www.youtube-nocookie.com/embed/'+id,source:'https://www.youtube.com/watch?v='+id}
    if(list&&/^[A-Za-z0-9_-]{10,100}$/.test(list)) return {embed:'https://www.youtube-nocookie.com/embed/videoseries?list='+encodeURIComponent(list),source:'https://www.youtube.com/playlist?list='+encodeURIComponent(list)}
  }catch{}
  return null
}

function openMusicFinder(initial=''){
  const box=modal('Find songs worldwide',`
    <p class="muted">Find songs, artists, movie soundtracks, albums and playlists on YouTube. Choose official artist or label uploads. Availability, ads and regional restrictions depend on YouTube.</p>
    <form class="global-search-form" id="songFinderForm">
      <label for="songFinderQuery">Song, artist or movie name</label><input class="input" id="songFinderQuery" value="${esc(initial)}" placeholder="Akon, SPB, Anirudh, movie or song name" maxlength="200" required>
      <label for="songFinderKind">Find</label><select class="input" id="songFinderKind"><option value="song">Songs</option><option value="artist">Artists</option><option value="movie">Movie soundtracks</option><option value="album">Albums</option><option value="playlist">Playlists</option></select>
      <button class="btn primary" type="submit">Find on YouTube</button>
    </form>
    <div class="search-external" id="songFinderLinks"></div>
    <div class="music-artist-examples">${['Akon','S. P. Balasubrahmanyam','Anirudh Ravichander','A. R. Rahman'].map(name=>`<button class="chip" data-find-artist="${esc(name)}">${esc(name)}</button>`).join('')}</div>
    <p class="small muted">Search opens YouTube in a new tab. To play an embeddable video or playlist here, paste its YouTube link below. Some videos can only play on YouTube.</p>
    <form class="global-search-form" id="youtubeLinkForm"><label for="youtubeLink">YouTube video or playlist link</label><input class="input" id="youtubeLink" type="url" placeholder="https://www.youtube.com/watch?v=…" required><button class="btn" type="submit">Open player</button></form>
    <p role="status" id="youtubeLinkStatus"></p><div id="youtubePlayerSlot"></div>`)
  const query=box.querySelector('#songFinderQuery'),kind=box.querySelector('#songFinderKind'),links=box.querySelector('#songFinderLinks')
  const update=()=>{
    const term=query.value.trim();links.replaceChildren();if(!term)return
    const expanded=/^spb$/i.test(term)?'S. P. Balasubrahmanyam':term
    const suffix={song:'official song',artist:'official songs',movie:'movie soundtrack songs',album:'full album',playlist:'songs playlist'}[kind.value]
    const a=document.createElement('a');a.className='btn primary';a.target='_blank';a.rel='noopener noreferrer';a.href='https://www.youtube.com/results?'+new URLSearchParams({search_query:expanded+' '+suffix});a.textContent='Open YouTube results ↗';links.append(a)
  }
  box.querySelector('#songFinderForm').onsubmit=e=>{e.preventDefault();update();links.querySelector('a')?.click()}
  query.oninput=update;kind.onchange=update
  box.querySelectorAll('[data-find-artist]').forEach(b=>b.onclick=()=>{query.value=b.dataset.findArtist;kind.value='artist';update()})
  box.querySelector('#youtubeLinkForm').onsubmit=e=>{
    e.preventDefault();const target=youtubeTarget(box.querySelector('#youtubeLink').value.trim()),status=box.querySelector('#youtubeLinkStatus')
    if(!target){status.textContent='Enter a valid HTTPS YouTube video or playlist link.';return}
    mediaAudio()?.pause();stopAmbient()
    const slot=box.querySelector('#youtubePlayerSlot');slot.replaceChildren()
    const frame=document.createElement('iframe');frame.src=target.embed;frame.title='YouTube music player';frame.className='youtube-music-player';frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';slot.append(frame)
    const a=document.createElement('a');a.href=target.source;a.target='_blank';a.rel='noopener noreferrer';a.className='btn';a.textContent='Watch on YouTube ↗';slot.append(a)
    status.textContent='Press Play in the video. If embedding is restricted, use Watch on YouTube.'
  }
  update()
}

function openGlobalSearch(){
  const wrap=modal('Search',`
    <form class="global-search-form">
      <label for="globalSearchScope">Search in</label>
      <select class="input" id="globalSearchScope"><option value="memories">Saved memories, people and things</option><option value="music">Music and songs</option><option value="web">The web</option></select>
      <label for="globalSearchQuery">What are you looking for?</label>
      <input class="input" id="globalSearchQuery" type="search" maxlength="200" required placeholder="Search by name, title or keyword">
      <button class="btn primary" type="submit">Search</button>
    </form>
    <p class="small muted" id="globalSearchNote">Search your saved information privately. Public searches run only when you choose Music or The web.</p>
    <p role="status" aria-live="polite" id="globalSearchStatus"></p>
    <button class="btn" id="globalMusicFinder">Find artists, movie songs, albums & playlists</button>
    <div class="global-search-results"></div>`)
  wrap.querySelector('#globalMusicFinder').onclick=()=>openMusicFinder()
  const scope=wrap.querySelector('select'), input=wrap.querySelector('input')
  const results=wrap.querySelector('.global-search-results'), status=wrap.querySelector('[role="status"]')
  let request=0
  scope.onchange=()=>{request++;results.replaceChildren();status.textContent=''}
  const link=(url,label)=>`<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`
  wrap.querySelector('form').onsubmit=async event=>{
    event.preventDefault()
    const query=input.value.trim(), mode=scope.value, id=++request
    if(!query) return
    results.replaceChildren();status.textContent='Searching…'
    const encoded=encodeURIComponent(query)
    const links=mode==='music'?`<p class="small muted">Search available Audius and Wikimedia recordings below. For other songs, open a provider. Availability and subscriptions vary.</p><div class="search-external">${link('https://www.youtube.com/results?search_query='+encoded,'YouTube')}${link('https://open.spotify.com/search/'+encoded,'Spotify')}</div>`:mode==='web'?`<p class="small muted">Choose a search engine to open results outside Memora.</p><div class="search-external">${link('https://www.google.com/search?q='+encoded,'Google')}${link('https://www.bing.com/search?q='+encoded,'Bing')}</div>`:''
    results.innerHTML=links
    if(mode==='web'){status.textContent='Ready to search the web';return}
    try{
      const items=mode==='memories'?await smartMemorySearch(query,20):(await fetchApi('/api/open-music?'+new URLSearchParams({mode:'search',q:query,limit:'30'}))).items||[]
      if(id!==request||!wrap.isConnected) return
      status.textContent=items.length?`${items.length} results`:'No matching results. Try another title or keyword.'
      items.forEach(item=>{
        const card=document.createElement('article');card.className='search-result'
        const title=document.createElement('strong');title.textContent=String(item.title||item.summary||'Saved memory').slice(0,180);card.append(title)
        const detail=document.createElement('p');detail.textContent=mode==='music'?[item.artist,item.source,item.license].filter(Boolean).join(' · '):memorySearchSnippet(item);card.append(detail)
        if(mode==='music'&&item.url){
          const play=document.createElement('button');play.className='btn';play.textContent='Play'
          play.onclick=async()=>{mediaPlayerState.library=items;mediaPlayerState.query=query;await selectMediaTrack(item,true);status.textContent=ambientPreferences.enabled?`Selected ${item.title}`:'Track selected. Turn on Audio to listen.'}
          card.append(play)
          if(/^https?:\/\//i.test(item.sourcePage||'')){const source=document.createElement('a');source.href=item.sourcePage;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Source & credits ↗';card.append(source)}
        }
        results.append(card)
      })
    }catch{if(id===request&&wrap.isConnected) status.textContent='Search is temporarily unavailable. Please try again.'}
  }
  setTimeout(()=>input.focus(),30)
}

function wire(){
  document.querySelectorAll('[data-nav]').forEach(button=>button.onclick=()=>go(button.dataset.nav))
  document.getElementById('dockCapture')?.addEventListener('click',()=>go('home',true))
  document.getElementById('brandHome')?.addEventListener('click',()=>go('home'))
  document.getElementById('themeButton')?.addEventListener('click',openThemePicker)
  document.getElementById('globalSearchButton')?.addEventListener('click',openGlobalSearch)
  document.getElementById('soundButton')?.addEventListener('click',openSoundscapePicker)
  document.getElementById('settingsButton')?.addEventListener('click',()=>go('settings'))
  document.getElementById('appBackButton')?.addEventListener('click',()=>{
    if(window.history.length>1) window.history.back()
    else go('home')
  })
  updateSoundButton()
}

async function renderRoute(next,focus=false){
  const routes={home,memories,ask,timeline,sources,vault,people,places,things,documents,settings,help}
  const renderPage=async()=>await (routes[next]||home)()
  const reduced=document.documentElement.dataset.reduceMotion==='on'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if(document.startViewTransition&&!reduced){
    try{
      const transition=document.startViewTransition(renderPage)
      await transition.finished
    }catch{
      await renderPage()
    }
  }else{
    await renderPage()
  }
  removeStrayEscapedNewline()
  if(focus) setTimeout(()=>document.getElementById('memoryInput')?.focus(),80)
}

async function go(next,focus=false,{push=true,replace=false}={}){
  if(next==='ask'&&!currentThreadId) await ensureChatThread()
  view=next
  if(navigationInitialized){
    const state=routeState(next)
    const url=routeUrl(next)
    if(replace) window.history.replaceState(state,'',url)
    else if(push) window.history.pushState(state,'',url)
  }
  await renderRoute(next,focus)
}

async function initializeNavigation(){
  const url=new URL(window.location.href)
  const requested=url.searchParams.get('view')
  const allowed=new Set(['home','memories','ask','timeline','sources','vault','people','places','things','documents','settings','help'])
  view=allowed.has(requested)?requested:'home'
  const requestedThread=url.searchParams.get('thread')
  if(view==='ask'){
    if(requestedThread) currentThreadId=requestedThread
    await ensureChatThread()
  }
  navigationInitialized=true
  const state=routeState(view)
  const cleanUrl=routeUrl(view)
  window.history.replaceState(state,'',cleanUrl)
  window.history.pushState(state,'',cleanUrl)
  await renderRoute(view)
}

window.addEventListener('popstate',async event=>{
  if(!user||!event.state?.memora) return
  const next=event.state.view||'home'
  view=next
  if(next==='ask'){
    currentThreadId=event.state.threadId||currentThreadId
    await ensureChatThread()
  }
  await renderRoute(next)
})

const render=()=>go(view,false,{push:false})

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


function extractPhoneNumbers(text){
  const source=String(text||'')
  const normalizeNumber=raw=>raw.trim().replace(/\s+/g,' ')
  const valid=(raw,labeled=false)=>{
    const digits=raw.replace(/\D/g,'')
    if(labeled) return digits.length>=7&&digits.length<=15
    if(raw.trim().startsWith('+')) return digits.length>=8&&digits.length<=15
    return digits.length>=10&&digits.length<=15
  }

  const labeled=[]
  for(const line of source.split(/\r?\n/)){
    if(!/\b(phone|mobile|contact|telephone|tel|cell)\b/i.test(line)) continue
    const matches=line.match(/\+?\d[\d\s().-]{5,}\d/g)||[]
    for(const raw of matches){
      if(valid(raw,true)) labeled.push(normalizeNumber(raw))
    }
  }
  if(labeled.length) return [...new Set(labeled)]

  const generic=source.match(/\+?\d[\d\s().-]{7,}\d/g)||[]
  return [...new Set(generic.map(normalizeNumber).filter(raw=>valid(raw,false)))]
}

function extractEmails(text){
  return [...new Set(String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[])]
}

function compactText(text,max=280){
  const clean=String(text||'').replace(/\s+/g,' ').trim()
  return clean.length>max?clean.slice(0,max-1)+'…':clean
}


async function ensureTesseractBrowser(){
  if(window.Tesseract?.createWorker) return window.Tesseract

  const existing=document.getElementById('memora-tesseract')
  if(existing&&!window.Tesseract?.createWorker) existing.remove()

  await new Promise((resolve,reject)=>{
    const script=document.createElement('script')
    script.id='memora-tesseract'
    script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
    script.async=true
    script.onload=resolve
    script.onerror=()=>reject(new Error('OCR library failed to load'))
    document.head.appendChild(script)
  })

  if(!window.Tesseract?.createWorker) throw new Error('OCR engine did not initialize correctly')
  return window.Tesseract
}

async function getOcrWorker(){
  if(!ocrWorkerPromise){
    ocrWorkerPromise=(async()=>{
      const Tesseract=await ensureTesseractBrowser()
      const worker=await Tesseract.createWorker('eng',1,{
        workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath:'https://tessdata.projectnaptha.com/4.0.0',
        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1'
      })
      await worker.setParameters({
        preserve_interword_spaces:'1',
        user_defined_dpi:'300'
      })
      return worker
    })().catch(error=>{ocrWorkerPromise=null;throw error})
  }
  return ocrWorkerPromise
}

async function imageBitmapFromBlob(blob){
  if('createImageBitmap' in window) return await createImageBitmap(blob)
  const url=URL.createObjectURL(blob)
  try{
    const img=new Image()
    img.decoding='async'
    img.src=url
    await img.decode()
    return img
  }finally{
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
}

async function prepareImageForOcr(blob,{highContrast=false}={}){
  const bitmap=await imageBitmapFromBlob(blob)
  const sourceWidth=bitmap.width||bitmap.naturalWidth
  const sourceHeight=bitmap.height||bitmap.naturalHeight
  if(!sourceWidth||!sourceHeight) return blob

  const maxSide=3200
  let scale=sourceWidth<1800?Math.min(2.4,1800/sourceWidth):1
  if(Math.max(sourceWidth*scale,sourceHeight*scale)>maxSide){
    scale=maxSide/Math.max(sourceWidth,sourceHeight)
  }

  const canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(sourceWidth*scale))
  canvas.height=Math.max(1,Math.round(sourceHeight*scale))
  const ctx=canvas.getContext('2d',{willReadFrequently:highContrast})
  ctx.imageSmoothingEnabled=true
  ctx.imageSmoothingQuality='high'
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)

  if(highContrast){
    const imageData=ctx.getImageData(0,0,canvas.width,canvas.height)
    const d=imageData.data
    for(let i=0;i<d.length;i+=4){
      const gray=Math.round(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)
      const boosted=gray<145?Math.max(0,gray*0.72):Math.min(255,gray*1.18)
      d[i]=d[i+1]=d[i+2]=boosted
    }
    ctx.putImageData(imageData,0,0)
  }

  return await new Promise(resolve=>canvas.toBlob(result=>resolve(result||blob),'image/png',1))
}

function ocrQuality(result){
  const text=String(result?.data?.text||'').trim()
  const useful=(text.match(/[A-Za-z0-9]/g)||[]).length
  const confidence=Number(result?.data?.confidence||0)
  return {text,useful,confidence,score:useful+confidence*2}
}

function summarizeImageText(text){
  const clean=String(text||'').replace(/\r/g,'').trim()
  if(!clean) return ''
  const lines=clean.split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(line=>line.length>=2)
  const picked=[]
  for(const line of lines){
    if(!picked.some(existing=>existing.toLowerCase()===line.toLowerCase())) picked.push(line)
    if(picked.length>=8) break
  }
  return compactText(picked.join(' | '),520)
}

async function analyzeImageMedia(media,{quiet=false,force=false}={}){
  if(!media||media.media_type!=='image') return media
  if(!force&&media.analysis_status==='complete'&&String(media.extracted_text||'').trim()) return media
  if(!quiet) toast('Reading text from your image...')

  await supabase.from('memory_media').update({
    analysis_status:'processing',
    analysis_error:null,
    analysis_attempts:Number(media.analysis_attempts||0)+1
  }).eq('id',media.id)

  try{
    const download=await supabase.storage.from('memora-media').download(media.storage_path)
    if(download.error) throw download.error

    const worker=await getOcrWorker()
    const normalImage=await prepareImageForOcr(download.data,{highContrast:false})
    const first=await worker.recognize(normalImage)
    let best=first
    let bestQuality=ocrQuality(first)

    if(bestQuality.useful<45||bestQuality.confidence<48){
      const contrastImage=await prepareImageForOcr(download.data,{highContrast:true})
      const second=await worker.recognize(contrastImage)
      const secondQuality=ocrQuality(second)
      if(secondQuality.score>bestQuality.score){
        best=second
        bestQuality=secondQuality
      }
    }

    const text=String(best?.data?.text||'').trim()
    const extracted_data={
      phone_numbers:extractPhoneNumbers(text),
      emails:extractEmails(text),
      ocr_confidence:best?.data?.confidence??null,
      readable_summary:summarizeImageText(text)
    }

    const update=await supabase.from('memory_media').update({
      extracted_text:text,
      extracted_data,
      analysis_status:text?'complete':'no_text',
      analysis_error:null,
      analyzed_at:new Date().toISOString(),
      caption:text?summarizeImageText(text):'No readable text detected'
    }).eq('id',media.id).select().single()
    if(update.error) throw update.error

    const memory=await supabase.from('memories').select('interpreted_data').eq('id',media.memory_id).maybeSingle()
    if(memory.data){
      const existing=memory.data.interpreted_data||{}
      const merged={
        ...existing,
        image_text:text||existing.image_text||null,
        image_summary:extracted_data.readable_summary||existing.image_summary||null,
        phone_numbers:[...new Set([...(existing.phone_numbers||[]),...extracted_data.phone_numbers])],
        emails:[...new Set([...(existing.emails||[]),...extracted_data.emails])]
      }
      await supabase.from('memories').update({interpreted_data:merged}).eq('id',media.memory_id)
    }

    if(!quiet){
      if(text) toast('Image text indexed')
      else toast('No readable text found in this image')
    }
    return update.data
  }catch(error){
    const message=String(error?.message||error||'Image analysis failed').slice(0,500)
    await supabase.from('memory_media').update({
      analysis_status:'failed',
      analysis_error:message,
      analyzed_at:new Date().toISOString()
    }).eq('id',media.id)
    if(!quiet) toast('Image reading failed. Tap Analyze image to retry.')
    return {...media,analysis_status:'failed',analysis_error:message}
  }
}


async function latestImageEvidence(){
  const {data}=await supabase.from('memory_media').select('*').eq('media_type','image').order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(!data) return null
  conversationContext.lastImageMediaId=data.id
  const shouldRetry=data.analysis_status!=='complete'||!String(data.extracted_text||'').trim()
  const analyzed=await analyzeImageMedia(data,{force:shouldRetry})
  const signed=await supabase.storage.from('memora-media').createSignedUrl(data.storage_path,900)
  return {...analyzed,image_url:signed.data?.signedUrl||null}
}

async function knownPhoneEvidence(preferredMediaId=null){
  const processItems=async items=>{
    const evidence=[]
    for(const item of items||[]){
      let current=item
      if(item.analysis_status!=='complete'||!String(item.extracted_text||'').trim()){
        current=await analyzeImageMedia(item,{quiet:true,force:true})
      }
      const numbers=[
        ...(current.extracted_data?.phone_numbers||[]),
        ...extractPhoneNumbers(current.extracted_text||'')
      ]
      for(const number of numbers){
        if(!evidence.some(x=>x.number===number)) evidence.push({number,media:current})
      }
    }
    return evidence
  }

  if(preferredMediaId){
    const preferred=await supabase.from('memory_media').select('*').eq('id',preferredMediaId).eq('media_type','image').maybeSingle()
    const preferredEvidence=await processItems(preferred.data?[preferred.data]:[])
    if(preferredEvidence.length) return preferredEvidence
  }

  const recent=await supabase.from('memory_media').select('*').eq('media_type','image').order('created_at',{ascending:false}).limit(8)
  const imageEvidence=await processItems(recent.data||[])
  if(imageEvidence.length) return imageEvidence

  const {data:memories}=await supabase.from('memories').select('id,original_text,summary,interpreted_data,created_at').order('created_at',{ascending:false}).limit(120)
  const evidence=[]
  for(const memory of memories||[]){
    const text=[memory.original_text,memory.summary,memory.interpreted_data?.image_text].filter(Boolean).join(' ')
    for(const number of extractPhoneNumbers(text)){
      if(!evidence.some(x=>x.number===number)) evidence.push({number,media:{memory_id:memory.id,created_at:memory.created_at}})
    }
  }
  return evidence
}

function extractWorkplace(text){
  const source=String(text||'')
  const patterns=[
    /(?:started\s+)?working\s+(?:at|in|for)\s+([A-Za-z0-9][A-Za-z0-9& .'-]{1,80})/i,
    /(?:work|worked)\s+(?:at|in|for)\s+([A-Za-z0-9][A-Za-z0-9& .'-]{1,80})/i,
    /(?:employer|company)\s+(?:is|was)\s+([A-Za-z0-9][A-Za-z0-9& .'-]{1,80})/i
  ]
  for(const pattern of patterns){
    const match=source.match(pattern)
    if(match){
      return match[1].split(/\s+(?:so|and|because|since|from|as|but)\b/i)[0].replace(/[.,;:!?]+$/,'').trim()
    }
  }
  return null
}

function meaningfulTerms(question){
  const stop=new Set(['what','where','when','who','why','how','which','is','am','are','was','were','do','does','did','the','a','an','my','me','i','you','your','tell','show','know','about','please','else','can','could','would','have','has','had'])
  return String(question||'').toLowerCase().replace(/[^a-z0-9'+-]+/g,' ').split(/\s+/).filter(term=>term.length>2&&!stop.has(term))
}

function resultRelevant(question,result){
  if(!result) return false
  if(Number(result.rank||0)>=0.32) return true
  const terms=meaningfulTerms(question)
  if(!terms.length) return Number(result.rank||0)>=0.18
  const hay=(String(result.original_text||'')+' '+String(result.summary||'')).toLowerCase()
  return terms.some(term=>hay.includes(term))&&Number(result.rank||0)>=0.12
}

async function upsertStructuredFact(memory,key,category,predicate,valueText,extra={}){
  const value=String(valueText||'').trim()
  if(!value) return
  const payload={
    user_id:user.id,
    fact_key:key,
    category,
    subject:extra.subject||'self',
    predicate,
    value_text:value,
    value_json:extra.value_json||{},
    ordinal:extra.ordinal??null,
    age_relation:extra.age_relation||null,
    source_memory_id:memory?.id||extra.source_memory_id||null,
    source_media_id:extra.source_media_id||null,
    provenance_kind:extra.provenance_kind||'user_stated',
    confidence:extra.confidence??1,
    is_current:true,
    updated_at:new Date().toISOString()
  }
  const existing=await supabase.from('memory_facts').select('id').eq('fact_key',key).eq('is_current',true).maybeSingle()
  if(existing.data?.id) await supabase.from('memory_facts').update(payload).eq('id',existing.data.id)
  else await supabase.from('memory_facts').insert(payload)
}

async function syncStructuredFactsFromMemory(memory,text){
  const source=String(text||'').trim()
  if(!source) return

  const identity=source.match(/\b(?:my name is|i am|i'm)\s+([A-Z][A-Za-z .'-]{2,70}?)(?=\s+(?:and|but|from|born|working|work|at|in|,|\.|$))/i)
  if(identity) await upsertStructuredFact(memory,'identity.name','identity','name',identity[1].trim())

  const relations=['father','mother','brother','sister','wife','husband','daughter','son']
  for(const relation of relations){
    const names=relationNamesFromText(relation,source)
    let ageRelation=null
    const ageMatch=source.match(new RegExp('\\b(elder|older|younger)\\s+'+relation+'s?\\b','i'))
    if(ageMatch) ageRelation=/younger/i.test(ageMatch[1])?'younger':'elder'

    for(let i=0;i<names.length;i++){
      const key=(relation==='father'||relation==='mother'||relation==='wife'||relation==='husband')
        ?`family.${relation}`
        :`family.${relation}.${i+1}`
      await upsertStructuredFact(memory,key,'family',relation,names[i],{
        ordinal:(relation==='father'||relation==='mother'||relation==='wife'||relation==='husband')?null:i+1,
        age_relation:ageRelation
      })
    }
  }

  const workplace=extractWorkplace(source)
  if(workplace) await upsertStructuredFact(memory,'work.company','work','employer',workplace)

  const manager=source.match(/\b(?:my\s+)?(?:manager|boss|supervisor)(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{2,70})/i)
  if(manager) await upsertStructuredFact(memory,'work.manager','work','manager',manager[1].trim())

  const title=source.match(/\b(?:job title|business title|designation|role)\s+(?:is|was|as)\s+([A-Za-z][A-Za-z0-9 ,.&/'()-]{2,90})/i)
  if(title) await upsertStructuredFact(memory,'work.business_title','work','business_title',title[1].trim().replace(/[.]+$/,''))

  if(/\b(?:my\s+)?(?:phone|mobile|contact)\s*(?:number)?\b/i.test(source)){
    const numbers=extractPhoneNumbers(source)
    if(numbers[0]) await upsertStructuredFact(memory,'contact.phone.personal','contact','phone',numbers[0])
  }
}

async function syncPeopleFromMemory(memory,text){
  const rows=[]
  const seen=new Set()
  const add=(name,relationship='known person')=>{
    name=String(name||'').replace(/^[“"'\s]+|[”"'.,;!?\s]+$/g,'').replace(/\s+/g,' ').trim()
    if(!name||name.length<2||name.length>80) return
    const key=name.toLowerCase()
    if(seen.has(key)) return
    seen.add(key)
    rows.push({user_id:user.id,name,relationship,notes:'Recognized from a saved memory',first_seen_at:memory.occurred_at,last_seen_at:memory.occurred_at})
  }

  for(const relation of ['father','mother','sister','brother','wife','husband','daughter','son']){
    for(const name of relationNamesFromText(relation,text)) add(name,relation)
  }

  const patterns=[
    ['known person',/(?:met|spoke with|talked with|worked with|played .*? with|went .*? with)\s+([A-Z][A-Za-z .'-]{1,60})/ig],
    ['friend',/(?:my\s+)?friend(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,60})/ig],
    ['colleague',/(?:my\s+)?(?:colleague|coworker|co-worker)(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,60})/ig],
    ['manager',/(?:my\s+)?(?:manager|boss)(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,60})/ig],
    ['partner',/(?:my\s+)?partner(?:'s name)?\s+(?:is|was|named)\s+([A-Z][A-Za-z .'-]{1,60})/ig]
  ]
  for(const [relationship,re] of patterns){
    let match
    while((match=re.exec(String(text||'')))){
      const raw=match[1].split(/\s+(?:at|in|on|near|and|from|about|for|today|yesterday)\b/i)[0]
      add(raw,relationship)
    }
  }

  if(rows.length) await supabase.from('people').upsert(rows,{onConflict:'user_id,name',ignoreDuplicates:false})
}

async function syncPlacesFromMemory(memory,text){
  const rows=[]
  const seen=new Set()
  const add=(name,category='place')=>{
    name=String(name||'').replace(/^[“"'\s]+|[”"'.,;!?\s]+$/g,'').replace(/\s+/g,' ').trim()
    if(!name||name.length<2||name.length>90) return
    const key=name.toLowerCase()
    if(seen.has(key)) return
    seen.add(key)
    rows.push({user_id:user.id,name,category,notes:'Recognized from a saved memory',first_visited_at:memory.occurred_at,last_visited_at:memory.occurred_at})
  }

  const source=String(text||'')
  const patterns=[
    ['birth place',/(?:born|birth)\s+(?:at|in)\s+([A-Z][A-Za-z0-9 .&'’-]{2,80})/ig],
    ['visited',/(?:visited|went to|travelled to|traveled to)\s+([A-Z][A-Za-z0-9 .&'’-]{2,80})/ig],
    ['place',/(?:at|near)\s+([A-Z][A-Za-z0-9 .&'’-]{2,80})/g]
  ]
  for(const [category,re] of patterns){
    let match
    while((match=re.exec(source))){
      const raw=match[1].split(/\s+(?:and|with|where|which|who|around|from)\b/i)[0]
      add(raw,category)
    }
  }

  if(rows.length) await supabase.from('places').upsert(rows,{onConflict:'user_id,name',ignoreDuplicates:false})
}

async function reindexVaultFromMemories(){
  const {data:memories}=await supabase.from('memories').select('id,original_text,summary,occurred_at,created_at').order('created_at',{ascending:false}).limit(250)
  for(const memory of memories||[]){
    const text=[memory.original_text,memory.summary].filter(Boolean).join(' ')
    await syncPeopleFromMemory(memory,text)
    await syncPlacesFromMemory(memory,text)
  }
}

async function uploadMedia(memoryId,files){
  const uploadedRows=[]
  for(const file of files){
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path=`${user.id}/${memoryId}/${Date.now()}-${safe}`
    const upload=await supabase.storage.from('memora-media').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false})
    if(upload.error) throw upload.error
    const mediaType=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'image'
    const row=await supabase.from('memory_media').insert({
      user_id:user.id,memory_id:memoryId,storage_path:path,file_name:file.name,mime_type:file.type,media_type:mediaType,
      analysis_status:mediaType==='image'?'pending':'not_applicable'
    }).select().single()
    if(row.error) throw row.error
    uploadedRows.push(row.data)
  }
  for(const media of uploadedRows.filter(item=>item.media_type==='image')){
    await analyzeImageMedia(media,{quiet:true})
  }
  return uploadedRows
}
async function saveMemory(text,files=[],location=null){
  if(looksLikeSecret(text)) throw new Error('Sensitive credential detected. Store API keys in Sources, not Memories.')
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
  await syncPeopleFromMemory(memory,text)
  await syncPlacesFromMemory(memory,text)
  await syncStructuredFactsFromMemory(memory,text)
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
  maybeApplyContextScene(text)
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

function memoryCard(m,{compact=false}={}){
  const title=compactText(cleanAnswerText(m.summary||m.original_text||'Memory'),compact?92:140)
  const preview=compactText(cleanAnswerText(m.original_text||m.summary||''),compact?150:240)
  return `<article class="glass memory-card ${compact?'compact-card':''}" data-memory-card="${m.id}">
    <div class="memory-media hidden" data-media-slot="${m.id}"></div>
    <div class="memory-body">
      <div class="memory-top">
        <div><span class="badge">${esc(typeLabel(m.memory_type))}</span> <span class="badge alt hidden" data-media-badge="${m.id}">Media</span></div>
        <button class="kebab" data-delete-memory="${m.id}" title="Delete">•••</button>
      </div>
      <div class="memory-title">${esc(title)}</div>
      <div class="memory-original">${esc(preview)}</div>
      <div class="context-row" data-location-slot="${m.id}"></div>
      <div class="memory-footer">
        <div class="memory-meta"><span>${shortDate(m.occurred_at||m.created_at)}</span><span>•</span><span>${esc((m.provenance_kind||'user_stated').replaceAll('_',' '))}</span></div>
        <button class="memory-open" data-open-memory="${m.id}">Open</button>
      </div>
    </div>
  </article>`
}

function bindMemoryViews(memoriesList){
  const map=new Map((memoriesList||[]).map(item=>[String(item.id),item]))
  document.querySelectorAll('[data-open-memory]').forEach(button=>button.onclick=()=>{
    const memory=map.get(String(button.dataset.openMemory))
    if(!memory) return
    const title=cleanAnswerText(memory.summary||memory.original_text||'Memory')
    const original=cleanAnswerText(memory.original_text||'')
    modal(typeLabel(memory.memory_type),`
      <div class="memory-detail">
        <div class="eyebrow">${esc(shortDate(memory.occurred_at||memory.created_at))} · ${esc((memory.provenance_kind||'user_stated').replaceAll('_',' '))}</div>
        <h3>${esc(title)}</h3>
        ${original&&original!==title?`<p>${esc(original)}</p>`:''}
        <div class="filter-row" style="margin-top:14px">
          <button class="btn" data-memory-close>Close</button>
        </div>
      </div>
    `).querySelector('[data-memory-close]').onclick=event=>event.target.closest('.modal-backdrop')?.remove()
  })
}

async function home(){
  const [{count:memoryCount},{count:thingCount},{count:docCount},{data:recent},{data:profile}]=await Promise.all([
    supabase.from('memories').select('*',{count:'exact',head:true}),
    supabase.from('things').select('*',{count:'exact',head:true}),
    supabase.from('documents').select('*',{count:'exact',head:true}),
    supabase.from('memories').select('*').order('created_at',{ascending:false}).limit(3),
    supabase.from('profiles').select('display_name').maybeSingle()
  ])
  const firstName=(profile?.display_name||'').split(' ')[0]
  app.innerHTML=shell(`
    <section class="glass hero home-hero">
      <div class="hero-content">
        <div class="eyebrow">${firstName?`Hello ${esc(firstName)} · `:''}Capture anything</div>
        <h2><span class="gradient-text">Remember the detail. Find it later.</span></h2>
        <p>Text, camera, video, voice, location or a file. Memora keeps the memory, its source and the context together.</p>
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

    <section class="glass home-hub">
      <div class="home-hub-head">
        <div><div class="eyebrow">Your memory space</div><h3>Everything organized, nothing dumped.</h3></div>
        <div class="home-tabs" role="tablist">
          <button class="home-tab active" data-home-tab="overview">Overview</button>
          <button class="home-tab" data-home-tab="recent">Recent</button>
          <button class="home-tab" data-home-tab="shortcuts">Shortcuts</button>
        </div>
      </div>

      <div class="home-panel active" data-home-panel="overview">
        <div class="stat-strip">
          <button class="glass stat mini-stat" data-nav="memories" style="--accent:var(--c1)"><span>Memories</span><b>${memoryCount||0}</b><small>Open gallery</small></button>
          <button class="glass stat mini-stat" data-nav="things" style="--accent:var(--c2)"><span>Things tracked</span><b>${thingCount||0}</b><small>Find objects</small></button>
          <button class="glass stat mini-stat" data-nav="documents" style="--accent:var(--c3)"><span>Files remembered</span><b>${docCount||0}</b><small>Open documents</small></button>
        </div>

        <div class="mood-checkin ${experiencePreferences.moodCheckinsEnabled?'':'hidden'}">
          <div class="mood-copy">
            <span class="eyebrow">A small check-in</span>
            <strong>How are you feeling today?</strong>
            <small>${latestMood?`Last check-in: ${esc(moodCatalog[latestMood.mood]?.label||latestMood.mood)}`:'Memora can remember this gently and use it only when useful.'}</small>
          </div>
          <div class="mood-pills" role="group" aria-label="Mood check-in">
            ${[
              ['great','Great'],['calm','Calm'],['okay','Okay'],['low','Low'],['stressed','Stressed'],['tired','Tired'],['prayerful','Prayerful']
            ].map(([id,label])=>`<button class="mood-pill" data-mood-checkin="${id}">${label}</button>`).join('')}
          </div>
          <div class="mood-response hidden" id="moodResponse">
            <span id="moodResponseText"></span>
            <button class="btn compact primary" id="moodPlayButton">Play something for me</button>
          </div>
        </div>
      </div>

      <div class="home-panel" data-home-panel="recent">
        <div class="panel-head"><div><h3>Recent memories</h3><p class="muted">Only a preview here. Open a card for the full memory.</p></div><button class="btn" data-nav="memories">Full gallery</button></div>
        <div class="memory-grid compact-grid">${recent?.length?recent.map(m=>memoryCard(m,{compact:true})).join(''):'<div class="empty"><strong>Your universe is waiting</strong>Capture your first memory above.</div>'}</div>
      </div>

      <div class="home-panel" data-home-panel="shortcuts">
        <div class="shortcut-grid">
          <button class="shortcut-card" data-nav="ask"><span>◎</span><div><b>Ask Memora</b><small>Search and reason across your life</small></div></button>
          <button class="shortcut-card" data-nav="vault"><span>◇</span><div><b>Open Vault</b><small>People, places, things and documents</small></div></button>
          <button class="shortcut-card" data-nav="sources"><span>◉</span><div><b>Sources</b><small>AI, imports and connected data</small></div></button>
          <button class="shortcut-card" id="homeSoundscapes"><span>◌</span><div><b>Soundscapes</b><small>Rain, ocean, forest and focus</small></div></button>
        </div>
      </div>
    </section>
  `)
  wire()
  bindComposerInputs()
  renderPending()

  document.querySelectorAll('[data-home-tab]').forEach(button=>button.onclick=()=>{
    document.querySelectorAll('[data-home-tab]').forEach(x=>x.classList.toggle('active',x===button))
    document.querySelectorAll('[data-home-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.homePanel===button.dataset.homeTab))
  })

  document.getElementById('homeSoundscapes').onclick=openSoundscapePicker
  document.querySelectorAll('[data-mood-checkin]').forEach(button=>button.onclick=async()=>{
    const mood=button.dataset.moodCheckin
    document.querySelectorAll('[data-mood-checkin]').forEach(item=>item.classList.toggle('selected',item===button))
    try{
      await recordMood(mood,`Mood check-in: ${moodCatalog[mood]?.label||mood}`,'home')
      const response=document.getElementById('moodResponse')
      const text=document.getElementById('moodResponseText')
      if(text) text.textContent=`Remembered. You are feeling ${String(moodCatalog[mood]?.label||mood).toLowerCase()} today.`
      if(response) response.classList.remove('hidden')
      const play=document.getElementById('moodPlayButton')
      if(play) play.onclick=async()=>{
        play.disabled=true
        play.textContent='Finding something...'
        try{await playForMood(mood);play.textContent='Playing'}catch{play.disabled=false;play.textContent='Try audio'}
      }
    }catch(error){toast(error.message||'Could not save mood check-in')}
  })
  document.getElementById('fileBtn').onclick=()=>go('documents')
  document.getElementById('saveMemory').onclick=async()=>{
    const input=document.getElementById('memoryInput')
    let text=input.value.trim()
    if(!text&&pendingMedia.length) text='Visual memory'
    if(!text&&pendingLocation) text='Location memory'
    if(!text) return toast('Add a note, media or location first')
    if(looksLikeSecret(text)) return toast('Credential detected. Add API keys through Sources, not Memories.')

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
  bindDeletes()
  bindMemoryViews(recent||[])
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
  bindMemoryViews(all)
  await hydrateMemoryExtras(all)
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=async()=>{
    document.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'))
    button.classList.add('active')
    const filter=button.dataset.filter
    const filtered=filter==='all'?all:all.filter(m=>m.memory_type===filter)
    document.getElementById('memoryList').innerHTML=filtered.length?filtered.map(memoryCard).join(''):'<div class="glass empty"><strong>No matches</strong>Nothing in this category yet.</div>'
    bindDeletes()
    bindMemoryViews(filtered)
    await hydrateMemoryExtras(filtered)
  })
  document.getElementById('searchMemory').onclick=async()=>{
    const q=document.getElementById('memorySearch').value.trim()
    if(!q) return memories()
    const result=await supabase.rpc('search_memories',{search_query:q,result_limit:50})
    const found=result.data||[]
    document.getElementById('memoryList').innerHTML=result.error?esc(result.error.message):found.length?found.map(m=>memoryCard({...m,created_at:m.occurred_at})).join(''):'<div class="glass empty"><strong>Nothing matched</strong>Try another word or phrase.</div>'
    bindDeletes()
    bindMemoryViews(found)
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


function editDistance(a,b){
  a=String(a||'').toLowerCase()
  b=String(b||'').toLowerCase()
  const row=Array.from({length:b.length+1},(_,i)=>i)
  for(let i=1;i<=a.length;i++){
    let prev=row[0]
    row[0]=i
    for(let j=1;j<=b.length;j++){
      const hold=row[j]
      row[j]=Math.min(
        row[j]+1,
        row[j-1]+1,
        prev+(a[i-1]===b[j-1]?0:1)
      )
      prev=hold
    }
  }
  return row[b.length]
}

const intentVocabulary=[
  'image','photo','picture','screenshot','phone','mobile','contact','number',
  'where','when','who','what','which','find','show','tell','uploaded','upload',
  'sister','brother','father','mother','parent','parents','sibling','siblings',
  'wife','husband','daughter','son','work','working','employer','company',
  'memory','remember','key','wallet','passport','before','last','activity',
  'email','address','document','file','location','place','person','name'
]

const commonTypos={
  '8mage':'image','img':'image','phne':'phone','fone':'phone','numbr':'number',
  'siter':'sister','sisiter':'sister','broter':'brother','brther':'brother',
  'moter':'mother','fater':'father','wher':'where','wht':'what','wat':'what',
  'yhe':'the','teh':'the','ye':'the','uploaed':'uploaded','uploded':'uploaded',
  'remembr':'remember','memroy':'memory','wrk':'work','wrking':'working','adress':'address',
  'fo':'do','manger':'manager','mangers':'manager','managr':'manager','nme':'name','wrkng':'working',
  'eldst':'eldest','youngst':'youngest','brthr':'brother','sistr':'sister'
}

function normalizeQuestion(question){
  return String(question||'').replace(/[A-Za-z0-9']+/g,token=>{
    const lower=token.toLowerCase()
    if(commonTypos[lower]) return commonTypos[lower]
    if(intentVocabulary.includes(lower)) return lower
    if(lower.length<3) return token

    let best=null
    let bestDistance=Infinity
    for(const candidate of intentVocabulary){
      if(Math.abs(candidate.length-lower.length)>2) continue
      const distance=editDistance(lower,candidate)
      if(distance<bestDistance){
        bestDistance=distance
        best=candidate
      }
    }
    const threshold=lower.length<=4?1:lower.length<=7?2:2
    return best&&bestDistance<=threshold?best:token
  })
}

function expandSearchQuery(question){
  const q=normalizeQuestion(question)
  const lower=q.toLowerCase()
  const expansions=[]
  const groups=[
    [['work','working','job','employer','employed','company'],['work','working','job','employer','company','office','occupation']],
    [['phone','mobile','contact','number'],['phone','mobile','contact','telephone','number']],
    [['image','photo','picture','screenshot'],['image','photo','picture','screenshot','media']],
    [['sister','brother','sibling','siblings'],['sister','brother','sibling','family']],
    [['father','mother','parent','parents'],['father','mother','parent','family']],
    [['address','home','house','residence'],['address','home','house','residence','location']],
    [['born','birth','birthday','birthplace'],['born','birth','birthday','birthplace','hospital']],
    [['document','file','pdf','record'],['document','file','pdf','record']],
    [['insurance','policy','coverage'],['insurance','policy','coverage']],
    [['vehicle','car','bike','motorcycle'],['vehicle','car','bike','motorcycle']],
    [['wedding','marriage','spouse'],['wedding','marriage','spouse']]
  ]
  for(const [triggers,words] of groups){
    if(triggers.some(word=>new RegExp('\\b'+word+'\\b','i').test(lower))) expansions.push(...words)
  }
  return [q,...new Set(expansions)].join(' ')
}

async function relationshipAnswerFromVault(relation){
  let query=supabase.from('people').select('name,relationship').order('name')
  if(relation==='parents') query=query.in('relationship',['father','mother'])
  else if(relation==='siblings') query=query.in('relationship',['brother','sister'])
  else query=query.eq('relationship',relation)

  const {data}=await query
  if(!data?.length) return null

  if(relation==='parents'){
    const fathers=data.filter(x=>x.relationship==='father').map(x=>x.name)
    const mothers=data.filter(x=>x.relationship==='mother').map(x=>x.name)
    const parts=[]
    if(fathers.length) parts.push(`father: ${fathers.join(', ')}`)
    if(mothers.length) parts.push(`mother: ${mothers.join(', ')}`)
    return parts.length?`According to your memory, your ${parts.join(' and your ')}.`:null
  }

  if(relation==='siblings'){
    const brothers=data.filter(x=>x.relationship==='brother').map(x=>x.name)
    const sisters=data.filter(x=>x.relationship==='sister').map(x=>x.name)
    const parts=[]
    if(brothers.length) parts.push(`${brothers.length===1?'brother':'brothers'}: ${brothers.join(', ')}`)
    if(sisters.length) parts.push(`${sisters.length===1?'sister':'sisters'}: ${sisters.join(', ')}`)
    return parts.length?`According to your memory, your ${parts.join(' and your ')}.`:null
  }

  const names=data.map(x=>x.name)
  return `According to your memory, your ${names.length===1?relation:relation+'s'} ${names.length===1?'is':'are'} ${names.join(', ')}.`
}

function cleanAnswerText(value){
  return redactSecrets(String(value||''))
    .replace(/\\n/g,'\n')
    .replace(/\s*\{\s*\}\s*$/g,'')
    .replace(/\[object Object\]/g,'')
    .replace(/\n{3,}/g,'\n\n')
    .trim()
}

async function loadStructuredFacts(){
  const {data}=await supabase.from('memory_facts')
    .select('fact_key,category,subject,predicate,value_text,value_json,ordinal,age_relation,provenance_kind,confidence,source_memory_id,source_media_id')
    .eq('is_current',true)
    .order('fact_key')
  return data||[]
}

function factByKey(facts,key){
  return facts.find(f=>f.fact_key===key)
}

function familyFacts(facts,relation){
  return facts
    .filter(f=>f.category==='family'&&f.predicate===relation)
    .sort((a,b)=>(a.ordinal??999)-(b.ordinal??999))
}

async function answerFromStructuredFacts(question){
  const q=normalizeQuestion(question).toLowerCase()
  const facts=await loadStructuredFacts()
  if(!facts.length) return null

  const result=(text,source='Structured memory fact')=>({text,source,structured:true})

  const name=factByKey(facts,'identity.name')
  if(/\bwho am i\b|\bwhat(?:'s| is) my name\b|\btell me who i am\b/i.test(q)&&name){
    conversationContext.subject='self'
    persistConversationState()
    return result(`You are ${name.value_text}.`,'Your saved identity fact')
  }

  const phone=factByKey(facts,'contact.phone.personal')
  if(/\b(phone|mobile|contact)\s*(number)?\b|\bmy\s+number\b/i.test(q)&&phone){
    return result(`Your saved personal phone number is ${phone.value_text}.`,'Contact information extracted from your saved image')
  }

  const manager=factByKey(facts,'work.manager')
  if(/\b(manager|boss|report(?:ing)? manager)\b/i.test(q)&&manager){
    conversationContext.subject='work'
    persistConversationState()
    return result(`Your manager is ${manager.value_text}.`,'Job details extracted from your saved image')
  }

  const company=factByKey(facts,'work.company')
  const title=factByKey(facts,'work.business_title')
  const profile=factByKey(facts,'work.job_profile')
  const workLocation=factByKey(facts,'work.location')

  if(/\bwhat am i\b/i.test(q)&&(name||title||company)){
    const identity=name?`You are ${name.value_text}`:''
    const occupation=title?`a ${title.value_text}${company?` at ${company.value_text}`:''}`:(company?`working at ${company.value_text}`:'')
    const text=[identity,occupation?`For work, you are ${occupation}`:null].filter(Boolean).join('. ')+'.'
    conversationContext.subject='self'
    persistConversationState()
    return result(text,'Your saved identity and work facts')
  }

  if(/\bwhat do i do\b|\bwhat(?:'s| is) my (?:job|role|designation|profession|occupation)\b|\bwhat is my job title\b/i.test(q)){
    const bits=[]
    if(title) bits.push(`you are a ${title.value_text}`)
    if(company) bits.push(`at ${company.value_text}`)
    let text=bits.length?`For work, ${bits.join(' ')}.`:'I have work information saved for you.'
    if(profile) text+=` Your saved job profile is ${profile.value_text}.`
    conversationContext.subject='work'
    persistConversationState()
    return result(text,'Your saved work facts')
  }

  if(/\b(where|which company|what company)\b.*\b(work|working|employer|employed)\b|\bwhere do i work\b/i.test(q)&&company){
    let text=`You work at ${company.value_text}.`
    if(workLocation) text+=` Your saved work location is ${workLocation.value_text}.`
    conversationContext.subject='work'
    persistConversationState()
    return result(text,'Your saved work facts')
  }

  const father=familyFacts(facts,'father')
  const mother=familyFacts(facts,'mother')
  if(/\bparents?\b/i.test(q)&&(father.length||mother.length)){
    const parts=[]
    if(father[0]) parts.push(`your father is ${father[0].value_text}`)
    if(mother[0]) parts.push(`your mother is ${mother[0].value_text}`)
    conversationContext.relation='parents'
    persistConversationState()
    return result(parts.join(' and ')+'.','Your saved family facts')
  }

  const relation=detectRelationship(q)
  let effectiveRelation=relation
  if(!effectiveRelation&&/\b(eldest|oldest|youngest|first|second)\b/i.test(q)&&['brother','sister'].includes(conversationContext.relation)){
    effectiveRelation=conversationContext.relation
  }

  if(['brother','sister'].includes(effectiveRelation)){
    const list=familyFacts(facts,effectiveRelation)
    if(list.length){
      conversationContext.relation=effectiveRelation
      conversationContext.subject=effectiveRelation
      persistConversationState()

      const wantsEldest=/\b(eldest|oldest)\b/i.test(q)
      const wantsYoungest=/\byoungest\b/i.test(q)
      const wantsFirst=/\b(first|1st)\b/i.test(q)
      const wantsSecond=/\b(second|2nd)\b/i.test(q)

      let chosen=null
      if(wantsFirst) chosen=list.find(x=>x.ordinal===1)||list[0]
      else if(wantsSecond) chosen=list.find(x=>x.ordinal===2)||list[1]
      else if(wantsEldest) chosen=list.reduce((best,item)=>(item.ordinal??999)<(best.ordinal??999)?item:best,list[0])
      else if(wantsYoungest) chosen=list.reduce((best,item)=>(item.ordinal??0)>(best.ordinal??0)?item:best,list[0])

      if(chosen){
        const label=wantsEldest?'eldest':wantsYoungest?'youngest':wantsFirst?'first':'second'
        return result(`Your ${label} ${effectiveRelation} is ${chosen.value_text}.`,'Your saved family order')
      }

      if(/\b(elder|older|younger)\b/i.test(q)){
        const ageWord=/\b(elder|older)\b/i.test(q)?'elder':'younger'
        const matching=list.filter(x=>x.age_relation===ageWord)
        if(matching.length){
          return result(`Your ${ageWord} ${effectiveRelation}${matching.length>1?'s':''} ${matching.length>1?'are':'is'} ${matching.map(x=>x.value_text).join(', ')}.`,'Your saved family facts')
        }
      }

      return result(`Your ${effectiveRelation}${list.length>1?'s':''} ${list.length>1?'are':'is'} ${list.map(x=>x.value_text).join(', ')}.`,'Your saved family facts')
    }
  }

  if(!relation&&/\b(eldest|oldest|youngest)\b/i.test(q)){
    const siblings=[...familyFacts(facts,'brother'),...familyFacts(facts,'sister')]
    if(siblings.length){
      let chosen=null
      if(/\b(eldest|oldest)\b/i.test(q)){
        const elder=siblings.filter(x=>x.age_relation==='elder')
        chosen=(elder.length?elder:siblings).sort((a,b)=>(a.ordinal??999)-(b.ordinal??999))[0]
      }else{
        const younger=siblings.filter(x=>x.age_relation==='younger')
        const pool=younger.length?younger:siblings
        chosen=[...pool].sort((a,b)=>(b.ordinal??0)-(a.ordinal??0))[0]
      }
      if(chosen){
        conversationContext.relation=chosen.predicate
        persistConversationState()
        return result(`Your ${/\byoungest\b/i.test(q)?'youngest':'eldest'} sibling is ${chosen.value_text}.`,'Your saved family order')
      }
    }
  }

  if(relation==='father'&&father[0]) return result(`Your father is ${father[0].value_text}.`,'Your saved family facts')
  if(relation==='mother'&&mother[0]) return result(`Your mother is ${mother[0].value_text}.`,'Your saved family facts')

  return null
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
  const re=new RegExp('(?:my\\s+)?'+relationPattern+"s?(?:'s)?(?:\\s+names?)?\\s+(?:is|are|named|called)\\s+([^.;”\"\\n]+)",'ig')
  const names=[]
  let match
  while((match=re.exec(source))){
    let segment=match[1]
    segment=segment.split(/\s+and\s+(?:my|the)\s+(?:(?:first|second|third|1st|2nd|3rd)\s+)?(?:(?:younger|elder|older)\s+)?(?:father|mother|sister|brother|wife|husband|daughter|son)\b/i)[0]
    segment=segment.split(/,?\s+(?:and\s+)?(?:my|the)\s+(?:(?:first|second|third|1st|2nd|3rd)\s+)?(?:(?:younger|elder|older)\s+)?(?:father|mother|sister|brother|wife|husband|daughter|son)\b/i)[0]
    const parts=segment.split(/\s+and\s+then\s+|,\s*then\s+|\s+then\s+|\s*,\s*|\s+and\s+/i)
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

async function smartMemorySearch(query,limit=8){
  const normalized=normalizeQuestion(query)
  const expanded=expandSearchQuery(normalized)
  const universe=await supabase.rpc('search_memory_universe',{search_query:expanded,result_limit:limit})
  if(!universe.error&&universe.data?.length){
    return universe.data.map(item=>({
      id:item.entity_id,
      entity_type:item.entity_type,
      original_text:item.content||item.title,
      summary:item.title,
      memory_type:item.metadata?.memory_type||item.entity_type,
      occurred_at:item.occurred_at,
      provenance_kind:item.entity_type,
      metadata:item.metadata||{},
      rank:Number(item.rank||0)
    }))
  }

  const result=await supabase.rpc('search_memories_smart',{search_query:expanded,result_limit:limit})
  if(!result.error&&result.data?.length) return result.data
  const fallback=await supabase.rpc('search_memories',{search_query:expanded,result_limit:limit})
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

async function latestImageSignedUrl(mediaId=null){
  let query=supabase.from('memory_media').select('id,storage_path,file_name').eq('media_type','image')
  if(mediaId) query=query.eq('id',mediaId)
  const {data}=await query.order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(!data?.storage_path) return null
  const signed=await supabase.storage.from('memora-media').createSignedUrl(data.storage_path,900)
  return signed.data?.signedUrl||null
}

async function aiReasonedAnswer(question){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session?.access_token) return null

  let historySource=chat.filter(message=>!message.pending)
  const last=historySource[historySource.length-1]
  if(last?.role==='user'&&String(last.text||'').trim().toLowerCase()===String(question||'').trim().toLowerCase()){
    historySource=historySource.slice(0,-1)
  }
  const history=historySource
    .slice(-12)
    .map(message=>({role:message.role,text:redactSecrets(String(message.text||'')).slice(0,1800)}))

  const data=await fetchApi('/api/ask',{
    signal:AbortSignal.timeout(60000),
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify({question,history,mediaId:conversationContext.lastImageMediaId||null})
  })

  if(!data?.answer) return null

  let imageUrl=null
  if(data.imageUsed) imageUrl=await latestImageSignedUrl(data.imageId).catch(()=>null)
  return {
    text:data.answer,
    source:data.source||'Memora AI grounded in your saved memories',
    imageUrl,
    ai:true
  }
}

function directConversationReply(question){
  const casual=normalizeQuestion(String(question||''))
    .toLowerCase()
    .replace(/[!?.,]+$/,'')
    .replace(/\s+/g,' ')
    .trim()

  if(/^(hi|hello|hey|hey there|hello there|good morning|good afternoon|good evening|good night)$/.test(casual)){
    return 'Hello. I am here with you and ready to help with your memories, questions, plans or anything you want to talk about.'
  }
  if(/^(how are you|how r you|how are u|how r u|how're you|how are you doing|how r u doing|how is it going|how's it going|how do you feel|are you okay|are you ok)$/.test(casual)){
    return 'I am doing well and ready. You can talk to me normally too, not only ask memory questions. When you ask about your life, I will use your saved Memora memories and sources.'
  }
  if(/^(what are you doing|what r u doing|what do you do)$/.test(casual)){
    return 'Right now I am here to help you. I can chat normally, search your memories, connect related facts, find saved details and help you organize what matters.'
  }
  if(/^(thanks|thank you|thank u|thx|thanks a lot|thank you so much)$/.test(casual)){
    return 'You are welcome. This conversation stays separate from your other chats, while your Memora memory vault remains available whenever it is relevant.'
  }
  return null
}

async function answer(question){
  const rawQ=question.trim()
  const direct=directConversationReply(rawQ)
  if(direct) return {text:direct,source:'Memora conversation'}

  try{
    const structured=await answerFromStructuredFacts(rawQ)
    if(structured) return structured
  }catch(error){
    console.warn('Structured memory lookup failed',error)
  }

  let aiUnavailable=false
  try{
    const aiAnswer=await aiReasonedAnswer(rawQ)
    if(aiAnswer) return {...aiAnswer,text:cleanAnswerText(aiAnswer.text)}
    aiUnavailable=true
  }catch(error){
    aiUnavailable=true
    console.warn('Memora AI error, using local memory engine',error)
  }

  const q=normalizeQuestion(rawQ)
  const lower=q.toLowerCase()

  if(/\bwho am i\b|\bwhat(?:'s| is) my name\b|\btell me about myself\b|\btell me who i am\b/i.test(q)){
    const results=await smartMemorySearch('identity name born personal fact profile',14)
    const facts=results.filter(result=>result.entity_type==='memory'||!result.entity_type).slice(0,5)
    for(const result of facts){
      const text=String(result.original_text||result.summary||'')
      const match=text.match(/\bI am\s+([A-Z][A-Za-z .'-]{2,80}?)(?=\s+(?:and|born|working|from|at|,|\.|$))/i)
      if(match){
        conversationContext.subject=match[1].trim()
        persistConversationState()
        return {text:`You are ${match[1].trim()}. I found that in your saved personal memory.`,source:'Your stored identity memory'}
      }
    }
    const {data:profile}=await supabase.from('profiles').select('display_name').maybeSingle()
    if(profile?.display_name) return {text:`You are ${profile.display_name}.`,source:'Your Memora profile'}
  }

  if(/\b(phone|mobile|contact)\s*(number)?\b|\bmy\s+number\b/i.test(q)){
    const evidence=await knownPhoneEvidence(conversationContext.lastImageMediaId)
    if(evidence.length){
      const latest=evidence[0]
      const memory=await supabase.from('memories').select('occurred_at,created_at,summary').eq('id',latest.media.memory_id).maybeSingle()
      return {
        text:evidence.length===1
          ? `The phone number I can read from your saved image is ${latest.number}.`
          : `I found these phone numbers in your saved images: ${evidence.map(x=>x.number).join(', ')}.`,
        source:`Text extracted from your image${memory.data?.created_at?' saved '+shortDate(memory.data.created_at):''}`
      }
    }
    return {text:"I don't have a readable phone number in your saved text or images yet."}
  }

  if(/\b(image|photo|picture|screenshot)\b/i.test(q)){
    const media=await latestImageEvidence()
    if(!media) return {text:"I don't have an image memory yet."}
    const facts=await loadStructuredFacts()
    const workFacts=facts.filter(f=>f.category==='work')
    const phone=factByKey(facts,'contact.phone.personal')
    const useful=[]
    const company=factByKey(facts,'work.company')
    const manager=factByKey(facts,'work.manager')
    const title=factByKey(facts,'work.business_title')
    if(company) useful.push(`company: ${company.value_text}`)
    if(manager) useful.push(`manager: ${manager.value_text}`)
    if(title) useful.push(`business title: ${title.value_text}`)
    if(phone) useful.push(`phone: ${phone.value_text}`)
    const answer=useful.length
      ?`Your latest saved image is a work-profile screenshot. I can reliably identify ${useful.join(', ')}. Ask me about any one of these details and I will answer directly.`
      :media.analysis_status==='failed'
        ?'Your latest image is saved, but its text analysis failed. I can retry it when you ask about the image again.'
        :'Your latest image is saved. I can inspect it for a specific detail such as a name, phone number, company, address or role.'
    return {text:answer,source:'Latest saved image',imageUrl:media.image_url||null}
  }

  if(conversationContext.lastImageMediaId&&/\b(it|this|that)\b/i.test(q)&&/\b(say|read|contain|inside|there|text|detail|details|number|email)\b/i.test(q)){
    const {data:mediaRow}=await supabase.from('memory_media').select('*').eq('id',conversationContext.lastImageMediaId).maybeSingle()
    if(mediaRow){
      const analyzed=await analyzeImageMedia(mediaRow,{force:mediaRow.analysis_status!=='complete'})
      const text=String(analyzed.extracted_text||'').trim()
      const phones=analyzed.extracted_data?.phone_numbers||extractPhoneNumbers(text)
      const emails=analyzed.extracted_data?.emails||extractEmails(text)
      const pieces=[]
      if(text) pieces.push(`I can read: “${summarizeImageText(text)}”`)
      if(phones.length) pieces.push(`Phone number${phones.length>1?'s':''}: ${phones.join(', ')}.`)
      if(emails.length) pieces.push(`Email${emails.length>1?'s':''}: ${emails.join(', ')}.`)
      if(pieces.length) return {text:pieces.join(' '),source:'The image from your previous question'}
    }
  }

  if(/\b(where|which company|who)\b.*\b(work|working|employer|employed)\b|\bwhere do i work\b/i.test(lower)){
    const results=await smartMemorySearch('working work employer company',10)
    for(const result of results){
      const workplace=extractWorkplace(result.original_text)||extractWorkplace(result.summary)
      if(workplace){
        conversationContext.subject=workplace
        conversationContext.lastMemoryId=result.id
        return {text:`You are recorded as working at ${workplace}.`,source:`Your memory from ${shortDate(result.occurred_at)}`}
      }
    }
  }

  const aboutMatch=q.match(/(?:what else|what|tell me).*?(?:about me (?:in|at|with)|about)\s+([A-Za-z0-9& .'-]{2,60})\??$/i)
  if(aboutMatch){
    const subject=aboutMatch[1].trim().replace(/[?.!]+$/,'')
    const results=await smartMemorySearch(subject,12)
    const exact=results.filter(result=>{
      const hay=(String(result.original_text||'')+' '+String(result.summary||'')).toLowerCase()
      return hay.includes(subject.toLowerCase())
    })
    if(exact.length){
      conversationContext.subject=subject
      const facts=[...new Set(exact.map(x=>cleanAnswerText(x.summary||x.original_text||'')).filter(Boolean))].slice(0,5)
      if(facts.length===1){
        return {text:`For ${subject}, I currently have one specific memory: ${facts[0]}`,source:'Only matching stored memory'}
      }
      return {text:`For ${subject}, I found ${facts.length} relevant memories: ${facts.map((fact,index)=>`${index+1}. ${fact}`).join(' ')}`,source:'Matching stored memories only'}
    }
    return {text:`I don't have a relevant stored memory about ${subject} yet.`}
  }

  if(/^(what else|tell me more|anything else|more|more about (?:it|that))\??$/i.test(q)&&conversationContext.subject){
    const results=await smartMemorySearch(conversationContext.subject,12)
    const relevant=results.filter(result=>result.id!==conversationContext.lastMemoryId&&resultRelevant(conversationContext.subject,result))
    if(relevant.length){
      const next=relevant[0]
      conversationContext.lastMemoryId=next.id
      persistConversationState()
      return {text:`Another relevant memory about ${conversationContext.subject} is: ${cleanAnswerText(next.summary||next.original_text)}`,source:'Related stored memory'}
    }
    return {text:`I don't have another relevant stored memory about ${conversationContext.subject} yet.`}
  }

  const relation=detectRelationship(q)
  if(relation){
    conversationContext.relation=relation
    persistConversationState()
    const vaultAnswer=await relationshipAnswerFromVault(relation)
    if(vaultAnswer) return {text:vaultAnswer,source:'People recognized from your stored memories'}
    let relationQuery=relation
    if(relation==='parents') relationQuery='father mother parents'
    if(relation==='siblings') relationQuery='brother sister siblings'
    const memories=await smartMemorySearch(relationQuery,10)
    const response=relationshipAnswer(relation,memories)
    if(response) return {text:response,source:'Your stored personal memory'}
  }

  let match=q.match(/where (?:is|did i (?:keep|put|leave)) (?:my )?(.+?)(?:\?|$)/i)
  if(match){
    let thingName=match[1].trim()
    if(/^(?:it|that|this)$/i.test(thingName)&&conversationContext.thing) thingName=conversationContext.thing
    const thing=await findThing(thingName)
    if(!thing) return {text:`I don't have a current location recorded for your ${thingName}.`}
    conversationContext.thing=thing.name
    return {text:`Your ${thing.name} is currently recorded at ${thing.current_location}.`,source:'Latest object-location memory'}
  }

  match=q.match(/where was (?:(?:my )?(.+?)|it|that|this) before(?:\?|$)/i)
  if(match||/where was (?:it|that|this) before/i.test(lower)){
    let thingName=match?.[1]?.trim()||conversationContext.thing
    if(thingName&&/^(?:it|that|this)$/i.test(thingName)) thingName=conversationContext.thing
    if(!thingName) return {text:'Tell me which item you mean.'}
    const thing=await findThing(thingName)
    if(!thing) return {text:"I don't have a location history for that item yet."}
    conversationContext.thing=thing.name
    const {data}=await supabase.from('thing_locations').select('*').eq('thing_id',thing.id).order('recorded_at',{ascending:false}).limit(2)
    if(!data||data.length<2) return {text:`I know where your ${thing.name} is now, but I do not have an earlier location yet.`}
    return {text:`Before ${data[0].location}, your ${thing.name} was recorded at ${data[1].location}.`,source:`Location history from ${shortDate(data[1].recorded_at)}`}
  }

  match=q.match(/when did i last (.+?)(?:\?|$)/i)
  if(match){
    const data=await smartMemorySearch(match[1].trim(),8)
    const relevant=data.filter(result=>resultRelevant(match[1],result))
    if(!relevant.length) return {text:"I don't have a relevant memory about that yet."}
    return {text:`The most recent relevant memory is: “${cleanAnswerText(relevant[0].summary||relevant[0].original_text)}” from ${when(relevant[0].occurred_at)}.`,source:'Most relevant stored memory'}
  }

  if(aiUnavailable) return {
    text:'AI reasoning is currently unavailable. Check your AI provider connection in Sources and try again. You can still ask for specific saved details, such as your manager or an item’s location.',
    source:'AI connection unavailable'
  }

  const data=await smartMemorySearch(q,8)
  const relevant=data.filter(result=>resultRelevant(q,result))
  if(!relevant.length) return {text:"I don't have a relevant memory for that question yet."}
  const best=relevant[0]
  conversationContext.lastMemoryId=best.id
  conversationContext.subject=best.summary||conversationContext.subject

  if(best.entity_type==='person'){
    const relation=best.metadata?.relationship
    return {text:relation?`${best.summary} is recorded as your ${relation}.`:`I found ${best.summary} in the people connected to your memories.`,source:'People in your memory vault'}
  }
  if(best.entity_type==='place'){
    return {text:`I found ${best.summary} in the places connected to your memories.`,source:'Places in your memory vault'}
  }
  if(best.entity_type==='thing'){
    const location=best.metadata?.current_location
    return {text:location?`Your ${best.summary} is currently recorded at ${location}.`:`I found ${best.summary} in your tracked things.`,source:'Things in your memory vault'}
  }
  if(best.entity_type==='document'){
    return {text:`I found the document “${best.summary}” in your memory vault.`,source:'Your stored documents'}
  }

  const clean=cleanAnswerText(best.summary||best.original_text||'')
  return {text:clean?`I found this relevant memory: ${clean}`:"I found a relevant memory, but it does not contain a clean answer to that question.",source:`Stored memory from ${shortDate(best.occurred_at)}`}
}
function thinkingMarkup(){
  return `
    <div class="thinking-card">
      <div class="thinking-orb"><span></span><span></span><span></span></div>
      <div>
        <strong class="thinking-status">Searching your memories</strong>
        <small>Connecting facts, context and sources</small>
      </div>
    </div>`
}

function renderChatMessage(message,index){
  if(message.pending){
    return `<div class="bubble assistant thinking-bubble" data-thinking-index="${index}">${thinkingMarkup()}</div>`
  }
  const classes=`bubble ${message.role==='user'?'user':'assistant'} ${message.fresh?'fresh':''}`
  const action=message.action?.type
    ?`<div class="chat-action-row"><button class="chat-action" data-chat-action="${esc(message.action.type)}" data-chat-mood="${esc(message.action.mood||'')}" data-chat-query="${esc(message.action.query||'')}">${esc(message.action.label||'Open')}</button></div>`
    :''
  return `<div class="${classes}">${message.imageUrl?`<img class="chat-evidence-image" src="${esc(message.imageUrl)}" alt="Memory evidence">`:''}<div class="bubble-text">${esc(cleanAnswerText(message.text))}</div>${action}${message.ai?'<div class="answer-engine"><span class="live-dot"></span>Memora reasoning</div>':''}${message.source?`<div class="source">Source: ${esc(message.source)}</div>`:''}</div>`
}

function startThinkingAnimation(){
  const el=document.querySelector('.thinking-status')
  if(!el) return ()=>{}
  const steps=['Searching your memories','Connecting people and facts','Checking recent context','Reasoning over the evidence','Preparing a clean answer']
  let index=0
  const timer=setInterval(()=>{
    index=(index+1)%steps.length
    el.classList.remove('swap')
    void el.offsetWidth
    el.textContent=steps[index]
    el.classList.add('swap')
  },850)
  return ()=>clearInterval(timer)
}

async function ask({reload=true}={}){
  if(reload) await ensureChatThread()
  await loadChatThreads()
  const currentThread=chatThreads.find(item=>item.id===currentThreadId)||{title:'New chat'}

  const threadList=chatThreads.slice(0,30).map(thread=>`
    <div class="chat-thread ${thread.id===currentThreadId?'active':''}" data-thread-id="${thread.id}">
      <button class="thread-open" data-open-thread="${thread.id}">
        <strong>${esc(thread.title||'New chat')}</strong>
        <small>${shortDate(thread.last_message_at||thread.updated_at||thread.created_at)}</small>
      </button>
      <button class="thread-menu" data-thread-menu="${thread.id}" aria-label="Chat options">•••</button>
    </div>
  `).join('')

  app.innerHTML=shell(`
    <div class="ask-layout">
      <button class="chat-drawer-scrim" id="chatDrawerScrim" aria-label="Close chats"></button>
      <aside class="glass chat-sidebar" id="chatSidebar">
        <div class="chat-sidebar-head">
          <div><div class="eyebrow">Conversations</div><h3>Your chats</h3></div>
          <button class="btn primary compact" id="newChatButton">＋ New</button>
        </div>
        <div class="thread-list">${threadList||'<div class="empty compact-empty">No chats yet.</div>'}</div>
      </aside>

      <div class="ask-main">
        <div class="ask-intelligence glass">
          <button class="thread-toggle" id="threadToggle" aria-label="Open chats">☰</button>
          <div class="intelligence-orb"><span></span></div>
          <div class="ask-title-block">
            <strong>${esc(currentThread.title||'New chat')}</strong>
            <small>Shared memory vault, separate conversation context</small>
          </div>
          <span class="status live">Ready</span>
        </div>

        <div class="glass chat-panel">
          <div class="filter-row ask-suggestions">
            <button class="chip" data-ask-suggestion="How are you?">Talk</button>
            <button class="chip" data-ask-suggestion="What do you remember about me?">About me</button>
            <button class="chip" data-ask-suggestion="Who is my manager?">My manager</button>
            <button class="chip" data-ask-suggestion="What can you tell me about my latest image?">Latest image</button>
          </div>
          <div class="chat" id="chat">${chat.length?chat.map(renderChatMessage).join(''):'<div class="empty companion-empty"><strong>How is your day going?</strong>Talk naturally, share something you want remembered, ask a question, or let Memora search your private memory vault when it is relevant.</div>'}</div>
        </div>

        <div class="glass ask-box">
          <input class="input" id="askInput" autocomplete="off" placeholder="Talk to Memora or ask anything">
          <button class="btn voice-btn" id="askVoice" aria-label="Speak to Memora">Mic</button>
          <button class="btn primary" id="askButton">Ask</button>
        </div>
      </div>
    </div>
  `,'Ask Memora','Separate conversations, one shared personal memory.')
  wire()

  const sidebar=document.getElementById('chatSidebar')
  const scrim=document.getElementById('chatDrawerScrim')
  const toggleDrawer=force=>{
    const open=typeof force==='boolean'?force:!sidebar.classList.contains('open')
    sidebar.classList.toggle('open',open)
    scrim.classList.toggle('open',open)
  }
  document.getElementById('threadToggle').onclick=()=>toggleDrawer()
  scrim.onclick=()=>toggleDrawer(false)

  requestAnimationFrame(()=>{
    const chatEl=document.getElementById('chat')
    if(chatEl) chatEl.scrollTop=chatEl.scrollHeight
  })

  document.getElementById('newChatButton').onclick=async()=>{
    await createChatThread('New chat')
    await go('ask',false,{push:true})
  }

  document.querySelectorAll('[data-open-thread]').forEach(button=>button.onclick=async event=>{
    event.stopPropagation()
    const threadId=button.dataset.openThread
    if(threadId===currentThreadId){toggleDrawer(false);return}
    await loadChatThread(threadId)
    await go('ask',false,{push:true})
  })

  document.querySelectorAll('[data-thread-menu]').forEach(button=>button.onclick=event=>{
    event.stopPropagation()
    const threadId=button.dataset.threadMenu
    const thread=chatThreads.find(item=>item.id===threadId)
    const box=modal('Conversation options',`
      <p class="muted">${esc(thread?.title||'Conversation')}</p>
      <div class="grid two">
        <button class="btn" id="renameThread">Rename</button>
        <button class="btn danger" id="deleteThread">Delete chat</button>
      </div>
    `)
    box.querySelector('#renameThread').onclick=async()=>{
      const next=prompt('Rename conversation',thread?.title||'New chat')
      if(!next) return
      await renameChatThread(threadId,next)
      box.remove()
      await ask()
    }
    box.querySelector('#deleteThread').onclick=async()=>{
      if(!confirm('Delete this conversation? Your saved memories will not be deleted.')) return
      await deleteChatThread(threadId)
      box.remove()
      await go('ask',false,{replace:true,push:false})
    }
  })

  const submit=async()=>{
    const input=document.getElementById('askInput')
    const q=input.value.trim()
    if(!q) return

    if(looksLikeSecret(q)){
      input.value=''
      const safe='I detected what looks like an API key or credential. For safety I will not save it in chat or memory. Add credentials through Sources instead.'
      chat.push({role:'assistant',text:safe,source:'Memora security',fresh:true})
      await saveChatMessage('assistant',safe,{source:'Memora security'})
      await ask()
      return
    }

    input.value=''
    chat=chat.map(message=>({...message,fresh:false}))
    const userMessage={role:'user',text:q,created_at:new Date().toISOString()}
    chat.push(userMessage)
    await saveChatMessage('user',q)

    const detectedMood=detectMoodStatement(q)
    if(detectedMood){
      try{await recordMood(detectedMood,q,'chat')}catch(error){console.warn('Mood save failed',error)}
    }

    let autoMemorySaved=false
    const rememberable=!detectedMood?detectRememberableStatement(q):null
    if(rememberable){
      try{
        await saveMemory(rememberable)
        autoMemorySaved=true
      }catch(error){
        console.warn('Conversational memory save failed',error)
      }
    }

    const directReply=directConversationReply(q)
    if(directReply){
      const directMessage={role:'assistant',text:directReply,source:'Memora conversation',fresh:true,created_at:new Date().toISOString()}
      chat.push(directMessage)
      await saveChatMessage('assistant',directReply,directMessage)
      await ask({reload:false})
      return
    }

    chat.push({role:'assistant',pending:true,text:''})
    await ask({reload:false})
    const stopThinking=startThinkingAnimation()

    try{
      const response=await answer(q)
      stopThinking()
      chat=chat.filter(message=>!message.pending)
      let responseText=cleanAnswerText(response.text)
      let action=response.action||null
      if(autoMemorySaved&&!/saved|remembered|stored.*memory/i.test(responseText)){
        responseText+=` I’ve saved that to your Memora memory.`
      }
      if(detectedMood){
        const label=moodCatalog[detectedMood]?.label||detectedMood
        if(/don't have a relevant|do not have a relevant|nothing matched/i.test(responseText)){
          responseText=`I hear you. I’ve saved this as your ${label.toLowerCase()} mood check-in. Would you like me to play something that fits how you’re feeling?`
        }else{
          if(!/saved|remembered|mood check-in/i.test(responseText)) responseText+=` I’ve also saved this as your ${label.toLowerCase()} mood check-in.`
          if(!/music|audio|play something|listen/i.test(responseText)) responseText+=' If you want, I can play something that fits this mood.'
        }
        action={type:'mood_audio',mood:detectedMood,label:'Play something for this mood'}
      }
      const finalMessage={role:'assistant',...response,text:responseText,action,fresh:true,created_at:new Date().toISOString()}
      chat.push(finalMessage)
      await saveChatMessage('assistant',finalMessage.text,finalMessage)
      maybeApplyContextScene(q+' '+finalMessage.text)
    }catch(error){
      stopThinking()
      chat=chat.filter(message=>!message.pending)
      const failure={role:'assistant',text:'I could not complete that lookup just now. Your saved memories are safe, so please try the question again.',source:'Memora',fresh:true}
      chat.push(failure)
      await saveChatMessage('assistant',failure.text,failure)
    }
    await ask()
  }

  document.getElementById('askButton').onclick=submit
  document.getElementById('askInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}
  document.getElementById('askVoice').onclick=()=>{
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition
    if(!Recognition) return toast('Voice dictation is not supported by this browser yet')
    const recognition=new Recognition()
    recognition.lang=navigator.language||'en-US'
    recognition.interimResults=true
    recognition.continuous=false
    const voiceButton=document.getElementById('askVoice')
    const input=document.getElementById('askInput')
    voiceButton.classList.add('listening')
    voiceButton.textContent='Listening'
    recognition.onresult=event=>{
      const transcript=[...event.results].map(result=>result[0]?.transcript||'').join(' ').trim()
      if(transcript) input.value=transcript
    }
    recognition.onerror=()=>toast('I could not hear that clearly')
    recognition.onend=()=>{
      voiceButton.classList.remove('listening')
      voiceButton.textContent='Mic'
      input.focus()
    }
    recognition.start()
  }
  document.querySelectorAll('[data-ask-suggestion]').forEach(button=>button.onclick=()=>{
    document.getElementById('askInput').value=button.dataset.askSuggestion
    submit()
  })
  document.querySelectorAll('[data-chat-action]').forEach(button=>button.onclick=async()=>{
    if(button.dataset.chatAction==='mood_audio'){
      button.disabled=true
      button.textContent='Finding something...'
      try{
        await playForMood(button.dataset.chatMood||'calm')
        button.textContent='Playing'
      }catch(error){
        button.disabled=false
        button.textContent='Try audio'
        toast('I could not start that audio just now')
      }
    }
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
  await reindexVaultFromMemories()
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
  await reindexVaultFromMemories()
  const {data}=await supabase.from('people').select('*').order('name')
  app.innerHTML=shell(`<div class="vault-grid">${data?.length?data.map(p=>`<div class="glass vault-card"><div class="vault-icon">◎</div><h3>${esc(p.name)}</h3><p>${esc(p.relationship||'Person from your memories')}</p><div class="memory-meta">Last seen ${when(p.last_seen_at||p.created_at)}</div></div>`).join(''):'<div class="glass empty"><strong>No people yet</strong>Mention someone in a memory and they can appear here.</div>'}</div>`,'People')
  wire()
}

async function places(){
  await reindexVaultFromMemories()
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

async function loadZip(file){
  const module=await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')
  const JSZip=module.default||module
  return await JSZip.loadAsync(file)
}

async function importChatGPT(file){
  let conversations=[]
  if(/\.zip$/i.test(file.name)||file.type==='application/zip'){
    const zip=await loadZip(file)
    const entries=Object.values(zip.files).filter(entry=>!entry.dir&&/(^|\/)conversations(?:[-_0-9]*)?\.json$/i.test(entry.name))
    if(!entries.length) throw new Error('No conversations JSON was found in this ChatGPT export ZIP.')
    for(const entry of entries.slice(0,25)){
      const parsed=JSON.parse(await entry.async('text'))
      if(Array.isArray(parsed)) conversations.push(...parsed)
      else if(Array.isArray(parsed?.conversations)) conversations.push(...parsed.conversations)
    }
  }else{
    const parsed=JSON.parse(await file.text())
    conversations=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.conversations)?parsed.conversations:[])
  }

  if(!conversations.length) throw new Error('I could not find ChatGPT conversations in this export.')
  const source=await supabase.from('sources').insert({
    user_id:user.id,
    source_type:'chatgpt_import',
    source_name:file.name,
    metadata:{imported_at:new Date().toISOString(),count:conversations.length}
  }).select().single()
  if(source.error) throw source.error

  let imported=0
  for(const conversation of conversations.slice(0,250)){
    const body=extractConversationText(conversation)
    if(!body) continue
    const title=conversation.title||'Imported ChatGPT conversation'
    const result=await supabase.from('memories').insert({
      user_id:user.id,
      original_text:body,
      summary:title,
      memory_type:'conversation',
      state:'historical',
      occurred_at:conversation.create_time?new Date(conversation.create_time*1000).toISOString():new Date().toISOString(),
      source_type:'import',
      provenance_kind:'imported',
      source_id:source.data.id,
      confidence:1,
      interpreted_data:{source:'ChatGPT export',title}
    })
    if(!result.error) imported++
  }
  return imported
}

async function importWhatsApp(file){
  let raw=''
  if(/\.zip$/i.test(file.name)||file.type==='application/zip'){
    const zip=await loadZip(file)
    const entries=Object.values(zip.files).filter(entry=>!entry.dir&&/\.txt$/i.test(entry.name))
    const chatFile=entries.find(entry=>/(^|\/)_chat\.txt$/i.test(entry.name))||entries[0]
    if(!chatFile) throw new Error('No WhatsApp chat text file was found in this ZIP.')
    raw=(await chatFile.async('text')).trim()
  }else{
    raw=(await file.text()).trim()
  }

  if(!raw) throw new Error('This WhatsApp export appears empty.')
  const source=await supabase.from('sources').insert({
    user_id:user.id,
    source_type:'whatsapp_import',
    source_name:file.name,
    metadata:{imported_at:new Date().toISOString()}
  }).select().single()
  if(source.error) throw source.error

  const chunks=[]
  for(let i=0;i<raw.length;i+=7000) chunks.push(raw.slice(i,i+7000))
  let imported=0
  for(let i=0;i<Math.min(chunks.length,100);i++){
    const result=await supabase.from('memories').insert({
      user_id:user.id,
      original_text:chunks[i],
      summary:`WhatsApp conversation import · part ${i+1}`,
      memory_type:'conversation',
      state:'historical',
      occurred_at:new Date().toISOString(),
      source_type:'import',
      provenance_kind:'imported',
      source_id:source.data.id,
      confidence:1,
      interpreted_data:{source:'WhatsApp export',file_name:file.name,part:i+1}
    })
    if(!result.error) imported++
  }
  return imported
}

async function getConnectionMap(){
  const {data}=await supabase.from('connections').select('*').order('updated_at',{ascending:false})
  return Object.fromEntries((data||[]).map(item=>[item.provider,item]))
}

async function connectAiProvider(provider,label){
  const body=`
    <p class="muted">Optional BYOK connection for ${esc(label)}. The key is sent only to an authenticated server function, verified with the provider, and stored encrypted in Supabase Vault.</p>
    <input class="input" id="providerKey" type="password" autocomplete="off" placeholder="${esc(label)} API key">
    <div class="filter-row" style="margin-top:12px">
      <button class="btn primary" id="connectProvider">Connect securely</button>
      <span class="muted" id="providerStatus"></span>
    </div>`
  const box=modal(`Connect ${label}`,body)
  box.querySelector('#connectProvider').onclick=async()=>{
    const api_key=box.querySelector('#providerKey').value.trim()
    const status=box.querySelector('#providerStatus')
    if(!api_key) return status.textContent='Enter the API key first.'
    status.textContent='Verifying...'
    const {data,error}=await supabase.functions.invoke('connect-ai-provider',{body:{action:'connect',provider,api_key}})
    box.querySelector('#providerKey').value=''
    if(error||data?.error) return status.textContent=data?.error||error.message
    status.textContent='Connected.'
    setTimeout(()=>{box.remove();sources()},500)
  }
}

async function disconnectAiProvider(provider){
  const {data,error}=await supabase.functions.invoke('connect-ai-provider',{body:{action:'disconnect',provider}})
  if(error||data?.error) return toast(data?.error||error.message)
  toast('Provider disconnected')
  sources()
}

async function checkMemoraBackend(){
  try{
    const response=await fetch('/api/health',{cache:'no-store'})
    if(!response.ok) return {ok:false,aiGateway:false}
    return await response.json()
  }catch{
    return {ok:false,aiGateway:false}
  }
}

function oauthSetupModal(provider){
  const isGoogle=provider==='google'
  modal(isGoogle?'Google Workspace connection':'Microsoft 365 connection',`
    <p class="muted">The Memora connector flow is ready for this source, but the provider requires a one-time OAuth application registration owned by you before a live account can be authorized.</p>
    <div class="filter-row">
      <span class="chip active">${isGoogle?'Gmail':'Outlook'}</span>
      <span class="chip">${isGoogle?'Calendar':'Calendar'}</span>
      <span class="chip">${isGoogle?'Drive':'OneDrive'}</span>
      <span class="chip">${isGoogle?'Photos':'SharePoint'}</span>
    </div>
    <p class="small muted" style="margin-top:14px">Memora will request read-only permissions first. Provider tokens must stay server-side and will never be written into the browser code.</p>
  `)
}

function sourceInfo(kind){
  const info={
    openai:{
      title:'OpenAI and GPT agents',
      body:'Memora is designed to connect through the current OpenAI Responses and agent stack. A real live connection needs a secure server-side API key or OAuth style integration. The key must never be stored in browser JavaScript.'
    },
    google:{
      title:'Google Workspace',
      body:'Gmail, Calendar, Drive and Photos can be connected with Google OAuth. Reading personal Gmail or Drive data requires additional scopes and secure refresh-token storage on the server.'
    },
    microsoft:{
      title:'Microsoft 365',
      body:'Outlook, Calendar, OneDrive and SharePoint can be connected through Microsoft Graph. This requires an Entra application registration, delegated permissions and secure token handling.'
    },
    claude:{
      title:'Claude',
      body:'Claude can be supported through export import and a server-side API integration. A future secure AI gateway can let users choose Claude as a reasoning provider without changing Memora storage.'
    },
    gemini:{
      title:'Gemini',
      body:'Gemini can be supported through a server-side Google AI integration. This connector is separated from Google Workspace access so AI permissions and personal-data permissions remain clear.'
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
  const [connections,health,lastAiResult,authProviders]=await Promise.all([
    getConnectionMap(),
    checkMemoraBackend(),
    supabase.from('ai_request_logs').select('status,model,latency_ms,error_code,error_message,used_image,created_at').order('created_at',{ascending:false}).limit(1).maybeSingle(),
    getAuthProviderSettings()
  ])
  const lastAi=lastAiResult.data||null
  const connectedCount=Object.values(connections).filter(item=>item.status==='connected').length
  const socialEnabled=['google','apple','facebook','azure','github'].filter(provider=>authProviders?.[provider]).length
  const aiHealthy=lastAi?.status==='success'
  const openAiConnected=connections.openai?.status==='connected'
  const aiAvailable=Boolean(health.aiGateway||openAiConnected)
  const aiLabel=aiHealthy?'Last call passed':openAiConnected?'OpenAI ready':lastAi?.status==='error'?'Last call failed':health.aiGateway?'Gateway ready':'Check setup'

  const providerButton=(provider,label)=>{
    const connection=connections[provider]
    if(connection?.status==='connected'){
      return `<button class="btn" data-disconnect-provider="${provider}">Disconnect ${esc(label)}</button>`
    }
    return `<button class="btn primary" data-connect-provider="${provider}" data-provider-label="${esc(label)}">Connect API</button>`
  }

  app.innerHTML=shell(`
    <div class="glass source-hero">
      <div>
        <div class="eyebrow">Intelligence and data sources</div>
        <h3>Memora now has a built-in reasoning brain.</h3>
        <p>Ask Memora reasons over your private memory vault. It can use Vercel AI Gateway when configured, or your securely connected OpenAI API key.</p>
      </div>
      <div class="source-summary"><b>${aiAvailable?'LIVE':'CHECK'}</b><span>${openAiConnected?'OpenAI ready':'AI reasoning'}</span></div>
    </div>

    <div class="glass source-tabs" role="tablist">
      <button class="source-tab active" data-source-tab="ai">AI reasoning</button>
      <button class="source-tab" data-source-tab="accounts">Accounts and live data</button>
      <button class="source-tab" data-source-tab="imports">Imports and files</button>
      <button class="source-tab" data-source-tab="all">Show all</button>
    </div>

    <div class="source-grid">
      <div class="glass source-card">
        <span class="status ${aiHealthy||(!lastAi&&health.aiGateway)?'live':''}">${esc(aiLabel)}</span>
        <div class="source-icon">✦</div>
        <h3>Memora AI</h3>
        <p>Your reasoning layer. Memora uses Vercel AI Gateway when available and securely falls back to your connected OpenAI API key. Both paths stay grounded in your memories.</p>
        <div class="ai-diagnostic" id="aiDiagnostic">
          ${lastAi
            ?`<strong>${lastAi.status==='success'?'Reasoning healthy':'Needs attention'}</strong><span>${lastAi.status==='success'
                ?`${esc(lastAi.model||'AI Gateway')} · ${(Number(lastAi.latency_ms||0)/1000).toFixed(1)}s`
                :esc(lastAi.error_message||lastAi.error_code||'Last reasoning call failed')}</span>`
            :'<strong>No live reasoning test yet</strong><span>Run the test below while signed in.</span>'}
        </div>
        <div class="source-actions"><button class="btn primary" data-nav="ask">Ask Memora</button><button class="btn" id="testMemoraAi">Run AI test</button></div>
      </div>

      <div class="glass source-card">
        <span class="status ${connections.openai?.status==='connected'?'live':''}">${connections.openai?.status==='connected'?'Connected':'Optional'}</span>
        <div class="source-icon">AI</div>
        <h3>OpenAI API</h3>
        <p>Your OpenAI API key is stored encrypted in Supabase Vault and now powers Ask Memora when Vercel AI Gateway is unavailable. OpenAI API charges are separate from ChatGPT Plus.</p>
        <div class="source-actions">${providerButton('openai','OpenAI')}</div>
      </div>

      <div class="glass source-card">
        <span class="status ${connections.gemini?.status==='connected'?'live':''}">${connections.gemini?.status==='connected'?'Connected':'Optional'}</span>
        <div class="source-icon">Gm</div>
        <h3>Gemini API</h3>
        <p>Optional Google AI reasoning provider, separate from your Google Workspace data permissions.</p>
        <div class="source-actions">${providerButton('gemini','Gemini')}</div>
      </div>

      <div class="glass source-card">
        <span class="status ${connections.anthropic?.status==='connected'?'live':''}">${connections.anthropic?.status==='connected'?'Connected':'Optional'}</span>
        <div class="source-icon">C</div>
        <h3>Claude API</h3>
        <p>Optional Anthropic reasoning provider with secure server-side credential storage.</p>
        <div class="source-actions">${providerButton('anthropic','Claude')}</div>
      </div>

      <div class="glass source-card">
        <span class="status">OAuth app required</span>
        <div class="source-icon">G</div>
        <h3>Google Workspace</h3>
        <p>Gmail, Calendar, Drive and Photos. The connector is designed for read-only consent first.</p>
        <div class="source-actions"><button class="btn primary" id="googleSetup">Connect Google</button></div>
      </div>

      <div class="glass source-card">
        <span class="status">OAuth app required</span>
        <div class="source-icon">M</div>
        <h3>Microsoft 365</h3>
        <p>Outlook, Calendar, OneDrive and SharePoint through Microsoft Graph delegated permissions.</p>
        <div class="source-actions"><button class="btn primary" id="microsoftSetup">Connect Microsoft</button></div>
      </div>

      <div class="glass source-card">
        <span class="status live">Device live</span>
        <div class="source-icon">⌖</div>
        <h3>Maps and location</h3>
        <p>Attach your current location to a memory from the capture bar. Continuous history remains opt-in.</p>
        <div class="source-actions"><button class="btn" data-nav="home">Capture with location</button></div>
      </div>

      <div class="glass source-card">
        <span class="status">Business API</span>
        <div class="source-icon">W</div>
        <h3>WhatsApp</h3>
        <p>Personal WhatsApp does not provide a live chat-history connection to Memora. Export a chat and import the TXT or ZIP here. Live automation is a separate WhatsApp Business API setup.</p>
        <div class="source-actions"><button class="btn primary" id="whatsappImportBtn">Import WhatsApp export</button><button class="btn ghost" id="whatsappInfo">Business API setup</button><input class="hidden" id="whatsappFile" type="file" accept=".txt,.zip,text/plain,application/zip"></div>
      </div>

      <div class="glass source-card">
        <span class="status live">Works now</span>
        <div class="source-icon">▣</div>
        <h3>Files and documents</h3>
        <p>PDFs, screenshots, receipts and other files can become source-backed memories.</p>
        <div class="source-actions"><button class="btn primary" id="filesJump">Open Documents</button></div>
      </div>

      <div class="glass source-card">
        <span class="status live">Import works now</span>
        <div class="source-icon">↥</div>
        <h3>ChatGPT history</h3>
        <p>Your OpenAI API key does not include your ChatGPT chats. Import your official ChatGPT data export ZIP or conversations JSON here instead.</p>
        <div class="source-actions"><button class="btn primary" id="chatgptImportBtn">Import ChatGPT export</button><input class="hidden" id="chatgptFile" type="file" accept=".zip,.json,application/zip,application/json"></div>
      </div>
    </div>

    <div class="glass" style="padding:16px;border-radius:20px;margin-top:16px">
      <b>${connectedCount} optional AI provider connection${connectedCount===1?'':'s'} active · ${socialEnabled} social sign-in provider${socialEnabled===1?'':'s'} enabled</b>
      <div class="muted small" style="margin-top:5px">Ask Memora uses your connected AI provider. Saved memory search remains available when AI is unavailable.</div>
      <div id="sourceMsg" class="muted" style="margin-top:8px"></div>
    </div>
  `,'Source Universe','Live AI, optional provider APIs, device context and external data connectors.')
  wire()

  const sourceGroups={
    ai:new Set(['Memora AI','OpenAI API','Gemini API','Claude API']),
    accounts:new Set(['Google Workspace','Microsoft 365','Maps and location']),
    imports:new Set(['WhatsApp','Files and documents','ChatGPT history'])
  }
  document.querySelectorAll('.source-card').forEach(card=>{
    const title=card.querySelector('h3')?.textContent?.trim()||''
    card.dataset.sourceGroup=Object.entries(sourceGroups).find(([,titles])=>titles.has(title))?.[0]||'accounts'
  })
  const applySourceTab=tab=>{
    document.querySelectorAll('[data-source-tab]').forEach(button=>button.classList.toggle('active',button.dataset.sourceTab===tab))
    document.querySelectorAll('.source-card').forEach(card=>card.classList.toggle('hidden',tab!=='all'&&card.dataset.sourceGroup!==tab))
  }
  document.querySelectorAll('[data-source-tab]').forEach(button=>button.onclick=()=>applySourceTab(button.dataset.sourceTab))
  applySourceTab('ai')

  document.getElementById('testMemoraAi').onclick=async()=>{
    const target=document.getElementById('aiDiagnostic')
    target.innerHTML='<strong>Running live reasoning test...</strong><span>Authenticating, retrieving a saved identity fact and asking the server-side model.</span>'
    try{
      const response=await aiReasonedAnswer('Using my saved memory, answer only this question naturally: What is my name?')
      if(!response?.text) throw new Error('No AI response returned')
      const latest=await supabase.from('ai_request_logs').select('status,model,latency_ms,error_message,created_at').order('created_at',{ascending:false}).limit(1).maybeSingle()
      const row=latest.data
      target.innerHTML=`<strong>${row?.status==='success'?'Live reasoning passed':'AI answered'}</strong><span>${esc(cleanAnswerText(response.text))}${row?.latency_ms?` · ${(Number(row.latency_ms)/1000).toFixed(1)}s`:''}</span>`
      toast('Memora AI test completed')
    }catch(error){
      const latest=await supabase.from('ai_request_logs').select('status,error_message,error_code,created_at').order('created_at',{ascending:false}).limit(1).maybeSingle()
      target.innerHTML=`<strong>Live reasoning failed</strong><span>${esc(latest.data?.error_message||error.message||'Unknown error')}</span>`
    }
  }

  document.querySelectorAll('[data-connect-provider]').forEach(button=>button.onclick=()=>connectAiProvider(button.dataset.connectProvider,button.dataset.providerLabel))
  document.querySelectorAll('[data-disconnect-provider]').forEach(button=>button.onclick=()=>disconnectAiProvider(button.dataset.disconnectProvider))
  document.getElementById('googleSetup').onclick=()=>oauthSetupModal('google')
  document.getElementById('microsoftSetup').onclick=()=>oauthSetupModal('microsoft')
  document.getElementById('filesJump').onclick=()=>go('documents')
  document.getElementById('whatsappInfo').onclick=()=>modal('WhatsApp live connection','<p class="muted">A genuine live WhatsApp connector requires a Meta developer application, WhatsApp Business account, Phone Number ID, access token and webhook configuration. Memora will keep this separate from consumer chat imports so permissions remain explicit.</p>')

  document.getElementById('chatgptImportBtn').onclick=()=>document.getElementById('chatgptFile').click()
  document.getElementById('whatsappImportBtn').onclick=()=>document.getElementById('whatsappFile').click()

  document.getElementById('chatgptFile').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('sourceMsg')
    msg.textContent='Indexing ChatGPT archive...'
    try{
      const count=await importChatGPT(file)
      msg.textContent=`Indexed ${count} ChatGPT conversations.`
      await reindexVaultFromMemories()
      toast('ChatGPT history indexed')
    }catch(error){msg.textContent=error.message}
  }

  document.getElementById('whatsappFile').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('sourceMsg')
    msg.textContent='Indexing WhatsApp history...'
    try{
      const count=await importWhatsApp(file)
      msg.textContent=`Indexed ${count} WhatsApp memory chunks.`
      await reindexVaultFromMemories()
      toast('WhatsApp history indexed')
    }catch(error){msg.textContent=error.message}
  }
}
async function help(){
  const whatsappText=encodeURIComponent('Hello John, I am contacting you from Memora.')
  const feedbackSubject=encodeURIComponent('Memora feedback')
  app.innerHTML=shell(`
    <section class="glass support-hero">
      <div class="support-hero-copy">
        <div class="eyebrow">Support · Accessibility · Feedback</div>
        <h3>Memora is being built for everyone.</h3>
        <p>Questions, ideas, bug reports and accessibility feedback are welcome. Choose the easiest way to reach the creator.</p>
      </div>
      <div class="support-status"><span></span><b>Community feedback welcome</b></div>
    </section>

    <section class="contact-grid" aria-label="Contact options">
      <a class="glass contact-card" href="mailto:johnabijit@gmail.com?subject=${feedbackSubject}">
        <span class="contact-icon email-icon" aria-hidden="true">✉</span>
        <div><small>Email</small><strong>johnabijit@gmail.com</strong><p>Best for detailed feedback, bug reports and suggestions.</p></div>
        <span class="contact-arrow" aria-hidden="true">↗</span>
      </a>

      <a class="glass contact-card whatsapp-card" href="https://wa.me/919633589699?text=${whatsappText}" target="_blank" rel="noopener">
        <span class="contact-icon whatsapp-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M12 2a9.6 9.6 0 0 0-8.2 14.6L2.5 21.5l5-1.3A9.7 9.7 0 1 0 12 2Zm0 17.5a7.8 7.8 0 0 1-4-1.1l-.3-.2-3 .8.8-2.9-.2-.3A7.8 7.8 0 1 1 12 19.5Zm4.4-5.8c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.6.1-.2.3-.6.8-.8.9-.1.2-.3.2-.5.1-1.3-.6-2.3-1.4-3.2-2.8-.2-.3.2-.4.6-1 .1-.2.1-.3 0-.5l-.7-1.7c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 5 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.4-.6 1.6-1.1.2-.5.2-1 .2-1.1-.1-.2-.3-.3-.5-.4Z"/></svg>
        </span>
        <div><small>WhatsApp</small><strong>Message on WhatsApp</strong><p>Opens a conversation with +91 96335 89699.</p></div>
        <span class="contact-arrow" aria-hidden="true">↗</span>
      </a>

      <a class="glass contact-card" href="tel:+919633589699">
        <span class="contact-icon phone-icon" aria-hidden="true">☎</span>
        <div><small>Call</small><strong>+91 96335 89699</strong><p>On a phone, this opens the dialer with the number filled in.</p></div>
        <span class="contact-arrow" aria-hidden="true">↗</span>
      </a>
    </section>

    <section class="glass accessibility-card">
      <div>
        <div class="eyebrow">Accessibility</div>
        <h3>Designed to remain usable, not just beautiful.</h3>
        <p class="muted">Memora uses labeled controls, keyboard focus states, reduced-motion support, large touch targets, semantic navigation and responsive layouts. If anything is difficult to read, hear, tap or navigate, please report it through the contact options above.</p>
      </div>
      <button class="btn" data-nav="settings">Accessibility and appearance settings</button>
    </section>

    <section class="glass support-note">
      <strong>About support</strong>
      <p class="muted">Memora is offered as a goodwill project. Response times may vary, but useful feedback will help improve the experience for people using different phones, browsers, languages and accessibility tools around the world.</p>
    </section>
  `,'Help & Feedback','Contact, accessibility support and product feedback.')
  wire()
}

async function settings(){
  const [{data:profile},{data:settingsData}]=await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    supabase.from('user_settings').select('*').maybeSingle()
  ])
  const currentTheme=localStore.getItem('memora-theme')||'auto'
  const reduceMotion=settingsData?.reduce_motion===true
  const largeText=localStore.getItem('memora-large-text')==='1'
  const highContrast=localStore.getItem('memora-high-contrast')==='1'

  app.innerHTML=shell(`
    <div class="settings-grid">
      <section class="glass settings-card">
        <div class="eyebrow">Identity</div><h3>Profile</h3>
        <div class="settings-stack">
          <input class="input" id="displayName" value="${esc(profile?.display_name||'')}" placeholder="Display name">
          <input class="input" id="timezone" value="${esc(profile?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone)}" placeholder="Timezone">
          <button class="btn primary" id="saveProfile">Save profile</button>
        </div>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Atmosphere</div><h3>Visual world</h3>
        <p class="muted">Adaptive mode changes the color theme every hour. Live background motion responds to daypart and the calendar season.</p>
        <div class="setting-row"><span>Theme</span><b>${esc(currentTheme==='auto'?'Adaptive hourly':document.documentElement.dataset.themeLabel||currentTheme)}</b></div>
        <div class="setting-row"><span>Live background</span><b>${ambientPreferences.dynamicBackground?'On':'Off'}</b></div>
        <div class="filter-row"><button class="btn" id="settingsTheme">Choose theme</button><button class="btn" id="toggleDynamicBackground">${ambientPreferences.dynamicBackground?'Disable motion':'Enable motion'}</button></div>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Audio</div><h3>Open music, world radio, devotionals and nature</h3>
        <p class="muted">Use the compact mini player for full tracks from the Audius open catalog, live radio from around the world, devotional and spiritual stations across many traditions and languages, or open nature recordings.</p>
        <div class="setting-row"><span>Sound</span><b>${ambientPreferences.enabled?'On':'Silent'}</b></div>
        <div class="setting-row"><span>Mode</span><b>${esc(mediaPlayerState.mode==='music'?'Open Music':mediaPlayerState.mode==='devotional'?'Devotional and spiritual':mediaPlayerState.mode==='radio'?'Live radio':'Nature recordings')}</b></div>
        <div class="setting-row"><span>Volume</span><b>${Math.round(ambientPreferences.volume*100)}%</b></div>
        <div class="filter-row"><button class="btn primary" id="settingsSound">Open audio library</button><button class="btn" id="quickMute">${ambientPreferences.enabled?'Mute':'Enable audio'}</button></div>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Accessibility</div><h3>Comfort and clarity</h3>
        <p class="muted">Adjust motion, text size and contrast without changing your memories or theme selection.</p>
        <div class="setting-row"><span>Reduced motion</span><b>${reduceMotion?'On':'Off'}</b></div>
        <div class="setting-row"><span>Larger text</span><b>${largeText?'On':'Off'}</b></div>
        <div class="setting-row"><span>Higher contrast</span><b>${highContrast?'On':'Off'}</b></div>
        <div class="filter-row accessibility-actions">
          <button class="btn" id="toggleReduceMotion">${reduceMotion?'Use full motion':'Reduce motion'}</button>
          <button class="btn" id="toggleLargeText">${largeText?'Normal text':'Larger text'}</button>
          <button class="btn" id="toggleHighContrast">${highContrast?'Standard contrast':'Higher contrast'}</button>
        </div>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Guidance</div><h3>Personal experience</h3>
        <p class="muted">Use the guided tour anytime, let Memora remember explicit mood check-ins, and choose whether memories can influence the live background scene.</p>
        <div class="setting-row"><span>Mood check-ins</span><b>${experiencePreferences.moodCheckinsEnabled?'On':'Off'}</b></div>
        <div class="setting-row"><span>Contextual scenery</span><b>${experiencePreferences.contextualScenery?'On':'Off'}</b></div>
        <div class="filter-row">
          <button class="btn primary" id="retakeTour">Take guided tour</button>
          <button class="btn" id="toggleMoodCheckins">${experiencePreferences.moodCheckinsEnabled?'Disable mood memory':'Enable mood memory'}</button>
          <button class="btn" id="toggleContextScenery">${experiencePreferences.contextualScenery?'Disable contextual scenes':'Enable contextual scenes'}</button>
        </div>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Conversations</div><h3>Chat history</h3>
        <p class="muted">Ask conversations are saved separately. All chats share the same Memora memory vault while recent conversational context stays inside its thread.</p>
        <div class="filter-row"><button class="btn" data-nav="ask">Open chats</button><button class="btn danger" id="deleteChats">Delete all chats</button></div>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Security</div><h3>Your private data</h3>
        <p class="muted">Memories, media, chats and structured facts are scoped to your signed-in user through Row Level Security. Credentials belong in Sources and are blocked from manual memory capture.</p>
        <div class="setting-row"><span>App build</span><b>2026.10.09.43</b></div>
        <button class="btn" id="logoutButton">Sign out</button>
      </section>

      <section class="glass settings-card contact-settings-card">
        <div class="eyebrow">Support</div><h3>Help & feedback</h3>
        <p class="muted">Questions, accessibility feedback, bug reports or ideas are welcome. Contact the creator directly by email, WhatsApp or phone.</p>
        <button class="btn primary" data-nav="help">Open Help & Feedback</button>
      </section>

      <section class="glass settings-card">
        <div class="eyebrow">Data control</div><h3>Export or erase</h3>
        <p class="muted">Take a portable JSON copy of your memories and chats, or remove the personal memory vault from this account.</p>
        <div class="filter-row"><button class="btn" id="exportData">Export data</button><button class="btn danger" id="deleteAll">Delete memory vault</button></div>
      </section>
    </div>
  `,'Profile and Settings','Control identity, appearance, sound, chats, security and your data.')
  wire()

  document.getElementById('settingsTheme').onclick=openThemePicker
  document.getElementById('settingsSound').onclick=openSoundscapePicker
  document.getElementById('retakeTour').onclick=()=>showOnboardingTour({force:true})
  document.getElementById('toggleMoodCheckins').onclick=async()=>{
    experiencePreferences.moodCheckinsEnabled=!experiencePreferences.moodCheckinsEnabled
    await supabase.from('user_settings').upsert({user_id:user.id,mood_checkins_enabled:experiencePreferences.moodCheckinsEnabled})
    await settings()
  }
  document.getElementById('toggleContextScenery').onclick=async()=>{
    experiencePreferences.contextualScenery=!experiencePreferences.contextualScenery
    await supabase.from('user_settings').upsert({user_id:user.id,contextual_scenery:experiencePreferences.contextualScenery})
    if(!experiencePreferences.contextualScenery){
      document.documentElement.dataset.scenePhoto='off'
      document.documentElement.style.removeProperty('--scene-photo')
    }else{
      updateTheme()
    }
    await settings()
  }
  document.getElementById('quickMute').onclick=async()=>{await setAmbientEnabled(!ambientPreferences.enabled);await settings()}
  document.getElementById('toggleDynamicBackground').onclick=async()=>{
    await saveExperiencePreferences({dynamicBackground:!ambientPreferences.dynamicBackground})
    await settings()
  }

  document.getElementById('toggleReduceMotion').onclick=async()=>{
    const next=!reduceMotion
    await supabase.from('user_settings').upsert({user_id:user.id,reduce_motion:next})
    document.documentElement.dataset.reduceMotion=next?'on':'off'
    await settings()
  }
  document.getElementById('toggleLargeText').onclick=async()=>{
    localStore.setItem('memora-large-text',largeText?'0':'1')
    applyLocalAccessibilityPreferences()
    await settings()
  }
  document.getElementById('toggleHighContrast').onclick=async()=>{
    localStore.setItem('memora-high-contrast',highContrast?'0':'1')
    applyLocalAccessibilityPreferences()
    await settings()
  }
  document.getElementById('logoutButton').onclick=async()=>{
    stopAmbient()
    mediaAudio()?.pause()
    document.getElementById('memoraMediaPlayer')?.remove()
    document.body.classList.remove('has-memora-player')
    await supabase.auth.signOut()
    user=null
    navigationInitialized=false
    currentThreadId=null
    chat=[]
    authScreen()
  }

  document.getElementById('saveProfile').onclick=async()=>{
    const display_name=document.getElementById('displayName').value.trim()
    const timezone=document.getElementById('timezone').value.trim()
    const {error}=await supabase.from('profiles').upsert({user_id:user.id,display_name,timezone})
    await supabase.from('user_settings').upsert({
      user_id:user.id,
      adaptive_theme:(localStore.getItem('memora-theme')||'auto')==='auto',
      theme_profile:localStore.getItem('memora-theme')||'auto',
      ambient_enabled:ambientPreferences.enabled,
      ambient_scene:ambientPreferences.scene,
      ambient_volume:ambientPreferences.volume,
      dynamic_background:ambientPreferences.dynamicBackground,
      reduce_motion:settingsData?.reduce_motion||false
    })
    toast(error?error.message:'Profile saved')
  }

  document.getElementById('exportData').onclick=async()=>{
    const results=await Promise.all([
      supabase.from('memories').select('*').order('created_at'),
      supabase.from('memory_facts').select('*').order('fact_key'),
      supabase.from('things').select('*'),
      supabase.from('people').select('*'),
      supabase.from('places').select('*'),
      supabase.from('documents').select('*'),
      supabase.from('memory_contexts').select('*'),
      supabase.from('mood_logs').select('*').order('created_at'),
      supabase.from('chat_threads').select('*').order('created_at'),
      supabase.from('chat_messages').select('*').order('created_at')
    ])
    const [memoryData,factData,thingData,peopleData,placeData,docData,contexts,moods,threads,messages]=results.map(result=>result.data||[])
    const blob=new Blob([JSON.stringify({
      exported_at:new Date().toISOString(),
      memories:memoryData.map(memory=>({...memory,original_text:redactSecrets(memory.original_text),summary:redactSecrets(memory.summary)})),
      structured_facts:factData,
      things:thingData,
      people:peopleData,
      places:placeData,
      documents:docData,
      contexts,
      mood_logs:moods,
      chat_threads:threads,
      chat_messages:messages.map(message=>({...message,content:redactSecrets(message.content)}))
    },null,2)],{type:'application/json'})
    const link=document.createElement('a')
    link.href=URL.createObjectURL(blob)
    link.download='memora-export.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  document.getElementById('deleteChats').onclick=async()=>{
    if(!confirm('Delete all Ask conversations? Your saved memories will remain.')) return
    const {error}=await supabase.from('chat_threads').delete().eq('user_id',user.id)
    if(error) return toast(error.message)
    currentThreadId=null
    chat=[]
    chatThreads=[]
    conversationContext={thing:null,subject:null,relation:null,lastMemoryId:null,lastImageMediaId:null}
    await ensureChatThread()
    toast('Chat history deleted')
    await settings()
  }

  document.getElementById('deleteAll').onclick=async()=>{
    if(!confirm('Delete your entire memory vault? Chat history is kept separately. This cannot be undone.')) return
    const {error}=await supabase.rpc('delete_all_my_memory_data')
    if(error) return toast(error.message)
    conversationContext={thing:null,subject:null,relation:null,lastMemoryId:null,lastImageMediaId:null}
    persistConversationState()
    toast('Memory vault deleted')
  }
}

let signedInBootstrap=null
async function bootstrapSignedIn(){
  if(signedInBootstrap) return signedInBootstrap
  signedInBootstrap=prepareSignedIn().finally(()=>{signedInBootstrap=null})
  return signedInBootstrap
}
async function prepareSignedIn(){
  removeStrayEscapedNewline()
  await loadExperiencePreferences()
  stopAmbient()
  ensureMediaPlayer()
  if(!ambientPreferences.enabled){
    const audio=mediaAudio()
    if(audio) audio.muted=true
  }

  const preferredMode=['radio','devotional','music'].includes(mediaPlayerState.mode)?mediaPlayerState.mode:'nature'
  if(preferredMode==='music'){
    loadMediaLibrary('music',mediaPlayerState.musicQuery,50,{
      preserveCurrent:false,
      sort:mediaPlayerState.musicSort,
      genre:mediaPlayerState.musicGenre
    }).then(items=>{
      if(items?.length) selectMediaTrack(items[0],false)
    }).catch(()=>{})
  }else{
    const preferredQuery=mediaPlayerState.query||(preferredMode==='nature'?'rain':'')
    loadMediaLibrary(preferredMode,preferredQuery,100,{
      preserveCurrent:preferredMode==='nature',
      countrycode:mediaPlayerState.radioCountry,
      sort:mediaPlayerState.radioSort,
      tradition:mediaPlayerState.devotionalTradition,
      language:preferredMode==='devotional'?mediaPlayerState.devotionalLanguage:mediaPlayerState.radioLanguage
    })
      .then(items=>{
        if(['radio','devotional'].includes(preferredMode)&&items?.length) selectMediaTrack(items[0],false)
      })
      .catch(()=>{})
  }

  await migrateLegacyChat()
  if(navigationInitialized) await renderRoute(view)
  else await initializeNavigation()
  if(!experiencePreferences.onboardingCompleted) setTimeout(()=>showOnboardingTour(),320)
}

removeStrayEscapedNewline()
setupAtmosphere()

const strayTextObserver=new MutationObserver(()=>removeStrayEscapedNewline())
strayTextObserver.observe(document.body,{childList:true,subtree:false})

async function startMemora(){
  const {data,error}=await supabase.auth.getSession()
  if(error) console.warn('Memora session could not be restored')
  user=data.session?.user||null
  supabase.auth.onAuthStateChange((event,sessionNow)=>{
    user=sessionNow?.user||null
    if(event==='SIGNED_OUT'){
      navigationInitialized=false
      currentThreadId=null
      chat=[]
      chatThreads=[]
      mediaLibraryRequest++
      clearTimeout(mediaRecoveryTimer)
      stopMediaPlayback()
      stopAmbient()
      document.getElementById('memoraMediaPlayer')?.remove()
      document.body.classList.remove('has-memora-player')
      sessionStore.removeItem('memora-chat')
      pendingMedia=[]
      pendingLocation=null
      setTimeout(()=>authScreen(),0)
    }
    if(event==='SIGNED_IN'&&sessionNow?.user&&!document.querySelector('.dock')){
      setTimeout(()=>{
        if(user&&!document.querySelector('.dock')) bootstrapSignedIn().catch(()=>window.memoraStartupFailed?.())
      },0)
    }
  })
  if(user) await bootstrapSignedIn()
  else await authScreen()
  window.memoraReady=true
}
startMemora().catch(error=>{console.error('Memora startup failed',error);window.memoraStartupFailed?.()})

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./service-worker.js?v=43.1').then(reg=>reg.update()).catch(()=>{})
}
