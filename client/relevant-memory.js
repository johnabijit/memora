// Evidence-grounded paraphrase retrieval; no paid AI or embedding API required.
// This is deliberate event/attribute reasoning, not a general language model.
const aliases={
 wedding:['wedding','marriage','married','marry','marrying','wed','nuptials','matrimony','kalyanam','thirumanam','shaadi','shadi','vivah','got married','getting married','tied the knot','tying the knot','wedding ceremony'],
 reception:['reception','wedding reception'],
 engagement:['engagement','engaged','betrothal'],
 pickup:['pickup','pick','picked','picking','pick up','picking up','collect','collection','pick-up'],
 birthday:['birthday','born','birth','date of birth','dob'],
 appointment:['appointment','meeting','session','consultation','visit'],
 location:['location','place','address','venue','where','held','took place','location of'],
 music:['music','song','songs','radio','track'],
 manager:['manager','boss','supervisor'],
 work:['work','working','office','job','employer','company'],
 family:['family','relative','relations'],
 time:['time','timing','clock','hour','what time'],
 date:['date','day','month','year','when','which day','on which date']
}
const propertyTokens=new Set(['location','time','date','day','place','address','venue','when','where','year','month','clock','hour'])
const ignoredTokens=new Set(['i','me','my','mine','we','our','the','and','or','of','a','an','to','at','in','on','for','from','about','what','where','when','who','which','is','was','were','does','do','did','have','has','had','will','would','can','could','please','find','show','tell','memory','memories','remember','recorded','stored','information','details','this','that','it','happened','held','scheduled','took','place'])
const aliasIndex=new Map()
const phrases=[]
for(const [canonical,entries] of Object.entries(aliases))for(const alias of entries){
 if(alias.includes(' '))phrases.push([alias,canonical])
 else aliasIndex.set(alias,canonical)
}
phrases.sort((a,b)=>b[0].length-a[0].length)
function normalizeText(value){
 let text=String(value||'').normalize('NFKC').toLocaleLowerCase('en')
 for(const [alias,canonical] of phrases){
  const safe=alias.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')
  text=text.replace(new RegExp('(?<![\\p{L}\\p{N}])'+safe+'(?![\\p{L}\\p{N}])','gu'),canonical)
 }
 return text
}
function topicTerms(value){
 return [...new Set((normalizeText(value).match(/[\p{L}\p{N}]+/gu)||[])
  .map(t=>aliasIndex.get(t)||t).filter(t=>t.length>1&&!ignoredTokens.has(t)))]
}
export function classifyMemoryQuestion(question){
 const terms=topicTerms(question)
 const topic=['reception','wedding','engagement','pickup','birthday','appointment'].find(t=>terms.includes(t))||null
 const property=['location','date','time'].find(t=>terms.includes(t))||null
 return {topic,property,terms}
}
export function memoryRelevance(question,item){
 const q=topicTerms(question)
 const text=[item.original_text,item.summary,item.content,item.title,item.name].filter(Boolean).join(' ')
 if(!text.trim())return 0
 const words=new Set(topicTerms(text))
 const primary=q.filter(t=>!propertyTokens.has(t))
 const attrs=q.filter(t=>propertyTokens.has(t))
 if(!primary.length)return 0
 const topic=classifyMemoryQuestion(question).topic
 if(topic&&!words.has(topic))return 0
 let hits=0
 for(const term of primary)if(words.has(term)||[...words].some(w=>term.length>=5&&w.startsWith(term)))hits++
 if(!hits)return 0
 const coverage=hits/primary.length
 if(primary.length>1&&coverage<0.5)return 0
 return Math.min(1,0.48+0.44*coverage+Math.min(0.08,attrs.filter(w=>words.has(w)).length*0.03))
}
export function rankMemoryResults(question,items=[],limit=30){
 return items.map(item=>({...item,relevanceScore:memoryRelevance(question,item)}))
 .filter(item=>item.relevanceScore>=0.7)
 .sort((a,b)=>b.relevanceScore-a.relevanceScore||new Date(b.occurred_at||b.created_at||0)-new Date(a.occurred_at||a.created_at||0))
 .slice(0,limit)
}
export function questionNeedsMemoryTopic(question){
 return topicTerms(question).some(t=>!propertyTokens.has(t))
}
const months='January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?'
const datePatterns=[
 new RegExp('\\b[0-3]?\\d(?:st|nd|rd|th)?[\\s,/.-]+(?:'+months+')[\\s,/.-]+\\d{4}\\b','i'),
 new RegExp('\\b(?:'+months+')[\\s]+[0-3]?\\d(?:st|nd|rd|th)?,?[\\s]+\\d{4}\\b','i'),
 /\b\d{4}-[01]\d-[0-3]\d\b/,
 /\b(?:1[3-9]|2\d|3[01])[/-](?:0?[1-9]|1[012])[/-]\d{4}\b/
]
function firstDate(text){for(const p of datePatterns){const m=String(text).match(p);if(m)return m[0].trim()}return null}
function firstTime(text){
 const m=String(text).match(/\b(?:at\s+)?(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)\b/i)
 ||String(text).match(/\b(?:at\s+)?(?:[01]?\d|2[0-3]):[0-5]\d\b/i)
 ||String(text).match(/\b(?:at\s+)?(?:0?[1-9]|1[0-2])\s*(?:a\.?m\.?|p\.?m\.?)\b/i)
 return m?m[0].replace(/^at\s+/i,'').trim():null
}
const events={
 wedding:/\b(wedding|marriage|married|marry|nuptials|matrimony|kalyanam|thirumanam|shaadi|shadi|vivah|tied the knot|got married|wedding ceremony)\b/i,
 reception:/\b(reception)\b/i,
 engagement:/\b(engagement|engaged|betrothal)\b/i,
 pickup:/\b(pick up|pickup|pick-up|picked|pick|collect|picking)\b/i,
 birthday:/\b(birthday|born|birth)\b/i,
 appointment:/\b(appointment|meeting|consultation)\b/i
}
function eventPassages(text,topic){
 const clauses=String(text||'').replace(/[\n\r]+/g,' ').split(/(?<=[.!?;])\s+|[,;]\s*(?=(?:the\s+)?(?:my\s+)?(?:reception|wedding|marriage|engagement)\b)|\s+and\s+(?=(?:the\s+)?(?:my\s+)?(?:reception|wedding|marriage|appointment|engagement)\b)/i).filter(Boolean)
 const found=[]
 for(let i=0;i<clauses.length;i++){
  if(!events[topic]?.test(clauses[i]))continue
  // "wedding reception" describes the reception, not the ceremony.
  if(topic==='wedding'&&/\bwedding\s+reception\b/i.test(clauses[i])&&
     !/\b(ceremony|marriage|married|nuptials)\b/i.test(clauses[i]))continue
  let part=clauses[i]
  if(!firstDate(part)&&i+1<clauses.length&&!Object.values(events).some(r=>r.test(clauses[i+1])))part+=' '+clauses[i+1]
  found.push(part)
 }
 return found
}
function eventPlace(text,topic){
 const start=topic==='wedding'?text.search(/\b(wedding|marriage|ceremony|got married|married|held)\b/i):text.search(events[topic])
 if(start<0)return null
 const m=text.slice(start).match(/\b(?:at|in)\s+(?!\d)([A-Z][\p{L}\p{N} .'&()-]{2,100}?)(?=\s+(?:on|at\s+\d|from|starting|and|with|which|where)\b|[,;.!?]|$)/u)
 return m?m[1].trim():null
}
export function extractEventDetails(memoryOrText,topic){
 const text=typeof memoryOrText==='string'?memoryOrText:
 String(memoryOrText?.original_text||memoryOrText?.content||memoryOrText?.summary||'')
 const passages=eventPassages(text,topic)
 if(!passages.length)return null
 const results=passages.map(p=>({date:firstDate(p),time:firstTime(p),location:eventPlace(p,topic),source:p.trim()}))
 return results.sort((a,b)=>Number(Boolean(b.date))-Number(Boolean(a.date))||Number(Boolean(b.time))-Number(Boolean(a.time)))[0]
}
export function answerFromEventMemory(question,items=[]){
 const intent=classifyMemoryQuestion(question)
 if(!intent.topic||!intent.property)return null
 const candidates=rankMemoryResults(question,items,20)
 for(const candidate of candidates){
  const fields=extractEventDetails(candidate,intent.topic)
  if(!fields)continue
  const value=fields[intent.property]
  if(!value)continue
  const text=intent.property==='location'?'Your saved '+intent.topic+' location is '+value+'.':
   'Your saved '+intent.topic+' '+intent.property+' is '+value+'.'
  return {text,source:'Saved memory',memoryId:candidate.id,evidence:fields.source,event:intent.topic}
 }
 // Do not block AI reasoning with a premature negative answer: the place may be
 // expressed as a shop name, nearby area, or a payment note rather than an event venue.
 return null
}
