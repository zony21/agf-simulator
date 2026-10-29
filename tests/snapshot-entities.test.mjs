import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotEntities} from '../src/core/snapshot-entities.mjs';

test('unchanged entity collections share the same frozen replay version',()=>{
  const store=createSnapshotEntities([['P1',{id:'P1',stage:'line'}]]),first=store.snapshot();
  assert.equal(store.snapshot(),first);assert.ok(Object.isFrozen(first));assert.ok(Object.isFrozen(first[0]));
  store.entities.get('P1').stage='line';assert.equal(store.snapshot(),first);
});
test('updates, additions and deletes preserve every older saved version and Map order',()=>{
  const store=createSnapshotEntities([['P1',{id:'P1',stage:'line'}],['P2',{id:'P2',stage:'line'}]]),first=store.snapshot();
  store.entities.get('P1').stage='stored';const next=store.snapshot();
  assert.equal(first[0].stage,'line');assert.equal(next[0].stage,'stored');assert.equal(first[1],next[1]);
  store.entities.set('P3',{id:'P3',stage:'temporary'});const third=store.snapshot();assert.equal(third.length,3);assert.equal(next.length,2);
  store.entities.delete('P2');assert.deepEqual(store.snapshot().map(p=>p.id),['P1','P3']);assert.equal(third.length,3);
});
test('property deletion invalidates the version and restored values remain serializable',()=>{
  const store=createSnapshotEntities([['T',{id:'T',waitReason:'busy'}]]),first=store.snapshot();
  delete store.entities.get('T').waitReason;assert.equal(Object.hasOwn(store.snapshot()[0],'waitReason'),false);
  assert.equal(first[0].waitReason,'busy');assert.deepEqual(structuredClone(store.snapshot()),[{id:'T'}]);
});
test('only dirty entities are serialized; unchanged historical records are never rescanned',()=>{
  let saved=0;const store=createSnapshotEntities([],{save:value=>{saved++;return Object.freeze({...value});}});
  for(let i=0;i<1000;i++)store.entities.set(i,{id:i,value:0});const first=store.snapshot();assert.equal(saved,1000);
  for(let i=0;i<100;i++)assert.equal(store.snapshot(),first);assert.equal(saved,1000);
  store.entities.get(500).value=1;store.snapshot();assert.equal(saved,1001);
});
