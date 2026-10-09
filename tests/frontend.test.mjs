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

async function appFixture({blockedStorage=false,slowProviders=false}={}) {
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
  w.createClient=()=>({
    rpc:async()=>({data:[{entity_id:'m1',title:'My saved guitar',content:'Stored in the music room',metadata:{}}]}),
    auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signInWithPassword:async()=>({data:{},error:{message:'Invalid login credentials'}})},
    from(table){
      const chain=new Proxy({}, {get(_,key){
        if(key==='then') return resolve=>resolve({data:table==='memory_facts'?facts:[],error:null})
        if(key==='maybeSingle'||key==='single') return async()=>({data:null,error:null})
        return ()=>chain
      }})
      return chain
    }
  })
  w.eval(runtime+'\n'+source+`\nwindow.testApi={youtubeTarget,memorySearchSnippet,openMusicFinder,openSoundscapePicker,loadMusicCollections,openGlobalSearch,answer,answerFromStructuredFacts,relationNamesFromText,cleanAnswerText,loadMediaLibrary,selectMediaTrack,previousMediaTrack,nextMediaTrack,ensureMediaPlayer,mediaPlayerState,setUser(){user={id:'fixture-user'}},setMode(mode){mediaPlayerState.mode=mode},resetRecovery(){mediaRecoveryAttempts=0}}`)
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
    assert.equal(result.source,'AI connection unavailable')
    assert.match(result.text,/provider connection in Sources/)
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
    assert.match(w.document.querySelector('#songFinderLinks a').href,/Anirudh\+songs\+playlist/)
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
