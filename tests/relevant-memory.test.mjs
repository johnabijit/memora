import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryRelevance,rankMemoryResults,questionNeedsMemoryTopic} from '../client/relevant-memory.js'
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
