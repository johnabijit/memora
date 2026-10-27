import test from 'node:test'
import assert from 'node:assert/strict'
import {queryTerms,selectGroundedEvidence,fuseAuthorizedRanks} from '../server/grounding.js'
test('retrieval excludes unrelated recent memories',()=>{
 const result=selectGroundedEvidence('Where is my guitar?',[
  {id:'m1',origin_id:'a',kind:'memory',title:'Cat',content:'My cat is asleep'},
  {id:'m2',origin_id:'b',kind:'memory',title:'Guitar',content:'My guitar is in the music room'}])
 assert.deepEqual(result.items.map(x=>x.id),['m2'])
 assert.equal(result.sources[0].memoryId,'b')
})
test('aliasing supports wedding vs marriage',()=>{
 assert.ok(queryTerms('When is my wedding?').includes('marriage'))
 assert.equal(selectGroundedEvidence('When is my wedding?', [{id:'m1',kind:'memory',title:'Marriage ceremony',content:'December 21 2026'}]).items.length,1)
})
test('no evidence is explicitly reported',()=>{
 const r=selectGroundedEvidence('Where is my passport?', [{id:'m1',kind:'memory',title:'Garden',content:'Flowers bloom'}])
 assert.equal(r.hasEvidence,false)
 assert.equal(r.sources.length,0)
})
test('evidence is bounded and duplicate IDs are removed',()=>{
 const rows=[{id:'m1',kind:'memory',title:'Job',content:'Work is wonderful'},{id:'m1',kind:'memory',title:'Job',content:'Work is wonderful'}]
 assert.equal(selectGroundedEvidence('work',rows).items.length,1)
})
test('hybrid fusion maintains source provenance',()=>{
 const r=fuseAuthorizedRanks([{id:'x'},{id:'y'}],[{id:'y'},{id:'x'}])
 assert.deepEqual(r.map(x=>x.id),['x','y'])
 assert.deepEqual(r[0].matchedBy,['keyword','semantic'])
})
