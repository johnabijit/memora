import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM, VirtualConsole } from 'jsdom'

const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'')
const runtime=(await readFile('client/runtime.js','utf8')).replace(/^export /gm,'')
const facts=[
  {fact_key:'work.manager',category:'work',value_text:'Alice'},
  {fact_key:'family.brother.1',category:'family',predicate:'brother',value_text:'Adam',ordinal:1,age_relation:'elder'},
  {fact_key:'family.brother.2',category:'family',predicate:'brother',value_text:'Ben',ordinal:2,age_relation:'elder'},
  {fact_key:'family.sister.1',category:'family',predicate:'sister',value_text:'Clara',ordinal:1,age_relation:'younger'},
  {fact_key:'family.sister.2',category:'family',predicate:'sister',value_text:'Dana',ordinal:2,age_relation:'younger'}
]

async function appFixture({blockedStorage=false,slowProviders=false,passkeyAvailable=false,memoryRows=[]}={}) {
  const dom=new JSDOM('<div id="app"></div>',{url:'https://memora.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
  const w=dom.window
  w.SUPABASE_URL='https://fixture.supabase.co'
  w.SUPABASE_PUBLISHABLE_KEY='fixture-publishable-key'
  w.AbortSignal=AbortSignal
  w.fetch=async()=>slowProviders?new Promise(()=>{}):Response.json({external:{}})
  w.matchMedia=()=>({matches:false,addEventListener(){}})
  w.HTMLMediaElement.prototype.load=function(){}
  w.HTMLMediaElement.prototype.play=async function(){this._playing=true;this.dispatchEvent(new w.Event('play'))}
  w.HTMLMediaElement.prototype.pause=function(){this._playing=false}
  Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{get(){return !this._playing}})
  if(blockedStorage) Object.defineProperty(w,'localStorage',{get(){throw new Error('Storage denied')}})
  if(passkeyAvailable){w.isSecureContext=true;Object.defineProperty(w.navigator,'credentials',{value:{}})}
  w.createClient=()=>({
    rpc:async()=>({data:[{entity_id:'m1',title:'My saved guitar',content:'Stored in the music room',metadata:{}}]}),
    auth:{
      getSession:async()=>({data:{session:null}}),
      getUser:async()=>({data:{user:{id:'fixture-user',phone:''}},error:null}),
      updateUser:async()=>({data:{user:{id:'fixture-user'}},error:null}),
      onAuthStateChange:()=>({}),
      signInWithPassword:async()=>({data:{},error:{message:'Invalid login credentials'}}),
      signInWithPasskey:passkeyAvailable?async()=>({data:null,error:{code:'passkey_disabled',message:'Passkey authentication disabled'}}):undefined,
      registerPasskey:passkeyAvailable?async()=>({data:null,error:{code:'passkey_disabled',message:'Passkey authentication disabled'}}):undefined,
      signInWithOtp:async()=>({error:null}),
      verifyOtp:async payload=>({data:{session:{user:{id:'fixture-user'}},user:{id:'fixture-user'}},error:null}),
      resend:async payload=>({error:null})
    },
    from(table){
      const chain=new Proxy({}, {get(_,key){
        if(key==='then') return resolve=>resolve({data:table==='memory_facts'?facts:table==='memories'?memoryRows:[],error:null})
        if(key==='maybeSingle'||key==='single') return async()=>({data:key==='single'&&table==='chat_threads'?{id:'fixture-thread',title:'New chat'}:null,error:null})
        return ()=>chain
      }})
      return chain
    }
  })
  const relevance=(await readFile('client/relevant-memory.js','utf8')).replace(/^export /gm,'')
  w.eval((await readFile('shared/music-search.js','utf8')).replace(/^export /gm,'')+'\n'+runtime+'\n'+relevance+'\n'+source+`\nwindow.testApi={youtubeTarget,memorySearchSnippet,openMusicFinder,openSoundscapePicker,loadMusicCollections,openGlobalSearch,home,settings,answer,answerFromStructuredFacts,relationNamesFromText,cleanAnswerText,loadMediaLibrary,selectMediaTrack,previousMediaTrack,nextMediaTrack,ensureMediaPlayer,mediaPlayerState,setUser(){user={id:'fixture-user'}},setMode(mode){mediaPlayerState.mode=mode},resetRecovery(){mediaRecoveryAttempts=0}}`)
  for(let i=0;i<10&&!w.memoraReady;i++) await new Promise(resolve=>setTimeout(resolve,10))
  return {dom,w,api:w.testApi}
}

test('startup renders email login even when browser storage is denied',async()=>{
  const {dom,w}=await appFixture({blockedStorage:true})
  try{
    assert.equal(w.memoraReady,true)
    assert.ok(w.document.getElementById('authForm'))
    assert.equal(w.document.querySelectorAll('[data-oauth]').length,0)
    assert.equal(w.document.querySelectorAll('[data-provider-setup]').length,0)
    assert.equal(w.document.getElementById('password').hasAttribute('minlength'),false)
  }finally{dom.window.close()}
})

test('invalid email/password login displays an error and releases the submit button',async()=>{
  const {dom,w}=await appFixture()
  try{
    const form=w.document.getElementById('authForm')
    w.document.getElementById('email').value='fixture@example.com'
    w.document.getElementById('password').value='fixture-password'
    await form.onsubmit({preventDefault(){},currentTarget:form})
    assert.equal(w.document.getElementById('authMsg').textContent,'Invalid login credentials')
    assert.equal(form.querySelector('[type="submit"]').disabled,false)
  }finally{dom.window.close()}
})

test('manager, family ordering and conversational follow-ups answer only the requested fact',async()=>{
  const {dom,api}=await appFixture()
  try{
    assert.equal((await api.answerFromStructuredFacts('Who is my manger?')).text,'Your manager is Alice.')
    assert.equal((await api.answerFromStructuredFacts('Who is my eldest brother?')).text,'Your eldest brother is Adam.')
    assert.equal((await api.answerFromStructuredFacts('And the second?')).text,'Your second brother is Ben.')
    assert.equal((await api.answerFromStructuredFacts('Who is my youngest sister?')).text,'Your youngest sister is Dana.')
    assert.equal(api.relationNamesFromText('brother','My elder brothers are Adam, then Ben.').join(','),'Adam,Ben')
    assert.equal(api.relationNamesFromText('sister','My younger sisters are Clara and Dana.').join(','),'Clara,Dana')
    assert.equal(api.cleanAnswerText('Your manager is Alice.\\n{}'),'Your manager is Alice.')
  }finally{dom.window.close()}
})

test('HTML API failures produce a readable error instead of JSON parse text',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    w.fetch=async()=>new Response('<!doctype html>',{headers:{'content-type':'text/html'}})
    await assert.rejects(api.loadMediaLibrary('music','fixture'),/Memora service is unavailable/)
    assert.equal(api.mediaPlayerState.loading,false)
  }finally{dom.window.close()}
})

test('an older catalog response cannot overwrite a newer music search',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    let firstResolve
    w.fetch=async url=>url.includes('q=older')?await new Promise(resolve=>{firstResolve=resolve}):Response.json({items:[{id:'new',title:'New result',url:'https://fixture.test/new.mp3',type:'music'}],hasMore:false})
    const older=api.loadMediaLibrary('music','older',50,{preserveCurrent:true})
    await api.loadMediaLibrary('music','newer',50,{preserveCurrent:true})
    firstResolve(Response.json({items:[{id:'old',title:'Stale result'}]}))
    await older
    assert.equal(api.mediaPlayerState.library[0].id,'new')
    assert.equal(api.mediaPlayerState.musicQuery,'newer')
    assert.equal(api.mediaPlayerState.loading,false)
  }finally{dom.window.close()}
})

test('audio starts from a user action and a failed stream stops after bounded retries',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    api.setUser()
    const item={id:'fixture-track',title:'Fixture',type:'music',url:'https://fixture.test/song.mp3'}
    api.mediaPlayerState.library=[item]
    await api.selectMediaTrack(item,false)
    const audio=w.document.getElementById('memoraAudio')
    assert.equal(audio.paused,true)
    await api.selectMediaTrack(item,true)
    assert.equal(audio.paused,false)
    audio.dispatchEvent(new w.Event('error'))
    audio.dispatchEvent(new w.Event('error'))
    assert.equal(audio.paused,true)
    assert.match(w.document.getElementById('playerStatus').textContent,/Stream unavailable/)
  }finally{dom.window.close()}
})

test('previous and next controls move through the selected queue',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    api.setUser()
    api.mediaPlayerState.library=[
      {id:'first',title:'First',type:'music',url:'https://fixture.test/first.mp3'},
      {id:'second',title:'Second',type:'music',url:'https://fixture.test/second.mp3'}
    ]
    api.mediaPlayerState.musicHasMore=false
    await api.selectMediaTrack(api.mediaPlayerState.library[0],false)
    await api.previousMediaTrack(true)
    assert.equal(api.mediaPlayerState.current.id,'second')
    assert.equal(w.document.getElementById('memoraAudio').paused,false)
    await api.nextMediaTrack(false)
    assert.equal(api.mediaPlayerState.current.id,'first')
    assert.equal(w.document.getElementById('memoraAudio').paused,true)
  }finally{dom.window.close()}
})

 test('email form is ready even when provider discovery never responds',async()=>{
  const {dom,w}=await appFixture({slowProviders:true})
  try{
    assert.equal(w.memoraReady,true)
    assert.ok(w.document.getElementById('authForm'))
    assert.equal(w.document.getElementById('authForm').querySelector('[type="submit"]').disabled,false)
  }finally{dom.window.close()}
})

test('unavailable AI cannot turn a general request into an unrelated memory answer',async()=>{
  const {dom,api}=await appFixture()
  try{
    const result=await api.answer('Reply with one short sentence confirming you can respond. This is a deployment test.')
    assert.equal(result.source,'AI unavailable; saved memory search checked')
    assert.match(result.text,/AI reasoning is temporarily unavailable/)
    assert.doesNotMatch(result.text,/I found this relevant memory/)
  }finally{dom.window.close()}
})


test('global search keeps personal queries private and public search requires an explicit scope',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    const requests=[]
    w.fetch=async url=>{requests.push(String(url));return Response.json({items:[{title:'Open song',artist:'Artist',url:'/track',type:'music'}]})}
    api.openGlobalSearch()
    const form=w.document.querySelector('.global-search-form'), input=form.querySelector('input'), scope=form.querySelector('select')
    input.value='my guitar'
    await form.onsubmit({preventDefault(){}})
    assert.equal(requests.length,0)
    assert.match(w.document.querySelector('.global-search-results').textContent,/Stored in the music room/)
    scope.value='music';scope.onchange();input.value='open song'
    await form.onsubmit({preventDefault(){}})
    assert.equal(requests.length,1)
    assert.match(requests[0],/open-music/)
    assert.match(w.document.querySelector('.global-search-results').textContent,/Open song/)
    scope.value='web';scope.onchange();input.value='books & music'
    await form.onsubmit({preventDefault(){}})
    assert.equal(requests.length,1)
    assert.match(w.document.querySelector('.search-external a').href,/books%20%26%20music/)
  }finally{dom.window.close()}
})

test('changing search scope discards pending music results',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    let resolve
    w.fetch=()=>new Promise(r=>{resolve=r})
    api.openGlobalSearch()
    const form=w.document.querySelector('.global-search-form'),scope=form.querySelector('select')
    scope.value='music';form.querySelector('input').value='old song'
    const pending=form.onsubmit({preventDefault(){}})
    scope.value='memories';scope.onchange()
    resolve(Response.json({items:[{title:'Old song'}]}));await pending
    assert.equal(w.document.querySelector('.global-search-results').textContent,'')
  }finally{dom.window.close()}
})


test('memory search snippets omit extraction JSON and stay readable',async()=>{
  const {dom,api}=await appFixture()
  try{
    assert.equal(api.memorySearchSnippet({summary:'Saved note',original_text:'Saved note Saved note {"image_text":"raw OCR"} raw OCR'}),'')
    assert.ok(api.memorySearchSnippet({original_text:'x'.repeat(500)}).length<=401)
    assert.equal(api.memorySearchSnippet({summary:'Note',original_text:'Note Note {}'}),'')
  }finally{dom.window.close()}
})

test('YouTube player accepts video and playlist links but rejects unrelated or unsafe URLs',async()=>{
  const {dom,api}=await appFixture()
  try{
    assert.match(api.youtubeTarget('https://youtu.be/abcdefghijk').embed,/youtube-nocookie.com\/embed\/abcdefghijk$/)
    assert.match(api.youtubeTarget('https://www.youtube.com/playlist?list=PL123456789012345').embed,/videoseries/)
    for(const value of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=abcdefghijk','https://user:pass@youtube.com/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=bad'])assert.equal(api.youtubeTarget(value),null)
  }finally{dom.window.close()}
})

test('artist discovery expands SPB and keeps movie and playlist queries distinct',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    api.openMusicFinder('SPB')
    const query=w.document.querySelector('#songFinderQuery'),kind=w.document.querySelector('#songFinderKind')
    assert.match(w.document.querySelector('#songFinderLinks a').href,/S\.\+P\.\+Balasubrahmanyam/)
    query.value='Anirudh';kind.value='playlist';kind.onchange()
    assert.match(w.document.querySelector('#songFinderLinks a').href,/anirudh\+songs\+playlist/)
    kind.value='movie';kind.onchange()
    assert.match(w.document.querySelector('#songFinderLinks a').href,/movie\+soundtrack/)
  }finally{dom.window.close()}
})

test('audio controls open even when radio directory services never respond',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    w.fetch=()=>new Promise(()=>{})
    api.openSoundscapePicker()
    assert.ok(w.document.querySelector('.audio-hub-modal'))
    assert.ok(w.document.querySelector('#worldSongFinder'))
    assert.ok(w.document.querySelector('#libraryMute'))
  }finally{dom.window.close()}
})

test('out-of-order album searches cannot overwrite the latest collection results',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    const pending=[];w.fetch=()=>new Promise(r=>pending.push(r))
    const first=api.loadMusicCollections('old'),second=api.loadMusicCollections('new')
    pending[1](Response.json({items:[{id:'new'}]}));await second
    pending[0](Response.json({items:[{id:'old'}]}));await first
    assert.equal(api.mediaPlayerState.musicCollections[0].id,'new')
  }finally{dom.window.close()}
})


test('passkey login invokes secure Supabase challenge and reports disabled service honestly',async()=>{
  const {dom,w}=await appFixture({passkeyAvailable:true})
  try{
    const button=w.document.getElementById('passkeyLogin')
    assert.ok(button)
    button.click()
    await new Promise(resolve=>setTimeout(resolve,16))
    assert.match(w.document.getElementById('passkeyLoginStatus').textContent,/not enabled/i)
    assert.equal(button.disabled,false)
    assert.ok(w.document.getElementById('authForm'))
  }finally{dom.window.close()}
})
test('passkey option is hidden when browser or native WebView lacks WebAuthn',async()=>{
  const {dom,w}=await appFixture()
  try{assert.equal(w.document.getElementById('passkeyLogin'),null)}finally{dom.window.close()}
})



test('email and social sign-in remain, while SMS signup and phone linking are completely absent',async()=>{
  const {dom,w,api}=await appFixture()
  try{
    assert.ok(w.document.getElementById('authForm'))
    for(const id of ['authPhoneTab','phoneAuthForm','phoneOtpForm','phoneAuthMsg','phoneCountry']) assert.equal(w.document.getElementById(id),null)
    api.setUser()
    await api.settings()
    for(const id of ['linkMobileNumber','linkedPhoneState','linkPhoneStart'])assert.equal(w.document.getElementById(id),null)
  }finally{dom.window.close()}
})

test('Ask Memora answers paraphrased wedding questions from saved memory without AI credits',async()=>{
 const {dom,api}=await appFixture({memoryRows:[
   {id:'wedding-1',original_text:'My marriage was at Divine Mercy Church on 21 December 2026 at 4:00 PM.',
     created_at:'2026-10-20T10:00:00Z',occurred_at:'2026-10-20T10:00:00Z'},
   {id:'pickup-1',original_text:'I collect Ahay at 4:50 pm on workdays.'}
 ]})
 try{
   api.setUser()
   const answer=await api.answer('What is my wedding date?')
   assert.match(answer.text,/21 December 2026/)
   assert.doesNotMatch(answer.text,/4:50 pm/i)
   const place=await api.answer('Where was my marriage?')
   assert.match(place.text,/Divine Mercy Church/)
   const followup=await api.answer('At what time?')
   assert.match(followup.text,/4:00 PM/i)
 }finally{dom.window.close()}
})
test('Ask Memora refuses to invent a missing wedding date',async()=>{
 const {dom,api}=await appFixture({memoryRows:[{id:'wedding',original_text:'My marriage was at Divine Mercy Church.'}]})
 try{
   api.setUser()
   const a=await api.answer('What is my wedding date?')
   assert.match(a.text,/does not state a clear date/)
 }finally{dom.window.close()}
})


test('global search exposes explicit memories music radio and web categories without leaking personal searches',async()=>{
 const {dom,w,api}=await appFixture()
 try{
   let publicRequests=[]
   w.fetch=async url=>{publicRequests.push(String(url));return Response.json({items:[{id:'r1',title:'Bhakti Bhajan Live',url:'https://fixture.test/bhajan.mp3',type:'radio',country:'India'}]})}
   api.openGlobalSearch()
   const form=w.document.querySelector('.global-search-form')
   const input=w.document.getElementById('globalSearchQuery')
   input.value='my marriage date'
   await form.onsubmit({preventDefault(){}})
   assert.equal(publicRequests.length,0)
   assert.equal(w.document.getElementById('globalSearchScope').value,'memories')
   const tabs=w.document.querySelectorAll('[data-search-category]')
   assert.equal(tabs.length,4)
   w.document.querySelector('[data-search-category="radio"]').click()
   assert.equal(w.document.getElementById('globalSearchScope').value,'radio')
   input.value='Hindu radio'
   await form.onsubmit({preventDefault(){}})
   assert.equal(publicRequests.length,1)
   assert.match(publicRequests[0],/api\/audio-library\?/)
   assert.match(publicRequests[0],/mode=devotional/)
   assert.match(publicRequests[0],/tradition=hindu/)
   assert.match(w.document.querySelector('.global-search-results').textContent,/Bhakti Bhajan Live/)
   assert.equal(w.document.querySelector('.global-search-results .btn').textContent,'▶ Play now')
 }finally{dom.window.close()}
})
test('search or ask routes questions to Ask without starting a public media search',async()=>{
 const {dom,w,api}=await appFixture()
 try{
   api.setUser()
   let externalRequests=0
   w.fetch=async()=>{externalRequests++;return Response.json({items:[]})}
   api.openGlobalSearch()
   const input=w.document.getElementById('globalSearchQuery')
   input.value='What is my wedding date?'
   const callback=w.document.getElementById('globalAskButton').onclick
   assert.equal(typeof callback,'function')
   await callback()
   assert.equal(externalRequests,0)
   const routed=w.document.getElementById('askInput')
   assert.ok(routed)
   assert.equal(routed.value,'What is my wedding date?')
 }finally{dom.window.close()}
})
test('now playing mini player has labeled previous play next and expanded player controls',async()=>{
 const {dom,w,api}=await appFixture()
 try{
   api.setUser()
   api.ensureMediaPlayer()
   const previous=w.document.getElementById('playerPrevious')
   const play=w.document.getElementById('playerPlay')
   const next=w.document.getElementById('playerNext')
   const expanded=w.document.getElementById('playerExpand')
   for(const control of [previous,play,next,expanded]) {
     assert.ok(control)
     assert.ok(control.getAttribute('aria-label'))
   }
   assert.match(w.document.querySelector('.player-kicker').textContent,/NOW PLAYING/)
 }finally{dom.window.close()}
})

test('Remember composer offers a safe Ask instead path without saving another memory',async()=>{
 const {dom,w,api}=await appFixture()
 try{
   api.setUser()
   await api.home()
   const ask=w.document.getElementById('askFromMemoryInput')
   const save=w.document.getElementById('saveMemory')
   assert.ok(ask)
   assert.ok(save)
   w.document.getElementById('memoryInput').value='Where did I print my wedding invitations?'
   ask.click()
   await new Promise(resolve=>setTimeout(resolve,30))
   assert.equal(w.document.getElementById('askInput').value,'Where did I print my wedding invitations?')
 }finally{dom.window.close()}
})
