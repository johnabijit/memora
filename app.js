import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
const app = document.getElementById('app')
let user = null
let view = 'home'
let chat = []
let pendingAttachments = []

const nav = [
  ['home','Home'],['ask','Ask Memora'],['memories','Memories'],['timeline','Timeline'],
  ['people','People'],['places','Places'],['things','Things'],['documents','Documents'],
  ['connections','Connections'],['settings','Settings']
]

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const when = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Unknown date'
const toast = message => {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2400)
}

function authScreen(mode='login') {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="card auth-card">
      <div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>Your private life memory</small></div></div>
      <h2>${mode === 'login' ? 'Welcome back' : 'Create your memory space'}</h2>
      <p class="muted">Remember moments, places, people, documents and where you kept important things.</p>
      <form id="authForm">
        ${mode === 'signup' ? '<input class="input" id="name" placeholder="Your name" required>' : ''}
        <input class="input" id="email" type="email" placeholder="Email" required>
        <input class="input" id="password" type="password" minlength="8" placeholder="Password" required>
        <button class="btn primary" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <div class="tabbar"><button class="btn" id="loginTab">Sign in</button><button class="btn" id="signupTab">Sign up</button></div>
      <p id="authMsg" class="muted"></p>
    </div>
  </div>`
  document.getElementById('loginTab').onclick = () => authScreen('login')
  document.getElementById('signupTab').onclick = () => authScreen('signup')
  document.getElementById('authForm').onsubmit = async event => {
    event.preventDefault()
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const msg = document.getElementById('authMsg')
    msg.textContent = 'Working...'
    if (mode === 'signup') {
      const display_name = document.getElementById('name').value.trim()
      const { data, error } = await supabase.auth.signUp({email,password,options:{data:{display_name},emailRedirectTo:window.location.origin}})
      if (error) return msg.textContent = error.message
      if (data.session) {
        user = data.user
        render()
      } else {
        msg.textContent = 'Account created. Check your email if confirmation is enabled, then sign in.'
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({email,password})
      if (error) return msg.textContent = error.message
      user = data.user
      render()
    }
  }
}

function shell(content,title) {
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="logo">M</div><div><h1>Memora</h1><small>Personal memory OS</small></div></div>
      <nav class="nav">${nav.map(([id,label]) => `<button data-nav="${id}" class="${view === id ? 'active' : ''}">${label}</button>`).join('')}</nav>
      <div class="sidebar-footer"><button class="btn" id="logout">Sign out</button></div>
    </aside>
    <main class="main">
      <div class="topbar"><div><h2>${esc(title)}</h2><div class="muted">Private to your account</div></div><button class="btn primary" id="quick">+ Remember</button></div>
      ${content}
    </main>
    <div class="mobile-nav">${[['home','Home'],['ask','Ask'],['timeline','Timeline'],['memories','Memories'],['settings','Profile']].map(([id,label]) => `<button data-nav="${id}" class="${view === id ? 'active' : ''}">${label}</button>`).join('')}</div>
  </div>`
}

function wire() {
  document.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => go(button.dataset.nav))
  document.getElementById('quick')?.addEventListener('click', () => go('home',true))
  document.getElementById('logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    user = null
    authScreen()
  })
}

async function go(next,focus=false) {
  view = next
  const routes = {
    home:home, ask:ask, memories:memories, timeline:timeline, people:people,
    places:places, things:things, documents:documents, connections:connections, settings:settings
  }
  await (routes[next] || home)()
  if (focus) document.getElementById('memoryInput')?.focus()
}
const render = () => go(view)

function interpret(text) {
  const result = {memory_type:'note',summary:text,interpreted_data:{}}
  const patterns = [
    /(?:i\s+)?(?:kept|put|left|placed|stored)\s+(?:my\s+)?(.+?)\s+(?:in|inside|under|below|on|at|near)\s+(.+?)(?:\.|$)/i,
    /(?:my\s+)?(.+?)\s+(?:is|was)\s+(?:in|inside|under|below|on|at|near)\s+(.+?)(?:\.|$)/i,
    /(?:i\s+)?moved\s+(?:my\s+)?(.+?)\s+(?:to|into)\s+(.+?)(?:\.|$)/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      result.memory_type = 'object'
      result.summary = `${match[1].trim()} is at ${match[2].trim()}`
      result.interpreted_data = {thing:match[1].trim(),location:match[2].trim()}
      return result
    }
  }
  const activity = text.match(/(?:i\s+)?(?:played|did|attended|visited)\s+(.+?)(?:\s+with\s+([A-Z][A-Za-z .'-]+?))?(?:\s+(today|yesterday))?(?:\.|$)/i)
  if (activity) {
    result.memory_type = 'activity'
    result.interpreted_data = {activity:activity[1]?.trim(),person:activity[2]?.trim() || null,relative_date:activity[3] || null}
  } else if (/prefer|favorite|favourite|like|love/i.test(text)) result.memory_type = 'preference'
  else if (/need to|must|todo|to-do/i.test(text)) result.memory_type = 'task'
  else if (/remember|important|note/i.test(text)) result.memory_type = 'personal_fact'
  return result
}

async function findThing(name) {
  const { data } = await supabase.from('things').select('*').ilike('name',name).limit(1).maybeSingle()
  return data
}

async function trackThing(name,location,memoryId) {
  let thing = await findThing(name)
  const now = new Date().toISOString()
  if (!thing) {
    const created = await supabase.from('things').insert({user_id:user.id,name,current_location:location,last_memory_id:memoryId}).select().single()
    if (created.error) throw created.error
    thing = created.data
  } else {
    if (thing.last_memory_id) {
      await supabase.from('memories').update({state:'superseded',valid_to:now}).eq('id',thing.last_memory_id)
      await supabase.from('memories').update({supersedes_memory_id:thing.last_memory_id}).eq('id',memoryId)
    }
    await supabase.from('thing_locations').update({is_current:false,valid_to:now}).eq('thing_id',thing.id).eq('is_current',true)
    const update = await supabase.from('things').update({current_location:location,last_memory_id:memoryId}).eq('id',thing.id)
    if (update.error) throw update.error
  }
  const locationInsert = await supabase.from('thing_locations').insert({
    user_id:user.id,thing_id:thing.id,memory_id:memoryId,location,recorded_at:now,valid_from:now,is_current:true
  })
  if (locationInsert.error) throw locationInsert.error
}

async function saveMemory(text) {
  const parsed = interpret(text)
  let occurred = new Date()
  if (parsed.interpreted_data.relative_date === 'yesterday') occurred.setDate(occurred.getDate() - 1)
  const payload = {
    user_id:user.id,
    original_text:text,
    summary:parsed.summary,
    memory_type:parsed.memory_type,
    state:'current',
    occurred_at:occurred.toISOString(),
    source_type:'manual',
    provenance_kind:'user_stated',
    confidence:1,
    interpreted_data:parsed.interpreted_data,
    valid_from:new Date().toISOString()
  }
  const { data:memory, error } = await supabase.from('memories').insert(payload).select().single()
  if (error) throw error
  if (parsed.interpreted_data.thing && parsed.interpreted_data.location) {
    await trackThing(parsed.interpreted_data.thing,parsed.interpreted_data.location,memory.id)
  }
  if (parsed.interpreted_data.person) {
    const existing = await supabase.from('people').select('id').ilike('name',parsed.interpreted_data.person).limit(1).maybeSingle()
    if (!existing.data) await supabase.from('people').insert({user_id:user.id,name:parsed.interpreted_data.person,first_seen_at:memory.occurred_at,last_seen_at:memory.occurred_at})
  }
  if (parsed.memory_type === 'activity') {
    await supabase.from('events').insert({
      user_id:user.id,title:text,event_at:memory.occurred_at,memory_id:memory.id,
      person_name:parsed.interpreted_data.person || null,source_type:'manual',event_type:'activity'
    })
  }
  return memory
}

function memoryTone(type) {
  if (['object','object_location'].includes(type)) return 'violet'
  if (['activity','event'].includes(type)) return 'coral'
  if (['document','document_fact'].includes(type)) return 'blue'
  if (['preference','conversation'].includes(type)) return 'pink'
  if (['place','personal_fact'].includes(type)) return 'teal'
  if (['task','reminder'].includes(type)) return 'amber'
  return 'violet'
}

function attachmentKind(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.includes('pdf') || file.type.includes('document') || file.type.includes('sheet') || file.type.startsWith('text/')) return 'document'
  return 'other'
}

function addPendingFiles(files, source='upload') {
  for (const file of [...files]) {
    if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is larger than 25 MB`); continue }
    if (pendingAttachments.some(x => x.file.name === file.name && x.file.size === file.size)) continue
    pendingAttachments.push({file, source, kind:attachmentKind(file), preview:file.type.startsWith('image/') ? URL.createObjectURL(file) : null})
  }
  renderPendingFiles()
}

function renderPendingFiles() {
  const tray = document.getElementById('attachmentTray')
  if (!tray) return
  tray.innerHTML = pendingAttachments.map((x,i) => `<div class="pending-file">${x.preview ? `<img src="${x.preview}" alt="Preview">` : `<span class="file-glyph">FILE</span>`}<div><b>${esc(x.file.name)}</b><small>${Math.max(1,Math.round(x.file.size/1024))} KB · ${x.source === 'camera' ? 'Camera' : 'Attachment'}</small></div><button data-remove-file="${i}">×</button></div>`).join('')
  tray.querySelectorAll('[data-remove-file]').forEach(button => button.onclick = () => {
    const i = Number(button.dataset.removeFile)
    if (pendingAttachments[i]?.preview) URL.revokeObjectURL(pendingAttachments[i].preview)
    pendingAttachments.splice(i,1)
    renderPendingFiles()
  })
}

async function uploadMemoryAttachments(memoryId) {
  for (const item of pendingAttachments) {
    const safe = item.file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path = `${user.id}/${memoryId}/${crypto.randomUUID()}-${safe}`
    const upload = await supabase.storage.from('memora-media').upload(path,item.file,{contentType:item.file.type || undefined})
    if (upload.error) throw upload.error
    const row = await supabase.from('memory_attachments').insert({user_id:user.id,memory_id:memoryId,storage_path:path,file_name:item.file.name,mime_type:item.file.type,size_bytes:item.file.size,attachment_type:item.kind,source:item.source})
    if (row.error) throw row.error
  }
}

async function hydrateMemoryMedia() {
  const cards = [...document.querySelectorAll('[data-memory-id]')]
  const ids = cards.map(card => card.dataset.memoryId)
  if (!ids.length) return
  const {data} = await supabase.from('memory_attachments').select('*').in('memory_id',ids).order('created_at')
  if (!data?.length) return
  for (const attachment of data) {
    const slot = document.querySelector(`[data-media-slot="${attachment.memory_id}"]`)
    if (!slot) continue
    if (attachment.attachment_type === 'image') {
      const signed = await supabase.storage.from('memora-media').createSignedUrl(attachment.storage_path,3600)
      if (signed.data?.signedUrl) {
        const button = document.createElement('button')
        button.className = 'memory-photo'
        button.innerHTML = `<img src="${signed.data.signedUrl}" alt="${esc(attachment.file_name)}" loading="lazy">`
        button.onclick = () => openMemoryImage(signed.data.signedUrl, attachment.file_name)
        slot.appendChild(button)
      }
    } else {
      const file = document.createElement('span')
      file.className = 'memory-file-chip'
      file.textContent = attachment.file_name
      slot.appendChild(file)
    }
  }
}

function openMemoryImage(url,name) {
  const lightbox = document.createElement('div')
  lightbox.className = 'memory-lightbox'
  lightbox.innerHTML = `<button>×</button><img src="${url}" alt="${esc(name || 'Memory photo')}"><span>${esc(name || 'Memory photo')}</span>`
  document.body.appendChild(lightbox)
  requestAnimationFrame(() => lightbox.classList.add('open'))
  const close = () => { lightbox.classList.remove('open'); setTimeout(() => lightbox.remove(),200) }
  lightbox.querySelector('button').onclick = close
  lightbox.onclick = e => { if (e.target === lightbox) close() }
}

function setupVoiceCapture() {
  const button = document.getElementById('voiceMemory')
  if (!button) return
  button.onclick = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return toast('Voice dictation is not supported in this browser yet.')
    const recognition = new SpeechRecognition()
    recognition.lang = navigator.language || 'en-IN'
    recognition.interimResults = true
    button.classList.add('recording')
    button.textContent = 'Listening...'
    recognition.onresult = e => document.getElementById('memoryInput').value = [...e.results].map(r => r[0].transcript).join(' ')
    recognition.onend = () => { button.classList.remove('recording'); button.textContent = 'Voice' }
    recognition.onerror = () => toast('I could not hear that clearly. Try again.')
    recognition.start()
  }
}

async function home() {
  const [{ count:memoryCount },{ count:thingCount },{ count:photoCount },{ data:recent }] = await Promise.all([
    supabase.from('memories').select('*',{count:'exact',head:true}),
    supabase.from('things').select('*',{count:'exact',head:true}),
    supabase.from('memory_attachments').select('*',{count:'exact',head:true}).eq('attachment_type','image'),
    supabase.from('memories').select('*').order('pinned',{ascending:false}).order('created_at',{ascending:false}).limit(8)
  ])
  app.innerHTML = shell(`
    <section class="hero-premium">
      <div class="hero-aurora one"></div><div class="hero-aurora two"></div>
      <div class="hero-premium-copy"><span class="premium-eyebrow">CAPTURE A MEMORY</span><h3>What should your future self remember?</h3><p>Write it, say it, photograph it or attach the file. Memora keeps the context together.</p></div>
      <div class="memory-composer">
        <textarea id="memoryInput" placeholder="I kept my keys in the top drawer beside the watch..." rows="3"></textarea>
        <div id="attachmentTray" class="attachment-tray"></div>
        <div class="composer-bar"><div class="composer-tools">
          <label class="capture-tool">Photo<input type="file" id="photoInput" accept="image/*" multiple hidden></label>
          <label class="capture-tool">Camera<input type="file" id="cameraInput" accept="image/*" capture="environment" hidden></label>
          <label class="capture-tool">File<input type="file" id="memoryFileInput" multiple hidden></label>
          <button class="capture-tool" id="voiceMemory">Voice</button>
        </div><button class="btn primary remember-btn" id="saveMemory">Remember this ✦</button></div>
      </div>
      <div class="prompt-chips"><button data-example="I kept my house key in the top drawer beside the watch.">Where I kept something</button><button data-example="I played basketball with Arun today.">Something I did</button><button data-example="Remember that my vehicle insurance renewal is important.">Something important</button></div>
    </section>
    <div class="premium-stats"><div><span class="stat-swatch violet">✦</span><b>${memoryCount || 0}</b><small>Memories</small></div><div><span class="stat-swatch teal">◎</span><b>${photoCount || 0}</b><small>Photos</small></div><div><span class="stat-swatch coral">⌖</span><b>${thingCount || 0}</b><small>Things tracked</small></div><div><span class="stat-swatch blue">✓</span><b>Private</b><small>RLS protected</small></div></div>
    <div class="section-title premium-title"><div><span class="premium-eyebrow">YOUR MEMORY SPACE</span><h3>Recent memories</h3></div><button class="text-link" data-nav="memories">View all →</button></div>
    <div class="memory-grid">${recent?.length ? recent.map(memoryCard).join('') : '<div class="empty-premium"><span>✦</span><h3>Your first memory starts here</h3><p>Add a note, photo or file above. Your personal timeline will grow from real moments.</p></div>'}</div>
  `,'Home')
  wire()
  document.querySelectorAll('[data-example]').forEach(button => button.onclick = () => { document.getElementById('memoryInput').value = button.dataset.example; document.getElementById('memoryInput').focus() })
  document.getElementById('photoInput').onchange = e => addPendingFiles(e.target.files,'upload')
  document.getElementById('cameraInput').onchange = e => addPendingFiles(e.target.files,'camera')
  document.getElementById('memoryFileInput').onchange = e => addPendingFiles(e.target.files,'upload')
  setupVoiceCapture()
  document.getElementById('saveMemory').onclick = async () => {
    const input = document.getElementById('memoryInput')
    const text = input.value.trim()
    if (!text && !pendingAttachments.length) return toast('Add a note, photo or file first.')
    const button = document.getElementById('saveMemory')
    button.disabled = true
    button.textContent = pendingAttachments.length ? 'Saving memory + media...' : 'Saving memory...'
    try {
      const fallback = pendingAttachments.length ? `Saved ${pendingAttachments.map(x => x.file.name).join(', ')}` : 'Saved memory'
      const memory = await saveMemory(text || fallback)
      if (pendingAttachments.length) await uploadMemoryAttachments(memory.id)
      pendingAttachments.forEach(x => x.preview && URL.revokeObjectURL(x.preview))
      pendingAttachments = []
      toast('Memory saved beautifully')
      await home()
    } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Remember this ✦' }
  }
  bindDeletes()
  await hydrateMemoryMedia()
}


function memoryCard(m) {
  const tone = memoryTone(m.memory_type)
  const source = m.provenance_kind === 'imported' ? 'Imported' : m.provenance_kind === 'document_derived' ? 'From document' : m.provenance_kind === 'ai_inferred' ? 'AI interpreted' : 'You added this'
  return `<article class="memory-card tone-${tone}" data-memory-id="${m.id}" data-type="${esc(m.memory_type)}">
    <div class="memory-glow"></div>
    <div class="memory-card-head"><span class="type-dot"></span><span>${esc((m.memory_type || 'memory').replaceAll('_',' '))}</span><time>${when(m.occurred_at || m.created_at)}</time></div>
    <div class="memory-media" data-media-slot="${m.id}"></div>
    <div class="memory-card-body"><h3>${esc(m.summary || m.original_text)}</h3>${m.summary && m.summary !== m.original_text ? `<p>${esc(m.original_text)}</p>` : ''}</div>
    <div class="memory-card-foot"><span class="source-chip">✓ ${esc(source)}</span><div class="memory-actions"><button class="star-button" data-pin-memory="${m.id}" title="Pin">${m.pinned ? '★' : '☆'}</button><button class="delete-x" data-delete-memory="${m.id}" title="Delete">×</button></div></div>
  </article>`
}


async function memories() {
  const { data, error } = await supabase.from('memories').select('*').order('created_at',{ascending:false})
  app.innerHTML = shell(`
    <div class="capture"><input class="input" id="memorySearch" placeholder="Search your memories"><button class="btn primary" id="searchMemory">Search</button></div>
    <div class="section-title"><h3>All memories</h3></div>
    <div class="list" id="memoryList">${error ? esc(error.message) : data?.length ? data.map(memoryCard).join('') : '<div class="card empty">No memories yet.</div>'}</div>
  `,'Memories')
  wire()
  bindDeletes()
  await hydrateMemoryMedia()
  document.getElementById('searchMemory').onclick = async () => {
    const q = document.getElementById('memorySearch').value.trim()
    if (!q) return memories()
    const result = await supabase.rpc('search_memories',{search_query:q,result_limit:50})
    document.getElementById('memoryList').innerHTML = result.error ? esc(result.error.message) : result.data?.length ? result.data.map(m => memoryCard({...m,created_at:m.occurred_at})).join('') : '<div class="card empty">No matching memories.</div>'
    bindDeletes()
    await hydrateMemoryMedia()
  }
}

function bindDeletes() {
  document.querySelectorAll('[data-delete-memory]').forEach(button => button.onclick = async () => {
    if (!confirm('Delete this memory?')) return
    const memoryId = button.dataset.deleteMemory
    const {data:attachments} = await supabase.from('memory_attachments').select('storage_path').eq('memory_id',memoryId)
    if (attachments?.length) await supabase.storage.from('memora-media').remove(attachments.map(x => x.storage_path))
    const { error } = await supabase.from('memories').delete().eq('id',memoryId)
    if (error) toast(error.message)
    else { toast('Memory deleted'); go(view) }
  })
  document.querySelectorAll('[data-pin-memory]').forEach(button => button.onclick = async () => {
    const memoryId = button.dataset.pinMemory
    const {data} = await supabase.from('memories').select('pinned').eq('id',memoryId).single()
    if (!data) return
    const {error} = await supabase.from('memories').update({pinned:!data.pinned}).eq('id',memoryId)
    if (error) toast(error.message)
    else go(view)
  })
}

async function answer(question) {
  const q = question.trim()
  let match = q.match(/where (?:is|did i (?:keep|put|leave)) (?:my )?(.+?)(?:\?|$)/i)
  if (match) {
    const thing = await findThing(match[1].trim())
    if (!thing) return {text:"I don't have a memory about that yet."}
    return {text:`Your ${thing.name} is currently recorded as being at ${thing.current_location}.`,source:'Latest personal memory'}
  }
  match = q.match(/where was (?:my )?(.+?) before/i)
  if (match) {
    const thing = await findThing(match[1].trim())
    if (!thing) return {text:"I don't have a memory about that yet."}
    const { data } = await supabase.from('thing_locations').select('*').eq('thing_id',thing.id).order('recorded_at',{ascending:false}).limit(2)
    if (!data || data.length < 2) return {text:`I know the current location of your ${thing.name}, but I do not have an earlier location yet.`}
    return {text:`Before ${data[0].location}, your ${thing.name} was recorded at ${data[1].location}.`,source:`Personal memory from ${when(data[1].recorded_at)}`}
  }
  match = q.match(/when did i last (.+?)(?:\?|$)/i)
  if (match) {
    const term = match[1].trim()
    const { data } = await supabase.rpc('search_memories',{search_query:term,result_limit:5})
    if (!data?.length) return {text:"I don't have a memory about that yet."}
    return {text:`The most recent matching memory I found is: "${data[0].original_text}" on ${when(data[0].occurred_at)}.`,source:'Your stored memories'}
  }
  const { data, error } = await supabase.rpc('search_memories',{search_query:q,result_limit:5})
  if (error || !data?.length) return {text:"I don't have a memory about that yet."}
  return {text:`I found this memory: "${data[0].original_text}"`,source:`Stored memory from ${when(data[0].occurred_at)}`}
}

async function ask() {
  app.innerHTML = shell(`
    <div class="ask-layout">
      <div class="chat" id="chat">${chat.length ? chat.map(message => `<div class="bubble ${message.role === 'user' ? 'user' : ''}">${esc(message.text)}${message.source ? `<div class="source">Source: ${esc(message.source)}</div>` : ''}</div>`).join('') : '<div class="card empty">Try "Where is my wallet?", "Where was my wallet before?", or "When did I last play basketball?"</div>'}</div>
      <div class="capture"><input class="input" id="askInput" placeholder="Ask Memora about your life"><button class="btn primary" id="askButton">Ask</button></div>
    </div>
  `,'Ask Memora')
  wire()
  const submit = async () => {
    const input = document.getElementById('askInput')
    const q = input.value.trim()
    if (!q) return
    chat.push({role:'user',text:q})
    const result = await answer(q)
    chat.push({role:'assistant',...result})
    ask()
  }
  document.getElementById('askButton').onclick = submit
  document.getElementById('askInput').onkeydown = event => { if (event.key === 'Enter') submit() }
}

async function timeline() {
  const { data } = await supabase.from('memories').select('*').order('occurred_at',{ascending:false})
  app.innerHTML = shell(`
    <div class="section-title premium-title"><div><span class="premium-eyebrow">LIFE IN ORDER</span><h3>Your timeline</h3></div></div>
    <div class="memory-grid timeline">${data?.length ? data.map(memoryCard).join('') : '<div class="empty-premium"><h3>Your timeline is empty</h3><p>Memories with dates will appear here in chronological order.</p></div>'}</div>
  `,'Timeline')
  wire()
  bindDeletes()
  await hydrateMemoryMedia()
}

async function people() {
  const { data } = await supabase.from('people').select('*').order('name')
  app.innerHTML = shell(`<div class="list">${data?.length ? data.map(p => `<div class="card item"><strong>${esc(p.name)}</strong><div class="muted">${esc(p.relationship || 'Person from your memories')}</div><div>Last seen: ${when(p.last_seen_at || p.created_at)}</div></div>`).join('') : '<div class="card empty">People identified in memories will appear here.</div>'}</div>`,'People')
  wire()
}

async function places() {
  const { data } = await supabase.from('places').select('*').order('name')
  app.innerHTML = shell(`<div class="list">${data?.length ? data.map(p => `<div class="card item"><strong>${esc(p.name)}</strong><div class="muted">${esc(p.address || p.category || 'Saved place')}</div></div>`).join('') : '<div class="card empty">Places you add or import will appear here.</div>'}</div>`,'Places')
  wire()
}

async function things() {
  const { data } = await supabase.from('things').select('*').order('updated_at',{ascending:false})
  app.innerHTML = shell(`<div class="list">${data?.length ? data.map(t => `<div class="card item"><div class="item-head"><strong>${esc(t.name)}</strong><span class="pill success">Current</span></div><div>Location: <b>${esc(t.current_location || 'Unknown')}</b></div><button class="btn" data-history="${t.id}">View history</button><div id="history-${t.id}"></div></div>`).join('') : '<div class="card empty">Tell Memora where you keep an object and it will appear here.</div>'}</div>`,'Things')
  wire()
  document.querySelectorAll('[data-history]').forEach(button => button.onclick = async () => {
    const { data:history } = await supabase.from('thing_locations').select('*').eq('thing_id',button.dataset.history).order('recorded_at',{ascending:false})
    document.getElementById('history-' + button.dataset.history).innerHTML = history?.length ? `<div class="list">${history.map(h => `<div><span class="pill">${h.is_current ? 'Current' : 'Previous'}</span> ${esc(h.location)} <span class="muted">${when(h.recorded_at)}</span></div>`).join('')}</div>` : '<div class="muted">No history.</div>'
  })
}

async function documents() {
  const { data } = await supabase.from('documents').select('*').order('created_at',{ascending:false})
  app.innerHTML = shell(`<section class="document-hero"><span class="premium-eyebrow">FILES AS MEMORIES</span><h3>Remember why a file matters</h3><p>Save a PDF, Word file, spreadsheet, image or text file with a note that gives it context.</p><textarea id="documentNote" placeholder="Example: Vehicle insurance policy for my bike"></textarea><label class="btn primary document-pick">Choose a file<input type="file" id="fileInput" hidden></label><div id="uploadMsg" class="muted"></div></section><div class="section-title premium-title"><div><span class="premium-eyebrow">PRIVATE FILE VAULT</span><h3>Your documents</h3></div></div><div class="document-grid">${data?.length ? data.map(d => `<article class="document-card"><span class="doc-mark">DOC</span><div><b>${esc(d.file_name)}</b><p>${esc(d.description || 'Saved in your private vault')}</p><small>${when(d.created_at)}</small></div></article>`).join('') : '<div class="empty-premium"><h3>No documents saved yet</h3><p>Add a file above and Memora will create a searchable memory for it.</p></div>'}</div>`,'Documents')
  wire()
  document.getElementById('fileInput').onchange = async event => {
    const file = event.target.files[0]; if (!file) return
    const note = document.getElementById('documentNote').value.trim()
    const msg = document.getElementById('uploadMsg'); msg.textContent = 'Saving file and memory...'
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path = `${user.id}/${Date.now()}-${safe}`
    const uploaded = await supabase.storage.from('memora-documents').upload(path,file,{contentType:file.type || undefined})
    if (uploaded.error) return msg.textContent = uploaded.error.message
    const record = await supabase.from('documents').insert({user_id:user.id,file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,description:note || null,category:'personal',processing_status:'ready'}).select().single()
    if (record.error) return msg.textContent = record.error.message
    const memory = await saveMemory(note || `Saved document: ${file.name}`)
    await supabase.from('memories').update({memory_type:'document',document_id:record.data.id}).eq('id',memory.id)
    toast('Document remembered')
    documents()
  }
}


async function importChatGPTFile(file) {
  let parsed
  try { parsed = JSON.parse(await file.text()) } catch { throw new Error('Choose conversations.json from your ChatGPT data export.') }
  if (!Array.isArray(parsed)) throw new Error('This does not look like ChatGPT conversations.json.')
  const rows = []
  for (const conversation of parsed.slice(0,500)) {
    const messages = []
    for (const node of Object.values(conversation.mapping || {})) {
      const msg = node?.message
      if (msg?.author?.role !== 'user') continue
      const parts = msg?.content?.parts
      const content = Array.isArray(parts) ? parts.filter(x => typeof x === 'string').join(' ') : ''
      if (content.trim()) messages.push(content.trim())
    }
    const combined = messages.join('\n\n').slice(0,12000)
    if (!combined) continue
    rows.push({user_id:user.id,original_text:combined,summary:conversation.title || 'Imported ChatGPT conversation',memory_type:'conversation',state:'historical',occurred_at:conversation.create_time ? new Date(conversation.create_time*1000).toISOString() : new Date().toISOString(),source_type:'chatgpt_import',provenance_kind:'imported',confidence:1,interpreted_data:{conversation_title:conversation.title || null},metadata:{imported_from:'ChatGPT export'},valid_from:new Date().toISOString()})
  }
  if (!rows.length) throw new Error('No user messages were found in that export.')
  for (let i=0;i<rows.length;i+=50) {
    const {error} = await supabase.from('memories').insert(rows.slice(i,i+50))
    if (error) throw error
  }
  return rows.length
}

async function connections() {
  const providers = [
    ['chatgpt','ChatGPT','Import your official ChatGPT conversations.json export into searchable memories.','Available now','violet'],
    ['maps','Google Maps Timeline','Bring exported location history into your life timeline and places.','Import option','teal'],
    ['calendar','Google Calendar','Turn meetings, trips and events into life context.','OAuth setup next','coral'],
    ['gmail','Gmail','Remember selected receipts, bookings and important conversations.','OAuth setup next','pink'],
    ['drive','Google Drive','Index files you choose without making them public.','OAuth setup next','blue'],
    ['photos','Google Photos','Use selected photos as visual anchors for moments and places.','OAuth setup next','pink'],
    ['microsoft','Microsoft 365','Future connection for Outlook, Calendar, OneDrive and SharePoint.','OAuth setup next','blue'],
    ['files','Files and archives','Documents can already be saved directly in Memora.','Available now','amber']
  ]
  app.innerHTML = shell(`<section class="connections-hero"><span class="premium-eyebrow">MEMORY SOURCES</span><h3>Connect the places your life already lives</h3><p>Memora is designed to become one private index across conversations, calendars, locations, photos and files. Only working imports are marked available.</p></section><div class="connection-grid">${providers.map(([id,name,desc,status,tone]) => `<article class="connection-card tone-${tone}"><div class="connection-logo">${name.slice(0,1)}</div><div><div class="connection-head"><h3>${name}</h3><span>${status}</span></div><p>${desc}</p><button class="btn" data-source="${id}">${id === 'chatgpt' ? 'Import export' : id === 'files' ? 'Open Documents' : id === 'maps' ? 'Add export' : 'Connect'}</button></div></article>`).join('')}</div><input type="file" id="chatgptImport" accept=".json,application/json" hidden><input type="file" id="mapsImport" accept=".json,application/json" hidden>`,'Connections')
  wire()
  document.querySelectorAll('[data-source]').forEach(button => button.onclick = () => {
    const id = button.dataset.source
    if (id === 'chatgpt') return document.getElementById('chatgptImport').click()
    if (id === 'maps') return document.getElementById('mapsImport').click()
    if (id === 'files') return go('documents')
    toast('This connection needs its provider OAuth setup in a later build. No fake connection was created.')
  })
  document.getElementById('chatgptImport').onchange = async e => {
    const file = e.target.files[0]; if (!file) return
    try { toast('Importing ChatGPT memories...'); const count = await importChatGPTFile(file); toast(`${count} ChatGPT conversations imported`) } catch (error) { toast(error.message) }
  }
  document.getElementById('mapsImport').onchange = e => { if (e.target.files[0]) toast('Maps Timeline export selected. Format-specific parsing will be added next.') }
}


async function settings() {
  const { data:profile } = await supabase.from('profiles').select('*').maybeSingle()
  app.innerHTML = shell(`
    <div class="grid two">
      <div class="card item">
        <h3>Profile</h3>
        <input class="input" id="displayName" value="${esc(profile?.display_name || '')}" placeholder="Display name">
        <input class="input" id="timezone" value="${esc(profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)}" placeholder="Timezone">
        <button class="btn primary" id="saveProfile">Save profile</button>
      </div>
      <div class="card item">
        <h3>Privacy and data</h3>
        <p class="muted">Your rows are restricted by Supabase Row Level Security. Documents are stored in a private user folder.</p>
        <button class="btn" id="exportData">Export memories as JSON</button>
        <button class="btn danger" id="deleteAll">Delete all memories</button>
      </div>
    </div>
  `,'Settings')
  wire()
  document.getElementById('saveProfile').onclick = async () => {
    const display_name = document.getElementById('displayName').value.trim()
    const timezone = document.getElementById('timezone').value.trim()
    const { error } = await supabase.from('profiles').upsert({user_id:user.id,display_name,timezone})
    toast(error ? error.message : 'Profile saved')
  }
  document.getElementById('exportData').onclick = async () => {
    const { data } = await supabase.from('memories').select('*').order('created_at')
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'memora-memories.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  document.getElementById('deleteAll').onclick = async () => {
    if (!confirm('Delete all of your memories? This cannot be undone.')) return
    const { error } = await supabase.from('memories').delete().eq('user_id',user.id)
    toast(error ? error.message : 'Memories deleted')
  }
}

const session = await supabase.auth.getSession()
user = session.data.session?.user || null
supabase.auth.onAuthStateChange((_event,sessionNow) => { user = sessionNow?.user || null })
if (user) render()
else authScreen()

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {})
