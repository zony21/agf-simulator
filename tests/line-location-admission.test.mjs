import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {buildTransportHistoryRows} from '../src/ui/transport-history.mjs';

function fixture(){
  const s=createDemoScenario('standard');s.durationMin=15;s.mode='source_area_agf_priority';
  s.productStreams.forEach(p=>p.enabled=false);s.lineIntervalsMin.fill(0);
  s.productionModel='legacy_external_pallets';s.magazineUses=[];
  s.productionEvents=[0,1].map((timeMs,i)=>({timeMs,lineId:'L1',palletId:'SYN-LOCATION-'+i,
    sourceLineId:'L1',productType:'normal',loadType:'full'}));
  s.wrapper.permission=false;
  return s;
}

test('a line pickup is reserved from task issuance through wrapper waiting, without issuing a second task',()=>{
  const s=fixture(),r=simulate(s);
  assert.equal(r.events.filter(e=>e.type==='PALLET_EXITED').length,2);
  assert.equal(r.events.filter(e=>e.type==='TASK_REQUESTED'&&e.kind==='01').length,1);
  assert.equal(r.events.filter(e=>e.type==='TASK_ASSIGNED'&&e.kind==='01').length,1);
  assert.ok(r.events.some(e=>e.type==='WRAPPER_INPUT_WAITING'));
  assert.deepEqual(r.final.lines.L1,['SYN-LOCATION-1']);
  assert.ok(r.events.some(e=>e.type==='TASK_01_HELD'&&e.palletId==='SYN-LOCATION-1'));
  assert.ok(buildTransportHistoryRows(r).some(row=>row.content.includes('発行保留')&&row.detail.includes('荷受け')));
  assert.deepEqual(simulate(s).events,r.events);
});

test('source release occurs at physical departure, then issues the retained pallet exactly once',()=>{
  const s=fixture();s.permissionEvents=[{timeMs:5*60000,target:'wrapper',targetId:'WRAP-INPUT',permitted:true}];
  const r=simulate(s),requested=r.events.filter(e=>e.type==='TASK_REQUESTED'&&e.kind==='01');
  assert.equal(requested.length,2);
  const first=r.final.tasks.find(t=>t.id===requested[0].taskId);
  const departure=r.events.find(e=>e.type==='SEGMENT_ENTERED'&&e.taskId===first.id&&
    e.fromNodeId==='PZ-L1-PICKUP'&&e.movement==='loaded');
  assert.ok(departure);assert.ok(requested[1].sequence>departure.sequence);
  assert.equal(requested[1].timeMs,departure.timeMs);
  assert.ok(requested[1].timeMs>=5*60000);
  assert.equal(r.events.filter(e=>e.type==='TASK_PICKED'&&e.kind==='01').length,2);
});

test('an initially occupied line cannot issue while a different free line continues normally',()=>{
  const s=fixture();delete s.initialParking;
  Object.assign(s.agfs[3],{currentNodeId:'PZ-L1-PICKUP',area:'PZ',blocked:true});
  s.productionEvents[1]={...s.productionEvents[1],lineId:'L2',sourceLineId:'L2'};
  const r=simulate(s);
  assert.ok(!r.events.some(e=>e.type==='TASK_REQUESTED'&&e.palletId==='SYN-LOCATION-0'));
  assert.ok(r.events.some(e=>e.type==='TASK_REQUESTED'&&e.palletId==='SYN-LOCATION-1'));
  assert.deepEqual(r.final.lines.L1,['SYN-LOCATION-0']);
});

test('the task issuance snapshot already owns its line pickup reservation and pallet request identity',()=>{
  const r=simulate(fixture()),issued=r.events.find(e=>e.type==='TASK_REQUESTED'&&e.kind==='01');
  const snap=r.snapshots[issued.sequence];
  assert.equal(snap.linePickupReservations['PZ-L1-PICKUP'],issued.taskId);
  assert.equal(snap.pallets.find(p=>p.palletId===issued.palletId).transportTaskId,issued.taskId);
});

test('a zero-distance loaded handoff handles once and releases the source on a subsequent task-free departure',()=>{
  const s=fixture();s.durationMin=30;s.wrapper.permission=true;
  s.agfs.forEach((a,i)=>a.blocked=i!==0);
  // Explicit synthetic shared interface, not a claim about the facility layout.
  s.operationalTopology.interfaceBindings.find(b=>b.pattern==='WRAP-INPUT').nodeId='PZ-L1-PICKUP';
  const r=simulate(s),first=r.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind==='01');
  assert.ok(first);
  const positions=r.events.filter(e=>e.type==='TASK_POSITIONING_STARTED'&&e.operation==='dropoff'&&e.taskId===first.taskId);
  assert.equal(positions.length,1);
  assert.equal(r.snapshots[first.sequence].linePickupReservations['PZ-L1-PICKUP'],first.taskId);
  const departure=r.events.find(e=>e.type==='SEGMENT_ENTERED'&&e.fromNodeId==='PZ-L1-PICKUP'&&e.movement==='wait');
  const released=r.events.find(e=>e.type==='PICKUP_LOCATION_RELEASED'&&e.taskId===first.taskId);
  assert.ok(departure&&released);
  assert.equal(departure.timeMs,released.timeMs);assert.ok(released.sequence>departure.sequence);
  const requests=r.events.filter(e=>e.type==='TASK_REQUESTED'&&e.kind==='01');
  assert.equal(requests.length,2);assert.ok(requests[1].sequence>released.sequence);
  assert.equal(r.events.filter(e=>e.type==='TASK_COMPLETED'&&e.kind==='01').length,2);
});
