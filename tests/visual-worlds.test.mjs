import test from 'node:test'
import assert from 'node:assert/strict'
import {visualWorlds,worldRegions,suggestedWorld,getVisualWorld} from '../client/visual-worlds.js'
test('each visual design world is distinct and curated, not a hue-only palette',()=>{
 assert.ok(visualWorlds.length>=30)
 assert.equal(new Set(visualWorlds.map(w=>w.id)).size,visualWorlds.length)
 for(const w of visualWorlds)assert.ok(w.name&&w.style&&w.scene&&w.group)
})
test('optional regions distinguish northern and southern seasons without GPS',()=>{
 assert.equal(suggestedWorld(new Date('2026-07-10T08:00:00Z'),'australia'),'winter')
 assert.equal(suggestedWorld(new Date('2026-07-10T08:00:00Z'),'uk'),'summer')
 assert.equal(suggestedWorld(new Date('2026-07-10T08:00:00Z'),'india'),'monsoon')
 assert.ok(worldRegions.some(x=>x.id==='global'))
})
test('moving holiday dates are not guessed from calendar or region',()=>{
 assert.notEqual(suggestedWorld(new Date('2026-10-20T08:00:00Z'),'india'),'deepavali')
 assert.notEqual(suggestedWorld(new Date('2026-09-20T08:00:00Z'),'india'),'onam')
 assert.notEqual(suggestedWorld(new Date('2026-03-20T08:00:00Z'),'mena'),'eid')
})
test('fixed-date celebration auto themes require explicit opt-in',()=>{
 assert.notEqual(suggestedWorld(new Date('2026-12-25T09:00:00Z'),'global'),'christmas')
 assert.equal(suggestedWorld(new Date('2026-12-25T09:00:00Z'),'global',true),'christmas')
 assert.equal(suggestedWorld(new Date('2026-10-31T09:00:00Z'),'us',true),'halloween')
 assert.notEqual(suggestedWorld(new Date('2026-10-31T09:00:00Z'),'global',true),'halloween')
})
test('unknown region or theme safely falls back to global and curated base',()=>{
 assert.ok(getVisualWorld('not-a-world').id==='gallery')
 assert.doesNotThrow(()=>suggestedWorld(new Date('2026-08-20'),'not-a-region'))
})
