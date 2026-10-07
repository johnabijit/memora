import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
const app = document.getElementById('app')
let user = null
let view = 'home'
let chat = []

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
      const { data, error } = await supabase.auth.signUp({email,password,options:{data:{display_name}}})
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

async function home() {
  const [{ count:memoryCount },{ count:thingCount },{ data:recent }] = await Promise.all([
    supabase.from('memories').select('*',{count:'exact',head:true}),
    supabase.from('things').select('*',{count:'exact',head:true}),
    supabase.from('memories').select('*').order('created_at',{ascending:false}).limit(5)
  ])
  app.innerHTML = shell(`
    <section class="card hero">
      <h3>What would you like me to remember?</h3>
      <p>Tell Memora something from your life. Try "I kept my passport in the second drawer" or "I played basketball today".</p>
      <div class="capture"><textarea id="memoryInput" class="input" placeholder="Tell Memora anything..."></textarea><button class="btn primary" id="saveMemory">Remember</button></div>
    </section>
    <div class="grid three">
      <div class="card stat"><span class="muted">Memories</span><b>${memoryCount || 0}</b></div>
      <div class="card stat"><span class="muted">Things tracked</span><b>${thingCount || 0}</b></div>
      <div class="card stat"><span class="muted">Privacy</span><b>RLS</b></div>
    </div>
    <div class="section-title"><h3>Recent memories</h3></div>
    <div class="list">${recent?.length ? recent.map(memoryCard).join('') : '<div class="card empty">Your memory space is empty.</div>'}</div>
  `,'Home')
  wire()
  document.getElementById('saveMemory').onclick = async () => {
    const input = document.getElementById('memoryInput')
    const text = input.value.trim()
    if (!text) return
    try {
      await saveMemory(text)
      input.value = ''
      toast('Memory saved')
      await home()
    } catch (error) {
      toast(error.message)
    }
  }
}

function memoryCard(m) {
  return `<div class="card item">
    <div class="item-head"><strong>${esc(m.summary || m.original_text)}</strong><span class="pill">${esc(m.memory_type)}</span></div>
    <div>${esc(m.original_text)}</div>
    <div class="muted">${when(m.occurred_at || m.created_at)} | Source: ${esc(m.provenance_kind || m.source_type || 'user')}</div>
    <div class="actions"><button class="btn danger" data-delete-memory="${m.id}">Delete</button></div>
  </div>`
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
  document.getElementById('searchMemory').onclick = async () => {
    const q = document.getElementById('memorySearch').value.trim()
    if (!q) return memories()
    const result = await supabase.rpc('search_memories',{search_query:q,result_limit:50})
    document.getElementById('memoryList').innerHTML = result.error ? esc(result.error.message) : result.data?.length ? result.data.map(m => memoryCard({...m,created_at:m.occurred_at})).join('') : '<div class="card empty">No matching memories.</div>'
    bindDeletes()
  }
}

function bindDeletes() {
  document.querySelectorAll('[data-delete-memory]').forEach(button => button.onclick = async () => {
    if (!confirm('Delete this memory?')) return
    const { error } = await supabase.from('memories').delete().eq('id',button.dataset.deleteMemory)
    if (error) toast(error.message)
    else {
      toast('Memory deleted')
      memories()
    }
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
    <div class="timeline">${data?.length ? data.map(m => `<div class="card item"><strong>${esc(m.summary || m.original_text)}</strong><div>${esc(m.original_text)}</div><div class="muted">${when(m.occurred_at)}</div></div>`).join('') : '<div class="card empty">Your timeline is empty.</div>'}</div>
  `,'Timeline')
  wire()
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
  app.innerHTML = shell(`
    <div class="card item">
      <strong>Upload a document</strong>
      <label class="btn file-label">Choose file<input type="file" id="fileInput"></label>
      <span class="muted" id="uploadMsg"></span>
    </div>
    <div class="section-title"><h3>Your documents</h3></div>
    <div class="list">${data?.length ? data.map(d => `<div class="card item"><strong>${esc(d.file_name)}</strong><div class="muted">${esc(d.mime_type || '')} | ${when(d.created_at)}</div></div>`).join('') : '<div class="card empty">No documents uploaded yet.</div>'}</div>
  `,'Documents')
  wire()
  document.getElementById('fileInput').onchange = async event => {
    const file = event.target.files[0]
    if (!file) return
    const msg = document.getElementById('uploadMsg')
    msg.textContent = 'Uploading...'
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path = `${user.id}/${Date.now()}-${safe}`
    const uploaded = await supabase.storage.from('memora-documents').upload(path,file)
    if (uploaded.error) return msg.textContent = uploaded.error.message
    const record = await supabase.from('documents').insert({user_id:user.id,file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size})
    if (record.error) return msg.textContent = record.error.message
    toast('Document uploaded')
    documents()
  }
}

async function connections() {
  const providers = [
    ['Google Maps Timeline','Import/export integration planned'],
    ['Google Calendar','Connector planned'],
    ['Gmail','Connector planned'],
    ['Google Drive','Connector planned'],
    ['Google Photos','Connector planned'],
    ['Microsoft Outlook','Connector planned'],
    ['OneDrive','Connector planned'],
    ['SharePoint','Connector planned'],
    ['ChatGPT Export','Import planned']
  ]
  app.innerHTML = shell(`<div class="grid two">${providers.map(([name,description]) => `<div class="card item"><strong>${name}</strong><div class="muted">${description}</div><span class="pill">Coming soon</span></div>`).join('')}</div>`,'Connections')
  wire()
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
