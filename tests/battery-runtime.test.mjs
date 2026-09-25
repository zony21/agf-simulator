import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {analyzeRun,snapshotIndexAt} from '../src/ui/replay-model.mjs';
import {projectBatteryPct} from '../src/core/battery-model.mjs';

const scenario=()=>{
  const s=createDemoScenario('manual');
  s.battery={...s.battery,consumptionModel:'active_time',activeReferenceMin:360,activeReferenceConsumptionPct:70,
    chargeStartPct:0,reservePct:0};
  return s;
};
test('360 minutes of driving and handling consumes 70 percentage points, excluding idle time',()=>{
  const s=scenario();s.durationMin=400;
  Object.assign(s.times,{emptyMin:120,pickupMin:30,loadedMin:180,dropoffMin:30});
  s.manualRequests=[{timeMs:0,kind:'05',palletId:'SIM-TEMP-1',locationId:'OT1',destinationLocationId:s.generatedDestinationIds[0],storagePermission:true}];
  const run=simulate(s),task=run.final.tasks.find(t=>t.kind==='05');
  assert.equal(task.completedAt,360*60000);
  assert.equal(run.final.agfs.find(a=>a.id===task.agfId).batteryPct,30);
  assert.ok(run.final.agfs.filter(a=>a.id!==task.agfId).every(a=>a.batteryPct===100));
  const index=snapshotIndexAt(run.events,180*60000),snap=run.snapshots[index],agf=snap.agfs.find(a=>a.id===task.agfId);
  assert.equal(projectBatteryPct(agf,snap.tasks.find(t=>t.id===agf.taskId),s.battery,180*60000-run.events[index].timeMs),65);
  const extra=structuredClone(s);extra.alignerReadyEvents=[{timeMs:73*60000,alignerId:'AL1'},{timeMs:199*60000,alignerId:'AL2'}];
  assert.equal(simulate(extra).final.agfs.find(a=>a.id===task.agfId).batteryPct,30);
  assert.deepEqual(simulate(s),run);
});
test('unfinished movement consumes only elapsed active time to the horizon',()=>{
  const s=scenario();s.durationMin=90;s.times.emptyMin=120;
  s.manualRequests=[{timeMs:0,kind:'05',palletId:'SIM-TEMP-1',locationId:'OT1',destinationLocationId:s.generatedDestinationIds[0],storagePermission:true}];
  const run=simulate(s),agf=run.final.agfs.find(a=>a.taskId);
  assert.equal(agf.batteryPct,82.5);
  assert.equal(run.events.at(-1).timeMs,90*60000);
  assert.equal(run.snapshots.at(-1).agfs.find(a=>a.id===agf.id).batteryPct,82.5);
});
test('blocked unloading is excluded from active-time consumption',()=>{
  const s=scenario();s.durationMin=40;
  Object.assign(s.times,{emptyMin:1,pickupMin:1,loadedMin:1,dropoffMin:1,wrapMin:30});
  s.manualRequests=s.temporaryPallets.map(p=>({timeMs:0,kind:'04',palletId:p.palletId,locationId:p.locationId,reentryPermission:true}));
  const run=simulate(s),analysis=analyzeRun(run);
  assert.ok(analysis.dropWaitMs>0);
  for(const row of analysis.agfs) {
    const expected=100-row.workingMs/60000*70/360;
    const actual=run.final.agfs.find(a=>a.id===row.id).batteryPct;
    assert.ok(Math.abs(actual-expected)<.000002);
  }
});
test('charging travel consumes active energy and a two-port wait does not',()=>{
  const s=createDemoScenario('charge');s.battery.consumptionModel='active_time';
  s.battery.activeReferenceMin=360;s.battery.activeReferenceConsumptionPct=70;
  const run=simulate(s);
  const request=run.events.find(e=>e.type==='CHARGE_REQUESTED'),arrived=run.events.find(e=>e.type==='CHARGE_ARRIVED'&&e.agfId===request.agfId);
  const start=run.snapshots[request.sequence].agfs.find(a=>a.id===request.agfId).batteryPct;
  const end=run.snapshots[arrived.sequence].agfs.find(a=>a.id===request.agfId).batteryPct;
  assert.ok(Math.abs(start-end-s.times.chargeTravelMin*70/360)<.000002);
  const wait=run.events.find(e=>e.type==='CHARGE_WAITING');assert.ok(wait);
  const charge=run.events.find(e=>e.type==='CHARGE_STARTED'&&e.agfId===wait.agfId&&e.timeMs>=wait.timeMs);
  assert.equal(run.snapshots[wait.sequence].agfs.find(a=>a.id===wait.agfId).batteryPct,
    run.snapshots[charge.sequence].agfs.find(a=>a.id===wait.agfId).batteryPct);
  assert.ok(run.snapshots.every(s=>Object.values(s.chargers).filter(Boolean).length<=2));
});
test('invalid time basis and physically impossible energy use fail instead of silently clamping',()=>{
  const s=scenario();s.battery.activeReferenceMin=0;
  assert.throws(()=>simulate(s),/active.*battery|battery.*active/i);
  s.battery.activeReferenceMin=1;s.durationMin=10;
  s.manualRequests=[{timeMs:0,kind:'05',palletId:'SIM-TEMP-1',locationId:'OT1',destinationLocationId:s.generatedDestinationIds[0],storagePermission:true}];
  assert.throws(()=>simulate(s),/battery depleted/i);
});

test('charging gain is recorded up to the horizon without completing the charge early',()=>{
  const s=createDemoScenario('charge');s.durationMin=90;
  const run=simulate(s),start=run.events.find(e=>e.type==='CHARGE_STARTED');
  const agf=run.final.agfs.find(a=>a.id===start.agfId);
  assert.equal(agf.status,'charging');
  assert.ok(Math.abs(agf.batteryPct-(start.batteryPct+(90-start.timeMs/60000)/s.battery.chargeMinPerPct))<.000002);
  const index=snapshotIndexAt(run.events,80*60000),snap=run.snapshots[index],saved=snap.agfs.find(a=>a.id===agf.id);
  assert.ok(Math.abs(projectBatteryPct(saved,null,s.battery,80*60000-run.events[index].timeMs)-
    (start.batteryPct+(80-start.timeMs/60000)/s.battery.chargeMinPerPct))<.000002);
});

test('legacy scenarios retain per-task events and never receive double time consumption',()=>{
  const s=scenario();delete s.battery.consumptionModel;
  s.manualRequests=[{timeMs:0,kind:'05',palletId:'SIM-TEMP-1',locationId:'OT1',destinationLocationId:s.generatedDestinationIds[0],storagePermission:true}];
  const old=simulate(s),task=old.final.tasks[0];
  assert.equal(old.final.agfs.find(a=>a.id===task.agfId).batteryPct,98.5);
  assert.ok(!old.events.some(e=>e.type==='RUN_ENDED'));
  s.battery.consumptionModel='per_task';const explicit=simulate(s);
  assert.deepEqual(explicit.events,old.events);assert.deepEqual(explicit.snapshots,old.snapshots);
  s.battery.consumptionModel='active_time';delete s.battery.consumptionPct;
  const active=simulate(s);
  assert.ok(Math.abs(active.final.agfs.find(a=>a.id===task.agfId).batteryPct-(100-6*70/360))<.000002);
});
