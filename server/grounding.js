// Query-focused retrieval for already-authorized rows (Supabase JWT + RLS).
// This is keyword grounding, NOT vector search, source verification, or full RAG.
const ignored=new Set('a an and are as at be been but by can could did do does for from had has have how i in is it me my of on or our please show tell the their there these this those to was were what when where which who why will with you your about saved memory memories information find'.split(' '))
const aliases={wedding:'marriage',married:'marriage',ceremony:'marriage',wed:'marriage',kalyanam:'marriage',thirumanam:'marriage',shaadi:'marriage',location:'place',address:'place',venue:'place',gps:'place',mom:'mother',mum:'mother',dad:'father',daddy:'father',boss:'manager',job:'work',office:'work',employment:'work',birthday:'birth',born:'birth'}
export function queryTerms(text){
  return [...new Set((String(text||'').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).map(t=>aliases[t]||t).filter(t=>t.length>1&&!ignored.has(t)))]
}
function clean(value,limit=2400){return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit)}
function rank(question,items){
 const q=queryTerms(question)
 return (Array.isArray(items)?items:[]).map((source,i)=>{
  const title=clean(source.title,260),content=clean(source.content,2400)
  const headline=new Set(queryTerms(title)),body=new Set(queryTerms(content))
  let hits=0
  for(const t of q) hits+=(headline.has(t)?3:0)+(body.has(t)?1:0)
  const score=q.length?hits/(q.length*4):0
  return {item:{...source,title,content},index:i,score,hits}
 }).sort((a,b)=>b.score-a.score||a.index-b.index)
}
export function selectGroundedEvidence(question,items,{limit=12,maxChars=11000}={}){
  const q=queryTerms(question),chosen=[],seen=new Set()
  let total=0
  for(const result of rank(question,items)){
    if(chosen.length>=limit||total>=maxChars)break
    if(q.length&&!result.hits)continue
    const item=result.item
    if(!item.content)continue
    const key=clean(item.origin_id||item.id,100)||item.content.toLowerCase()
    if(seen.has(key))continue
    const budget=maxChars-total-item.title.length-60
    if(budget<100)break
    const selected={...item,content:item.content.slice(0,budget)}
    chosen.push(selected);seen.add(key);total+=selected.content.length+selected.title.length+60
  }
  return {items:chosen,hasEvidence:chosen.length>0,sources:chosen.map(x=>({id:clean(x.id,100),memoryId:x.kind==='memory'?clean(x.origin_id||'',80):null,kind:clean(x.kind,50),title:clean(x.title||'Saved memory',160),occurredAt:x.occurred_at||null}))}
}
export function fuseAuthorizedRanks(keyword=[],semantic=[],k=60,limit=15){
 const output=new Map()
 for(const [channel,items] of [['keyword',keyword],['semantic',semantic]]){
  for(const [i,item] of items.entries()){
   if(!item?.id)continue
   const id=String(item.id),entry=output.get(id)||{...item,score:0,matchedBy:[]}
   entry.score+=1/(Math.max(1,k)+i+1)
   entry.matchedBy.push(channel);output.set(id,entry)
  }
 }
 return [...output.values()].sort((a,b)=>b.score-a.score).slice(0,limit)
}
