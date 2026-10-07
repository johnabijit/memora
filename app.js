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
let conversationContext = { thing: null, subject: null, lastMemoryId: null, lastImageMediaId: null }
let ocrWorkerPromise = null
let lastThemeHour = null

const manualThemes = {
  aurora:{c1:'#8b7cff',c2:'#50d8d0',c3:'#ff7cac',bg0:'#060810',bg1:'#0b1020',bg2:'#10192c',label:'Aurora'},
  ocean:{c1:'#4f8cff',c2:'#3de1d2',c3:'#73b7ff',bg0:'#04101a',bg1:'#071925',bg2:'#0b2531',label:'Ocean'},
  rose:{c1:'#f06ca9',c2:'#b589ff',c3:'#ffad70',bg0:'#120813',bg1:'#1b0d20',bg2:'#231328',label:'Rose'},
  forest:{c1:'#65d99c',c2:'#57c9c1',c3:'#b1d86f',bg0:'#06100c',bg1:'#0a1912',bg2:'#12251b',label:'Forest'},
  solar:{c1:'#ff9d58',c2:'#ffc861',c3:'#ff6f91',bg0:'#130a07',bg1:'#201009',bg2:'#291711',label:'Solar'},
  mono:{c1:'#d5d9e2',c2:'#8ea0b8',c3:'#ffffff',bg0:'#08090c',bg1:'#101216',bg2:'#171a20',label:'Mono'}
}

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
  const hue=(238+hour*17)%360
  const hue2=(hue+58)%360
  const hue3=(hue+122)%360
  let light=62
  let base0='#060810',base1='#0b1020',base2='#10192c',label='Midnight Bloom'
  if(hour>=5&&hour<8){light=66;base0='#100b16';base1='#21152a';base2='#2d1b2b';label='Dawn Bloom'}
  else if(hour>=8&&hour<12){light=58;base0='#07101d';base1='#0c1b2c';base2='#11283b';label='Morning Sky'}
  else if(hour>=12&&hour<16){light=60;base0='#071018';base1='#0a1b27';base2='#142738';label='Daylight'}
  else if(hour>=16&&hour<19){light=64;base0='#140b0b';base1='#241014';base2='#31171c';label='Golden Hour'}
  else if(hour>=19&&hour<22){light=63;base0='#090918';base1='#121128';base2='#1a1737';label='Twilight'}
  else if(hour>=22){light=63;base0='#060812';base1='#0b1021';base2='#10172d';label='Night Aurora'}
  applyTheme({
    c1:`hsl(${hue} 88% ${light}%)`,
    c2:`hsl(${hue2} 80% ${Math.min(light+3,70)}%)`,
    c3:`hsl(${hue3} 86% ${Math.min(light+4,72)}%)`,
    bg0:base0,bg1:base1,bg2:base2
  },`${label} · ${hour.toString().padStart(2,'0')}:00`)
  lastThemeHour=hour
}

function updateTheme(){
  const mode=localStorage.getItem('memora-theme')||'auto'
  if(mode==='auto') adaptiveTheme()
  else applyTheme(manualThemes[mode]||manualThemes.aurora,(manualThemes[mode]||manualThemes.aurora).label)
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


function extractPhoneNumbers(text){
  const matches=String(text||'').match(/\+?\d[\d\s().-]{6,}\d/g)||[]
  return [...new Set(matches.map(raw=>raw.trim()).filter(raw=>{
    const digits=raw.replace(/\D/g,'')
    return digits.length>=8&&digits.length<=15
  }))]
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
  if(existing){
    await new Promise((resolve,reject)=>{
      if(window.Tesseract?.createWorker) return resolve()
      existing.addEventListener('load',resolve,{once:true})
      existing.addEventListener('error',()=>reject(new Error('OCR library failed to load')),{once:true})
    })
    if(window.Tesseract?.createWorker) return window.Tesseract
  }

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
  'remembr':'remember','memroy':'memory','wrk':'work','adress':'address'
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

async function smartMemorySearch(query,limit=8){
  const normalized=normalizeQuestion(query)
  const universe=await supabase.rpc('search_memory_universe',{search_query:normalized,result_limit:limit})
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

  const result=await supabase.rpc('search_memories_smart',{search_query:normalized,result_limit:limit})
  if(!result.error&&result.data?.length) return result.data
  const fallback=await supabase.rpc('search_memories',{search_query:normalized,result_limit:limit})
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
  const rawQ=question.trim()
  const q=normalizeQuestion(rawQ)
  const lower=q.toLowerCase()

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
    const phones=media.extracted_data?.phone_numbers||extractPhoneNumbers(media.extracted_text||'')
    const emails=media.extracted_data?.emails||extractEmails(media.extracted_text||'')
    const text=String(media.extracted_text||'').trim()
    const summary=media.extracted_data?.readable_summary||summarizeImageText(text)
    let answer='I found your latest saved image.'
    if(summary) answer+=` I can read: “${summary}”`
    else if(media.analysis_status==='failed') answer+=' The image is saved, but text analysis failed. I will retry it when you ask again or when you save a new image.'
    else answer+=' The image is saved, but I could not find reliable readable text in it.'
    if(phones.length) answer+=` Detected number${phones.length>1?'s':''}: ${phones.join(', ')}.`
    if(emails.length) answer+=` Detected email${emails.length>1?'s':''}: ${emails.join(', ')}.`
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
      const facts=[...new Set(exact.map(x=>String(x.original_text||x.summary||'').trim()).filter(Boolean))].slice(0,5)
      if(facts.length===1){
        return {text:`For ${subject}, I currently have one specific memory: ${facts[0]}`,source:'Only matching stored memory'}
      }
      return {text:`For ${subject}, I found ${facts.length} relevant memories: ${facts.map((fact,index)=>`${index+1}. ${fact}`).join(' ')}`,source:'Matching stored memories only'}
    }
    return {text:`I don't have a relevant stored memory about ${subject} yet.`}
  }

  const relation=detectRelationship(q)
  if(relation){
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
    return {text:`The most recent relevant memory is: “${relevant[0].original_text}” from ${when(relevant[0].occurred_at)}.`,source:'Most relevant stored memory'}
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

  return {text:`Based on the most relevant memory I found: ${best.original_text}`,source:`Stored memory from ${shortDate(best.occurred_at)}`}
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
        <div class="chat" id="chat">${chat.length?chat.map(message=>`<div class="bubble ${message.role==='user'?'user':''}">${message.imageUrl?`<img class="chat-evidence-image" src="${esc(message.imageUrl)}" alt="Memory evidence">`:''}${esc(message.text)}${message.source?`<div class="source">Source: ${esc(message.source)}</div>`:''}</div>`).join(''):'<div class="empty"><strong>Ask your own life</strong>Memora searches your stored memories before answering.</div>'}</div>
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
    chat.push({role:'assistant',text:/\\b(image|photo|picture|screenshot|phone|mobile)\\b/i.test(normalizeQuestion(q))?'Reading the relevant image and memory...':'Checking the most relevant memories...',pending:true})
    ask()
    try{
      const response=await answer(q)
      chat=chat.filter(message=>!message.pending)
      chat.push({role:'assistant',...response})
    }catch(error){
      chat=chat.filter(message=>!message.pending)
      chat.push({role:'assistant',text:'I could not complete that lookup. Please try again.',source:error.message})
    }
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
  app.innerHTML=shell(`
    <div class="source-grid">
      <div class="glass source-card" id="chatgptCard"><span class="status live">Import works</span><div class="source-icon">AI</div><h3>ChatGPT</h3><p>Import your exported ChatGPT conversations into searchable historical memories.</p><button class="btn primary" id="chatgptImportBtn" style="margin-top:15px">Import export</button><input class="hidden" id="chatgptFile" type="file" accept=".json,application/json"></div>
      <div class="glass source-card" data-source-info="openai"><span class="status">Secure setup</span><div class="source-icon">✦</div><h3>OpenAI agents</h3><p>Future live reasoning through the current Responses and agent architecture.</p></div>
      <div class="glass source-card" data-source-info="google"><span class="status">OAuth setup</span><div class="source-icon">G</div><h3>Google Workspace</h3><p>Gmail, Calendar, Drive and Photos through explicit user-authorized scopes.</p></div>
      <div class="glass source-card" data-source-info="microsoft"><span class="status">OAuth setup</span><div class="source-icon">M</div><h3>Microsoft 365</h3><p>Outlook, Calendar, OneDrive and SharePoint through Microsoft Graph.</p></div>
      <div class="glass source-card" id="whatsappCard"><span class="status live">Import works</span><div class="source-icon">W</div><h3>WhatsApp</h3><p>Import an exported text chat so important conversations can become searchable memories.</p><button class="btn" id="whatsappImportBtn" style="margin-top:15px">Import chat</button><input class="hidden" id="whatsappFile" type="file" accept=".txt,text/plain"></div>
      <div class="glass source-card" data-source-info="maps"><span class="status live">Location works</span><div class="source-icon">⌖</div><h3>Maps and location</h3><p>Attach your current location now. Timeline imports and continuous history are designed as separate privacy-aware modules.</p></div>
      <div class="glass source-card" data-source-info="claude"><span class="status">AI setup</span><div class="source-icon">C</div><h3>Claude</h3><p>Prepared for API or export based memory import without changing your core database.</p></div>
      <div class="glass source-card" data-source-info="gemini"><span class="status">AI setup</span><div class="source-icon">Gm</div><h3>Gemini</h3><p>Prepared as another optional AI reasoning provider.</p></div>
      <div class="glass source-card" id="filesCard"><span class="status live">Works now</span><div class="source-icon">▣</div><h3>Files and documents</h3><p>Upload policies, receipts, screenshots, PDFs and other files with a note explaining why they matter.</p><button class="btn" id="filesJump" style="margin-top:15px">Open Documents</button></div>
    </div>
    <div id="sourceMsg" class="muted" style="margin-top:14px"></div>
  `,'Source Universe','Connect the pieces of your digital life without mixing permissions or pretending a source is connected when it is not.')
  wire()
  document.querySelectorAll('[data-source-info]').forEach(card=>card.onclick=()=>openSourceInfo(card.dataset.sourceInfo))
  document.getElementById('filesJump').onclick=e=>{e.stopPropagation();go('documents')}
  document.getElementById('chatgptImportBtn').onclick=e=>{e.stopPropagation();document.getElementById('chatgptFile').click()}
  document.getElementById('whatsappImportBtn').onclick=e=>{e.stopPropagation();document.getElementById('whatsappFile').click()}
  document.getElementById('chatgptFile').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('sourceMsg')
    msg.textContent='Importing ChatGPT history...'
    try{const count=await importChatGPT(file);msg.textContent=`Imported ${count} ChatGPT conversations.`;toast('ChatGPT history imported')}
    catch(error){msg.textContent=error.message}
  }
  document.getElementById('whatsappFile').onchange=async event=>{
    const file=event.target.files[0]
    if(!file) return
    const msg=document.getElementById('sourceMsg')
    msg.textContent='Importing WhatsApp chat...'
    try{const count=await importWhatsApp(file);msg.textContent=`Imported ${count} searchable WhatsApp memory chunks.`;toast('WhatsApp chat imported')}
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
supabase.auth.onAuthStateChange((_event,sessionNow)=>{user=sessionNow?.user||null})
if(user) render()
else authScreen()

if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{})
