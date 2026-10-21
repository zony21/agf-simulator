import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {selectAgf} from '../src/core/select-agf.mjs';
import {projectAgfPosition} from '../src/core/motion-projection.mjs';
import {analyzeRun} from '../src/ui/replay-model.mjs';

function scenario(){
  const s=createDemoScenario('physical');s.durationMin=180;s.lineIntervalsMin=Array(8).fill(0);
  delete s.initialParking;
  // Synthetic fixture: blocked vehicles stay at distinct non-parking nodes so
  // both charging stops remain available as physical charger locations.
  const starts=['WH-HOME','WH-AL2-ACCESS','WH-AL3-ACCESS','WH-AL4-ACCESS'];
  s.agfs.forEach((a,i)=>{a.blocked=i!==0;a.area='WH';a.currentNodeId=starts[i];a.batteryPct=90;});
  s.chargePlaceIds=['CHARGE-PLACE1','CHARGE-PLACE2'];
  s.postTaskPolicy={waitingPriority:['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2'],evidence:'user-confirmed-shared-priority'};
  s.manualRequests=[{timeMs:0,kind:'05',palletId:'SIM-TEMP-1',locationId:'OT1',storagePermission:true,
    destinationLocationId:s.generatedDestinationIds[0]}];
  return s;
}
const nextRequest=(s,timeMs)=>({timeMs,kind:'05',palletId:'SIM-TEMP-2',locationId:'OT2',storagePermission:true,
  destinationLocationId:s.generatedDestinationIds.find(id=>s.warehouse.find(w=>w.id===id).rowId!==s.warehouse.find(w=>w.id===s.generatedDestinationIds[0]).rowId)});

test('H26 next selected task starts directly at the prior drop without a waiting-place detour',()=>{
  const s=scenario();s.manualRequests.push(nextRequest(s,0));const r=simulate(s);
  const a=r.final.tasks[0],b=r.final.tasks[1];assert.equal(a.agfId,b.agfId);assert.equal(a.completedAt,b.assignedAt);
  const between=r.events.filter(e=>e.timeMs>=a.completedAt&&e.timeMs<=b.assignedAt);
  assert.ok(!between.some(e=>e.type==='WAIT_RETURN_REQUESTED'));
});
test('H28/H32/H33 no next task returns to the first free pillar place, consumes battery and projects position',()=>{
  const r=simulate(scenario()),arrived=r.events.find(e=>e.type==='WAIT_ARRIVED'),request=r.events.find(e=>e.type==='WAIT_RETURN_REQUESTED');
  assert.ok(arrived&&request);assert.ok(arrived.timeMs>request.timeMs);
  const entered=r.events.find(e=>e.type==='SEGMENT_ENTERED'&&e.movement==='wait');assert.ok(entered);
  const a=r.snapshots[entered.sequence].agfs.find(a=>a.id===entered.agfId);
  assert.equal(a.status,'moving_to_wait');assert.ok(Object.values(r.snapshots[entered.sequence].traffic.owners).includes(a.id));
  assert.equal(projectAgfPosition(a,r.scenario.operationalTopology,entered.timeMs+entered.modelDurationMs/2).progress,.5);
  const before=r.snapshots[request.sequence].agfs[0],after=r.snapshots[arrived.sequence].agfs[0];
  assert.ok(after.batteryPct<before.batteryPct);assert.equal(after.currentNodeId,'PILLAR-WAIT-E');assert.equal(after.status,'idle');
  assert.ok(analyzeRun(r).agfs[0].durations.moving_to_wait>0);
});
test('H29/H30/H38 a request during return cannot interrupt it, but can dispatch after pillar arrival',()=>{
  const s=scenario(),first=simulate(s),entered=first.events.find(e=>e.type==='SEGMENT_ENTERED'&&e.movement==='wait');
  assert.ok(entered);s.manualRequests.push(nextRequest(s,entered.timeMs+1));const r=simulate(s);
  const arrival=r.events.find(e=>e.type==='WAIT_ARRIVED');assert.ok(r.final.tasks[1].assignedAt>=arrival.timeMs);
  assert.equal(selectAgf([{id:'A',status:'moving_to_wait',taskId:null,batteryPct:90,area:'WH'}],
    {destinationArea:'WH'},{mode:'area_first',reservePct:40}),null);
});
for(const pending of [false,true])test(`H27/H34-H37 charging wins; after target 100% ${pending?'next task':'shared-place wait'} proceeds and frees charger`,()=>{
  const s=scenario();s.agfs[0].batteryPct=40.01;s.battery.chargeTargetPct=100;s.battery.chargeMinPerPct=.01;
  if(pending)s.manualRequests.push(nextRequest(s,0));const r=simulate(s);
  const charged=r.events.find(e=>e.type==='CHARGE_ENDED');assert.ok(charged);
  if(pending)assert.ok(r.final.tasks[1].assignedAt>=charged.timeMs);
  else assert.ok(r.events.some(e=>e.type==='WAIT_ARRIVED'&&e.placeId==='CHARGE-PLACE1'&&e.timeMs>=charged.timeMs));
  assert.ok(r.events.some(e=>e.type==='CHARGER_RELEASED'&&e.timeMs>=charged.timeMs));
  assert.ok(Object.values(r.final.chargers).every(a=>a===null));
});
test('shared return selection uses the confirmed priority without AGF-specific waitTargets',()=>{
  const s=scenario();s.postTaskPolicy.waitingPriority=['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2'];
  const r=simulate(s);assert.equal(r.events.find(e=>e.type==='WAIT_RETURN_REQUESTED').placeId,'PILLAR-WAIT-E');
  assert.equal(r.final.agfs[0].currentNodeId,'PILLAR-WAIT-E');
});

test('battery crossing the charge threshold on pillar return starts charging after arrival',()=>{
  const s=scenario(),probe=simulate(s);
  const done=probe.events.find(e=>e.type==='TASK_COMPLETED'),arrived=probe.events.find(e=>e.type==='WAIT_ARRIVED');
  const atDone=probe.snapshots[done.sequence].agfs[0].batteryPct;
  const atPillar=probe.snapshots[arrived.sequence].agfs[0].batteryPct;
  s.agfs[0].batteryPct=s.battery.chargeStartPct+(90-atDone)+(atDone-atPillar)/2;
  const r=simulate(s),arrival=r.events.find(e=>e.type==='WAIT_ARRIVED');
  const charge=r.events.find(e=>e.type==='CHARGE_REQUESTED');
  assert.ok(charge);assert.equal(charge.timeMs,arrival.timeMs);
  assert.ok(r.snapshots[arrival.sequence].agfs[0].batteryPct<=s.battery.chargeStartPct);
  assert.ok(r.events.some(e=>e.type==='CHARGE_STARTED'));
});

test('initial idle AGF below the charge threshold charges even with no production events',()=>{
  const s=scenario();s.manualRequests=[];s.agfs[0].batteryPct=s.battery.chargeStartPct-.000001;
  s.agfs[0].currentNodeId='PILLAR-WAIT-E';const r=simulate(s);
  assert.equal(r.events.find(e=>e.type==='CHARGE_REQUESTED')?.timeMs,0);
  assert.ok(r.events.some(e=>e.type==='CHARGE_STARTED'));
});

test('pillar return obeys shutter permission and resumes only after reopening',()=>{
  const s=scenario(),edge=s.operationalTopology.edges.find(e=>e.toNodeId==='PILLAR-WAIT-E');
  edge.shutterId='SH-PILLAR-TEST';
  s.operationalTopology.shutters.push({id:edge.shutterId,initiallyPassable:true,permissionSource:'synthetic-scenario'});
  s.shutterEvents=[{timeMs:0,shutterId:edge.shutterId,passable:false},{timeMs:30*60000,shutterId:edge.shutterId,passable:true}];
  const r=simulate(s),wait=r.events.find(e=>e.type==='SHUTTER_WAITING'&&e.edgeId===edge.id);
  assert.ok(wait);assert.equal(wait.shutterId,edge.shutterId);
  assert.ok(r.events.find(e=>e.type==='WAIT_ARRIVED').timeMs>=30*60000);
});

test('occupied pillar selects the next shared place; unreachable waiting place fails before execution',()=>{
  for(const cause of ['full','unreachable']){
    const s=scenario();
    if(cause==='full'){s.agfs[1].currentNodeId='PILLAR-WAIT-E';s.agfs[3].currentNodeId='WH-E-SOUTH';}
    else s.operationalTopology.edges=s.operationalTopology.edges.filter(e=>e.toNodeId!=='PILLAR-WAIT-E'&&e.fromNodeId!=='PILLAR-WAIT-E');
    if(cause==='unreachable'){assert.throws(()=>simulate(s),/unreachable normal waiting/);continue;}
    const r=simulate(s);assert.equal(r.final.agfs[0].status,'idle');
    assert.equal(r.events.find(e=>e.type==='WAIT_ARRIVED').placeId,'PILLAR-WAIT-W');
    assert.equal(r.final.waitingPlaces['PILLAR-WAIT-E'],'AGF2');assert.equal(r.final.waitingPlaces['PILLAR-WAIT-W'],'AGF1');
  }
});

function pzScenario(kind){
  const s=scenario();s.durationMin=180;s.manualRequests=[];s.productionEvents=[];
  s.agfs[0].area='PZ';s.agfs[0].currentNodeId='PZ-HOME';
  if(kind==='01')s.productionEvents=[{timeMs:0,lineId:'L1',palletId:'PZ-TEST-1',destinationLocationId:s.generatedDestinationIds[0]}];
  if(kind==='03'){s.aligners[0].quantity=10;s.aligners[0].ready=true;s.magazineUses=[{timeMs:0,magazineId:'M1'}];}
  if(kind==='04')s.manualRequests=[{timeMs:0,kind:'04',palletId:'SIM-TEMP-1',locationId:'OT1',reentryPermission:true}];
  return s;
}
for(const kind of ['01','03','04']){
  test(`PZ ${kind} common completion clears task/load, then returns via EXIT and east gate to a pillar place`,()=>{
    const s=pzScenario(kind),r=simulate(s),done=r.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind===kind);
    assert.ok(done);const a=r.snapshots[done.sequence].agfs[0];
    assert.equal(a.status,'dispatch_pending');assert.equal(a.taskId,null);assert.equal(a.carriedPalletId,null);
    const events=r.events.slice(done.sequence+1),route=events.find(e=>e.type==='ROUTE_PLANNED'&&e.agfId==='AGF1');
    assert.equal(route.movement,'wait');
    assert.ok(route.edgeIds.includes('E09')&&route.edgeIds.includes('WH-E-INNER-L2-LINK'));
    assert.ok(!route.edgeIds.includes('E20'),'return uses the lane aligned with the southbound aisle');
    const arrived=events.find(e=>e.type==='WAIT_ARRIVED'&&e.agfId==='AGF1');assert.ok(arrived);
    for(const snapshot of r.snapshots.slice(done.sequence,arrived.sequence)){
      assert.notEqual(snapshot.agfs[0].status,'idle');
    }
    assert.equal(r.snapshots[arrived.sequence].agfs[0].currentNodeId,'PILLAR-WAIT-E');
    assert.ok(events.filter(e=>e.type==='WAIT_RETURN_REQUESTED').every(e=>['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2'].includes(e.placeId)));
  });
  test(`PZ ${kind} completion prioritizes the configured charging threshold over a pending task`,()=>{
    const s=pzScenario(kind);s.agfs[0].batteryPct=40.01;s.manualRequests.push(nextRequest(s,1));
    const r=simulate(s),done=r.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind===kind);
    const after=r.events.slice(done.sequence+1),charge=after.find(e=>e.type==='CHARGE_REQUESTED');
    assert.ok(charge);assert.equal(charge.timeMs,done.timeMs);
    const chargeStarted=after.find(e=>e.type==='CHARGE_STARTED');assert.ok(chargeStarted);
    const chargeEnded=after.find(e=>e.type==='CHARGE_ENDED');assert.ok(chargeEnded);
    const resumed=after.find(e=>e.type==='TASK_ASSIGNED'&&e.agfId==='AGF1');
    assert.ok(!resumed||resumed.timeMs>=chargeEnded.timeMs);
  });
  test(`PZ ${kind} completion uses existing selection and starts a chosen next task without visiting a wait`,()=>{
    const s=pzScenario(kind);s.manualRequests.push(nextRequest(s,1));const r=simulate(s);
    const done=r.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind===kind);
    const after=r.events.slice(done.sequence+1),assigned=after.find(e=>e.type==='TASK_ASSIGNED');
    assert.equal(assigned.agfId,'AGF1');assert.equal(assigned.timeMs,done.timeMs);
    assert.ok(!after.slice(0,after.indexOf(assigned)).some(e=>e.type==='WAIT_RETURN_REQUESTED'));
    const planned=after.find(e=>e.type==='ROUTE_PLANNED');assert.equal(planned.movement,'empty');
    assert.ok(planned.edgeIds.every(id=>!['E14','E15'].includes(id)));
  });
  test(`PZ ${kind} finisher returns to a shared place when another eligible AGF receives the concurrent task`,()=>{
    const s=pzScenario(kind),probe=simulate(s),doneAt=probe.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind===kind).timeMs;
    s.agfs[1].blocked=false;s.agfs[1].batteryPct=95;
    s.manualRequests.push(nextRequest(s,doneAt));const r=simulate(s);
    const done=r.events.find(e=>e.type==='TASK_COMPLETED'&&e.kind===kind);
    assert.equal(done.agfId,'AGF1');
    assert.equal(r.final.tasks.find(t=>t.palletId==='SIM-TEMP-2').agfId,'AGF2');
    assert.ok(r.events.some(e=>e.type==='WAIT_RETURN_REQUESTED'&&e.agfId==='AGF1'&&e.timeMs===done.timeMs));
  });
}

test('charge places are valid last-priority waits while internal junctions remain invalid targets',()=>{
  const valid=scenario();assert.deepEqual(valid.postTaskPolicy.waitingPriority,
    ['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2']);
  for(const id of ['WH-HOME','PZ-HOME']){
    const s=scenario();s.postTaskPolicy.waitingPriority[0]=id;
    assert.throws(()=>simulate(s),/invalid shared normal waiting priority/);
  }
});
