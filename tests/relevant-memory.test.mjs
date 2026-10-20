import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryRelevance,rankMemoryResults,questionNeedsMemoryTopic,extractEventDetails,answerFromEventMemory,classifyMemoryQuestion} from '../client/relevant-memory.js'
const saved=[
 {id:'wedding',original_text:'My wedding ceremony is on 21 December 2026 at Divine Mercy Church and my reception is at CR Garden.'},
 {id:'pickup',original_text:'I have to pick Ahay every day at 4:50 pm Mondays to Saturdays.'},
 {id:'manager',original_text:'My boss Alice works in my office.'},
 {id:'music',original_text:'I listen to Tamil devotional music.'}
]
test('marriage date matches wedding, never unrelated pickup schedule',()=>{
 const ranked=rankMemoryResults('marriage date',saved)
 assert.deepEqual(ranked.map(x=>x.id),['wedding'])
})
test('location of marriage matches wedding ceremony, never other memories',()=>{
 assert.deepEqual(rankMemoryResults('location of my marriage',saved).map(x=>x.id),['wedding'])
})
test('pick up time matches the saved pickup reminder',()=>{
 assert.deepEqual(rankMemoryResults('pick up time',saved).map(x=>x.id),['pickup'])
})
test('equivalent manager terminology works without exact string matching',()=>{
 assert.deepEqual(rankMemoryResults('Who is my manager?',saved).map(x=>x.id),['manager'])
})
test('a missing subject yields zero unrelated results',()=>{
 assert.deepEqual(rankMemoryResults('flight departure time',saved),[])
 assert.equal(questionNeedsMemoryTopic('what date?'),false)
})
test('topics and data are case insensitive',()=>{
 assert.equal(memoryRelevance('MARRIAGE DATE',saved[0])>0.7,true)
})

test('semantic wedding date is answered when stored text says marriage instead',()=>{
 const memories=[{id:'1',original_text:'My marriage was at Divine Mercy Church on 21st December 2026 at 4:00 PM.'}]
 const r=answerFromEventMemory('What is my wedding date?',memories)
 assert.match(r.text,/21st December 2026/)
 assert.equal(r.memoryId,'1')
 assert.match(answerFromEventMemory('When did I get married?',memories).text,/21st December 2026/)
 assert.match(answerFromEventMemory('Where was my wedding?',memories).text,/Divine Mercy Church/)
 assert.match(answerFromEventMemory('What time was my wedding?',memories).text,/4:00 PM/)
})
test('month-first dates and alternate marriage phrases are understood',()=>{
 const memories=[{id:'1',original_text:'I tied the knot on December 21, 2026 at 4 pm.'}]
 assert.match(answerFromEventMemory('When was my marriage?',memories).text,/December 21, 2026/)
})
test('wedding and reception are distinct events in the same saved text',()=>{
 const m=[{id:'1',original_text:'My wedding was on 21 December 2026 at Divine Mercy Church and reception was on 22 December 2026 at CR Garden.'}]
 assert.match(answerFromEventMemory('what was my wedding date',m).text,/21 December 2026/)
 assert.match(answerFromEventMemory('what date was the reception',m).text,/22 December 2026/)
 assert.match(answerFromEventMemory('where was my wedding',m).text,/Divine Mercy Church/)
 assert.match(answerFromEventMemory('where was the reception',m).text,/CR Garden/)
})
test('marriage alone without a date cannot generate an inferred date',()=>{
 const m=[{id:'1',original_text:'My marriage was at Divine Mercy Church around the evening.'}]
 const r=answerFromEventMemory('What is my wedding date?',m)
 assert.match(r.text,/does not state a clear date/)
 assert.equal(r.insufficientEvidence,true)
})
test('a date from another event does not become wedding date',()=>{
 const m=[{id:'1',original_text:'My wedding will be at Divine Mercy Church. I picked up my cake on 20 October 2026.'}]
 assert.equal(answerFromEventMemory('When is my wedding?',m).insufficientEvidence,true)
})
test('unrelated pickup time does not answer wedding date',()=>{
 const m=[{id:'a',original_text:'I need to pick up Ahay at 4:50 pm every weekday.'}]
 assert.equal(answerFromEventMemory('my wedding date',m),null)
})
test('semantic retrieval works for pickup schedule',()=>{
 const m=[{id:'b',original_text:'I collect Ahay at 4:50 pm.'}]
 assert.match(answerFromEventMemory('pick up time',m).text,/4:50 pm/i)
})
