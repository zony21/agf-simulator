import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {WAREHOUSE_SERVICE,NORMAL_WAITING_PRIORITY} from '../src/map/warehouse-layout.mjs';

const waits=['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2'];
function scenario(){
  const s=createDemoScenario('physical');delete s.initialParking;s.durationMin=180;
  s.lineIntervalsMin=Array(8).fill(0);
  s.postTaskPolicy={evidence:'user-confirmed-shared-priority',waitingPriority:[...waits]};
  s.chargePlaceIds=['CHARGE-PLACE1','CHARGE-PLACE2'];
  s.productStreams?.forEach(p=>p.enabled=false);s.productionEvents=[];s.manualRequests=[];s.magazineUses=[];
  s.agfs.forEach((a,i)=>{a.currentNodeId=['PZ-HOME','WH-HOME','WH-AL2-ACCESS','WH-AL4-ACCESS'][i];
    a.area=s.operationalTopology.nodes.find(n=>n.id===a.currentNodeId).areaId;a.blocked=i!==0;a.batteryPct=90;});
  s.manualRequests=[{timeMs:0,kind:'04',palletId:'SIM-TEMP-1',locationId:'OT1',reentryPermission:true}];
  return s;
}

test('two pillar waits are primary; the two charge-place stops are the shared fallback',()=>{
  assert.deepEqual(WAREHOUSE_SERVICE.waitingPlaces.map(place=>place.id),['PILLAR-WAIT-E','PILLAR-WAIT-W']);
  assert.deepEqual(WAREHOUSE_SERVICE.waitingFallbackPlaces.map(place=>place.id),['CHARGE-PLACE1','CHARGE-PLACE2']);
  assert.deepEqual(NORMAL_WAITING_PRIORITY,waits);
  assert.ok(WAREHOUSE_SERVICE.waitingPlaces.every(place=>place.stopNodeId===null));
});

test('shared waiting priority validation rejects fixed, partial, duplicated, unreachable and internal targets',()=>{
  for(const fault of ['fixed','partial','duplicate','unreachable','internal']){
    const s=scenario();
    if(fault==='fixed')s.postTaskPolicy.waitTargets={AGF1:'PILLAR-WAIT-E'};
    if(fault==='partial')s.postTaskPolicy.waitingPriority.pop();
    if(fault==='duplicate')s.postTaskPolicy.waitingPriority[3]='CHARGE-PLACE1';
    if(fault==='unreachable')s.operationalTopology.edges=s.operationalTopology.edges.filter(e=>
      e.toNodeId!=='PILLAR-WAIT-E'&&e.fromNodeId!=='PILLAR-WAIT-E');
    if(fault==='internal')s.postTaskPolicy.waitingPriority[0]='WH-HOME';
    assert.throws(()=>simulate(s),/waiting|return target/,fault);
  }
});

test('a task finisher returns to the first free pillar stop through the normal PZ exit and warehouse gate',()=>{
  const s=scenario(),r=simulate(s),request=r.events.find(e=>e.type==='WAIT_RETURN_REQUESTED'),arrival=r.events.find(e=>e.type==='WAIT_ARRIVED');
  assert.equal(request.placeId,'PILLAR-WAIT-E');assert.equal(arrival.placeId,'PILLAR-WAIT-E');
  const route=r.events.find(e=>e.type==='ROUTE_PLANNED'&&e.movement==='wait');
  assert.ok(route.edgeIds.includes('E09')&&route.edgeIds.includes('WH-E-INNER-L2-LINK'));
  assert.ok(!route.edgeIds.includes('E20'),'return uses the lane aligned with the southbound aisle');
  assert.equal(r.snapshots[arrival.sequence].waitingPlaces['PILLAR-WAIT-E'],'AGF1');
  assert.ok(!r.events.some(e=>e.type==='WAIT_RETURN_HELD'&&e.reason==='WAITING_SPOTS_FULL'));
});

test('when both pillars are occupied, a task-free AGF waits at a free charge place without claiming a charger',()=>{
  const s=scenario();s.agfs[1].currentNodeId='PILLAR-WAIT-E';s.agfs[2].currentNodeId='PILLAR-WAIT-W';
  s.agfs[3].currentNodeId='WH-AL4-ACCESS';
  for(const a of s.agfs)a.area=s.operationalTopology.nodes.find(node=>node.id===a.currentNodeId).areaId;
  const r=simulate(s),request=r.events.find(e=>e.type==='WAIT_RETURN_REQUESTED'),arrival=r.events.find(e=>e.type==='WAIT_ARRIVED');
  assert.equal(request.placeId,'CHARGE-PLACE1');assert.equal(arrival.placeId,'CHARGE-PLACE1');
  assert.equal(r.final.chargePlaces['CHARGE-PLACE1'],'AGF1');
  assert.equal(r.final.agfs[0].status,'idle');assert.equal(r.final.agfs[0].chargerId,null);
  assert.ok(Object.values(r.final.chargers).every(owner=>owner===null));
  assert.ok(!r.events.some(e=>e.type==='CHARGE_REQUESTED'));
});
