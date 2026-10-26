import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';

function futureReservedPickup(){
  const s=createDemoScenario('standard');delete s.initialParking;s.durationMin=.02;
  s.productStreams.forEach(p=>p.enabled=false);s.lineIntervalsMin.fill(0);
  s.productionModel='legacy_external_pallets';
  s.magazineUses=[{timeMs:0,magazineId:'M1'}];s.magazines[0].quantity=4;
  s.aligners.forEach((a,i)=>a.quantity=i===0?10:0);
  s.productionEvents=[{timeMs:1,lineId:'L1',palletId:'SYN-FUTURE-PICKUP',
    sourceLineId:'L1',productType:'normal',loadType:'full'}];
  s.agfs.forEach((a,i)=>Object.assign(a,{currentNodeId:[
    'WH-HOME','CHARGE-PLACE1','PILLAR-WAIT-W','PILLAR-WAIT-E'][i],area:'WH',blocked:i>0,headingDeg:null}));
  const g=s.operationalTopology;
  // Invented shared interface and merge declaration. This is a reservation
  // contract fixture, not a proposal for placing a production line at an aligner.
  g.interfaceBindings.find(b=>b.pattern==='L1').nodeId='WH-AL1-PICKUP';
  const approach=g.edges.find(e=>e.id==='WH-AL1-APPROACH');
  approach.mergeConflictResourceId='SYN-MERGE-AL1';
  approach.occupancyResourceIds.push('SYN-MERGE-AL1');
  return s;
}

test('line issuance respects an arrival reservation beyond the current segment target',()=>{
  const r=simulate(futureReservedPickup());
  const produced=r.events.find(e=>e.type==='PALLET_EXITED');
  const snapshot=r.snapshots[produced.sequence];
  assert.equal(snapshot.traffic.nodeReservations['WH-AL1-PICKUP'],'AGF1');
  const owner=snapshot.agfs.find(a=>a.id==='AGF1');
  assert.notEqual(owner.currentNodeId,'WH-AL1-PICKUP');
  assert.notEqual(owner.movement.current.toNodeId,'WH-AL1-PICKUP');
  assert.ok(!r.events.some(e=>e.type==='TASK_REQUESTED'&&e.kind==='01'));
  assert.deepEqual(r.final.lines.L1,['SYN-FUTURE-PICKUP']);
  const held=r.events.find(e=>e.type==='TASK_01_HELD');
  assert.ok(held);assert.ok(held.blockers.includes('AGF1'));
});
