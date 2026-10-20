// Conservative lexical retrieval used when AI reasoning is unavailable.
// A memory must match the topic, not merely words such as "date" or "time".
const topicAliases={
  wedding:['wedding','marriage','married','weds','wed','nuptials','reception','ceremony','kalyanam','thirumanam'],
  pickup:['pickup','pick','picked','picking','pick up','picking up','collect','collection','school pickup','pick-up'],
  birthday:['birthday','born','birth','date of birth','dob'],
  appointment:['appointment','meeting','session','consultation','visit'],
  location:['location','place','address','venue','where'],
  music:['music','song','songs','radio','track'],
  manager:['manager','boss','supervisor'],
  work:['work','working','office','job','employer','company'],
  family:['family','relative','relations'],
  time:['time','timing','clock','hour'],
  date:['date','day','month','year','when']
}
const propertyTokens=new Set(['location','time','date','day','place','address','venue','when','where','year','month','clock','hour'])
const ignoredTokens=new Set(['i','me','my','mine','we','our','the','and','or','of','a','an','to','at','in','on','for','from','about','what','where','when','who','which','is','was','were','does','do','did','have','has','had','will','would','can','could','please','find','show','tell','memory','memories','remember','recorded','stored','information','details'])
const aliasIndex=new Map()
for(const [canonical,aliases] of Object.entries(topicAliases)){
  for(const alias of aliases){
    if(!alias.includes(' ')) aliasIndex.set(alias,canonical)
  }
}
function topicTerms(value){
  let text=String(value||'').toLocaleLowerCase('en')
  for(const [canonical,aliases] of Object.entries(topicAliases)){
    for(const a of aliases.filter(x=>x.includes(' '))) text=text.replaceAll(a,canonical)
  }
  return [...new Set((text.match(/[\p{L}\p{N}]+/gu)||[])
    .map(term=>aliasIndex.get(term)||term)
    .filter(term=>term.length>1&&!ignoredTokens.has(term)))]
}
export function memoryRelevance(question,item){
  const terms=topicTerms(question)
  const text=[item.original_text,item.summary,item.content,item.title,item.name].filter(Boolean).join(' ')
  if(!text.trim()) return 0
  const available=new Set(topicTerms(text))
  const main=terms.filter(t=>!propertyTokens.has(t))
  const properties=terms.filter(t=>propertyTokens.has(t))
  // A date request must never match an unrelated reminder just because both
  // contain a weekday or time.
  if(!main.length) return 0
  let matched=0
  for(const term of main){
    if(available.has(term)||[...available].some(t=>t.startsWith(term)&&term.length>=4))matched++
  }
  if(!matched) return 0
  const coverage=matched/main.length
  if(main.length>1 && coverage<0.5)return 0
  let score=0.48+0.44*coverage
  score+=Math.min(0.08,properties.filter(t=>available.has(t)).length*0.03)
  return Math.min(1,score)
}
export function rankMemoryResults(question,items=[],limit=30){
  return items.map(item=>({...item,relevanceScore:memoryRelevance(question,item)}))
    .filter(item=>item.relevanceScore>=0.7)
    .sort((a,b)=>b.relevanceScore-a.relevanceScore||
      new Date(b.occurred_at||b.created_at||0)-new Date(a.occurred_at||a.created_at||0))
    .slice(0,limit)
}
export function questionNeedsMemoryTopic(question){
  return topicTerms(question).some(t=>!propertyTokens.has(t))
}
