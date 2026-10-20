// Normalize media queries without rewriting artist names or non-Latin titles.
const commonCorrections={
 mobie:'movie',moive:'movie',mvoie:'movie',movi:'movie',movei:'movie',
 sogn:'song',sogns:'songs',snogs:'songs',musci:'music',muisc:'music',
 malaylam:'malayalam',malayalm:'malayalam',malayalum:'malayalam',malyalam:'malayalam',
 tmail:'tamil',chirstian:'christian',christain:'christian',devotinal:'devotional',
 devoitional:'devotional',devoytponal:'devotional'
}
const genericTerms=['devotional','christian','malayalam','tamil','telugu','hindi','kannada','music','movie','songs','song','radio','worship','gospel','instrumental','playlist','albums']
function editDistance(a,b){
 const prev=Array.from({length:b.length+1},(_,i)=>i)
 for(let i=1;i<=a.length;i++){
   const next=[i]
   for(let j=1;j<=b.length;j++){
     next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1))
   }
   for(let j=0;j<next.length;j++)prev[j]=next[j]
 }
 return prev[b.length]
}
function correctToken(word){
 if(commonCorrections[word])return commonCorrections[word]
 if(genericTerms.includes(word)||word.length<5)return word
 let closest=word,distance=Infinity
 for(const candidate of genericTerms){
   if(Math.abs(candidate.length-word.length)>2)continue
   const d=editDistance(word,candidate)
   if(d<distance){closest=candidate;distance=d}
 }
 return distance<=(word.length>8?2:1)?closest:word
}
export function normalizeMusicQuery(value=''){
 return String(value).normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ').replace(/[a-z]+/g,correctToken).slice(0,120)
}
export function musicQueryVariants(value=''){
 const query=normalizeMusicQuery(value)
 const concise=query.replace(/\b(?:music|songs?|tracks?)\b/g,' ').replace(/\s+/g,' ').trim()
 const gospel=concise.replace(/\bchristian\b/g,'gospel')
 return [...new Set([query,concise,gospel].filter(Boolean))]
}
