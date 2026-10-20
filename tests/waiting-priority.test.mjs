import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {integratedAcceptanceScenario} from '../examples/integrated-acceptance.mjs';

const priority=['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2'];
const ordinaryStops=['WH-HOME','WH-AL2-ACCESS','WH-AL4-ACCESS'];
function scenario(){
  const s=integratedAcceptanceScenario();delete s.initialParking;s.durationMin=180;
  s.postTaskPolicy={evidence:'user-confirmed-shared-priority',waitingPriority:[...priority]};
  s.chargePlaceIds=['CHARGE-PLACE1','CHARGE-PLACE2'];
  s.productStreams?.forEach(p=>p.enabled=false);s.productionEvents=[];s.manualRequests=[];s.magazineUses=[];
  s.agfs.forEach((a,i)=>{a.currentNodeId=i===0?'PZ-HOME':ordinaryStops[i-1];
    a.area=s.operationalTopology.nodes.find(n=>n.id===a.currentNodeId).areaId;a.status='idle';a.blocked=i!==0;});
  s.manualRequests=[{timeMs:0,kind:'04',palletId:'SIM-TEMP-1',locationId:'OT1',reentryPermission:true}];
  return s;
}
const owners=(snapshot,id)=>snapshot.waitingPlaces[id]??snapshot.chargePlaces[id]??null;
const reservations=(snapshot,id)=>snapshot.waitingReservations[id]??snapshot.chargePlaceReservations[id]??null;

for(let occupied=0;occupied<4;occupied++)test(`shared return skips ${occupied} occupied stops and reserves ${priority[occupied]}`,()=>{
  const s=scenario();
  for(let i=0;i<3;i++){
    const id=i<occupied?priority[i]:ordinaryStops[i];
    s.agfs[i+1].currentNodeId=id;s.agfs[i+1].area=s.operationalTopology.nodes.find(n=>n.id===id).areaId;
  }
  const r=simulate(s),request=r.events.find(e=>e.type==='WAIT_RETURN_REQUESTED'&&e.agfId==='AGF1');
  assert.equal(request.placeId,priority[occupied]);
  assert.equal(reservations(r.snapshots[request.sequence],request.placeId),'AGF1');
  const arrived=r.events.find(e=>e.type==='WAIT_ARRIVED'&&e.agfId==='AGF1');
  assert.equal(owners(r.snapshots[arrived.sequence],request.placeId),'AGF1');
  assert.equal(reservations(r.snapshots[arrived.sequence],request.placeId),null);
});

test('all AGF IDs use the same shared waiting candidates without fixed return assignments',()=>{
  for(const agfId of ['AGF1','AGF2','AGF3','AGF4']){
    const s=scenario();s.agfs.forEach(a=>{a.blocked=a.id!==agfId;});
    const r=simulate(s),request=r.events.find(e=>e.type==='WAIT_RETURN_REQUESTED');
    assert.equal(request.agfId,agfId);assert.equal(request.placeId,priority[0]);
    assert.deepEqual(request.waitingPriority,priority);
  }
});

test('overlapping return trips reserve separate pillar places before either arrives',()=>{
  const s=scenario();s.durationMin=180;s.manualRequests=[];
  s.agfs[0].status='dispatch_pending';s.agfs[1].status='dispatch_pending';s.agfs[1].blocked=false;
  s.shutterEvents=[{timeMs:0,shutterId:s.operationalTopology.shutters[0].id,
    passable:s.operationalTopology.shutters[0].initiallyPassable}];
  const r=simulate(s),returns=r.events.filter(e=>e.type==='WAIT_RETURN_REQUESTED');
  assert.deepEqual(returns.map(e=>e.placeId),priority.slice(0,2));
  assert.equal(returns[0].timeMs,returns[1].timeMs);
  for(const snapshot of r.snapshots){
    const resources=[...Object.values(snapshot.waitingPlaces),...Object.values(snapshot.waitingReservations),
      ...Object.values(snapshot.chargePlaces),...Object.values(snapshot.chargePlaceReservations)].filter(Boolean);
    assert.equal(resources.length,new Set(resources).size);
    for(const id of priority)assert.ok(!(owners(snapshot,id)&&reservations(snapshot,id)));
  }
});

test('a freed pillar does not reorder an AGF already waiting at the other pillar',()=>{
  const s=scenario();s.agfs[0].currentNodeId='PILLAR-WAIT-E';s.agfs[0].area='WH';
  s.agfs[1].currentNodeId='PILLAR-WAIT-W';s.agfs[1].area='WH';s.agfs[1].blocked=false;
  s.agfs[1].batteryPct=100;s.agfs[0].batteryPct=80;
  const r=simulate(s),departed=r.events.find(e=>e.type==='SEGMENT_ENTERED'&&e.agfId==='AGF1');
  assert.equal(r.snapshots[departed.sequence].waitingPlaces['PILLAR-WAIT-E'],null);
  assert.ok(r.snapshots.every(snapshot=>snapshot.agfs.find(a=>a.id==='AGF2').currentNodeId==='PILLAR-WAIT-W'));
  assert.ok(!r.events.some(e=>e.agfId==='AGF2'&&e.type==='WAIT_RETURN_REQUESTED'));
});

test('returns are deterministic, use a pillar first, and do not park in PZ',()=>{
  const s=scenario(),r=simulate(s);assert.deepEqual(simulate(s).events,r.events);
  const arrived=r.events.find(e=>e.type==='WAIT_ARRIVED'&&e.agfId==='AGF1');assert.ok(arrived);
  assert.equal(r.final.agfs[0].status,'idle');assert.equal(r.final.agfs[0].currentNodeId,'PILLAR-WAIT-E');
  const done=r.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind==='04');assert.ok(done);
  assert.ok(r.snapshots.slice(done.sequence,arrived.sequence).every(snapshot=>snapshot.agfs[0].status!=='idle'));
});
