import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotState,createSnapshotSections} from '../src/core/snapshot-state.mjs';

test('nested motion mutations copy only the changed AGF and preserve past replay states',()=>{
  const store=createSnapshotState([{id:'A',movement:{current:{exitAt:5}}},{id:'B',movement:null}]);
  const first=store.snapshot();assert.equal(store.snapshot(),first);
  store.value[0].movement.current.exitAt=8;const second=store.snapshot();
  assert.equal(first[0].movement.current.exitAt,5);assert.equal(second[0].movement.current.exitAt,8);
  assert.equal(first[1],second[1]);assert.notEqual(first[0],second[0]);assert.ok(Object.isFrozen(second[0].movement.current));
});
test('frozen routes remain shared while mutable motion and array changes are versioned',()=>{
  const route=Object.freeze([Object.freeze({edgeId:'E'})]),store=createSnapshotState({movement:{steps:route},queue:[1,2]});
  const first=store.snapshot();assert.equal(first.movement.steps,route);
  store.value.queue.push(3);const second=store.snapshot();assert.deepEqual(first.queue,[1,2]);assert.deepEqual(second.queue,[1,2,3]);
  assert.equal(second.movement,first.movement);store.value.queue.splice(0,1);assert.deepEqual(store.snapshot().queue,[2,3]);
});
test('moving a saved live subobject between fields retains tracking without proxy leakage',()=>{
  const store=createSnapshotState({movement:{step:1},avoidance:null});
  store.snapshot();store.value.avoidance={original:store.value.movement};store.value.movement={step:2};
  const before=store.snapshot();store.value.movement=store.value.avoidance.original;store.value.movement.step=3;
  const after=store.snapshot();assert.equal(before.avoidance.original.step,1);assert.equal(after.avoidance.original.step,3);
  assert.deepEqual(structuredClone(after),{movement:{step:3},avoidance:{original:{step:3}}});
  delete store.value.avoidance;assert.equal(Object.hasOwn(store.snapshot(),'avoidance'),false);
});

test('equal equipment and traffic state reuses immutable branches without retaining new allocations',()=>{
  const save=createSnapshotSections(),first=save({lines:{L1:['P']},magazines:{M1:{quantity:10}},traffic:{owners:{E:'A'}}});
  const same=save(structuredClone(first));assert.equal(same.lines,first.lines);assert.equal(same.traffic,first.traffic);
  const changed=save({lines:{L1:[]},magazines:{M1:{quantity:10}},traffic:{owners:{E:'A'}}});
  assert.equal(changed.magazines,first.magazines);assert.equal(changed.traffic,first.traffic);
  assert.deepEqual(first.lines.L1,['P']);assert.deepEqual(changed.lines.L1,[]);assert.ok(Object.isFrozen(changed.lines.L1));
  assert.deepEqual(structuredClone(changed),{lines:{L1:[]},magazines:{M1:{quantity:10}},traffic:{owners:{E:'A'}}});
});
