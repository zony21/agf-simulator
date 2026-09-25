import test from 'node:test';
import assert from 'node:assert/strict';
import {WAREHOUSE_BLOCKS,warehouseLocations,WAREHOUSE_RULES,WAREHOUSE_SERVICE,WAREHOUSE_MAIN_AISLES} from '../src/map/warehouse-layout.mjs';
import {snapshotIndexAt,replayTime,analyzeRun,compareRuns} from '../src/ui/replay-model.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {simulate} from '../src/core/simulate.mjs';

test('warehouse contains 802 logical tier locations without inventing an east gap road',()=>{
  const locations=warehouseLocations();
  assert.equal(locations.length,802);
  assert.equal(new Set(locations.map(slot=>slot.id)).size,802);
  assert.deepEqual(WAREHOUSE_BLOCKS.map(block=>locations.filter(slot=>slot.blockId===block.id).length),[182,78,338,102,102]);
  assert.ok(!locations.some(slot=>slot.blockId.startsWith('EB')&&slot.column===10));
  assert.equal(new Set(locations.map(slot=>slot.rowId)).size,29);
  assert.equal(WAREHOUSE_RULES.mainAisles.west,2);
  assert.equal(WAREHOUSE_RULES.mainAisles.east,2);
  assert.equal(WAREHOUSE_RULES.rowLaneCount,1);
  assert.equal(WAREHOUSE_RULES.sideBySidePassing,false);
  assert.equal(WAREHOUSE_RULES.emptyColumnAccess,'unresolved');
  assert.equal(WAREHOUSE_RULES.physicalEtaAllowed,false);
});

test('south service has separate waiting, parking and chargers without a forbidden storage route',()=>{
  assert.equal(WAREHOUSE_MAIN_AISLES.length,4);
  assert.ok(WAREHOUSE_MAIN_AISLES.every(a=>a.direction==='unresolved'&&a.laneCount===null));
  assert.equal(WAREHOUSE_SERVICE.waitingPlaces.length,2);
  assert.equal(WAREHOUSE_SERVICE.chargePlaces.length,2);
  assert.equal(new Set([...WAREHOUSE_SERVICE.waitingPlaces,...WAREHOUSE_SERVICE.chargePlaces].map(p=>p.id)).size,4);
  assert.equal(WAREHOUSE_SERVICE.chargers.length,2);
  assert.ok(WAREHOUSE_SERVICE.chargePlaces.every(p=>p.chargerId===null));
  assert.equal(WAREHOUSE_SERVICE.aligners.length,5);
  assert.equal(WAREHOUSE_SERVICE.accessFrom,'east-main-aisles');
  assert.equal(WAREHOUSE_SERVICE.accessEvidence,'user-confirmed');
  assert.equal(WAREHOUSE_SERVICE.branchAssignment,'unresolved');
  assert.equal(WAREHOUSE_SERVICE.emptyPalletStorage.agfAccess,'forbidden');
  assert.deepEqual(WAREHOUSE_SERVICE.emptyPalletStorage.routeNodes,[]);
});

test('time seeking uses the final same-time event and never a future snapshot',()=>{
  const events=[0,100,100,1000].map(timeMs=>({timeMs}));
  assert.equal(snapshotIndexAt(events,99),0);
  assert.equal(snapshotIndexAt(events,100),2);
  assert.equal(snapshotIndexAt(events,999),2);
  assert.equal(snapshotIndexAt(events,5000),3);
  assert.equal(snapshotIndexAt([],0),-1);
  assert.equal(replayTime(100,250,2,1000),600);
  assert.equal(replayTime(100,250,4,1000),1000);
  assert.throws(()=>replayTime(0,100,-1,1000));
});

test('analysis integrates snapshot durations including the horizon tail and zero-time events',()=>{
  const events=[0,100,100,300,500,700].map(timeMs=>({timeMs}));
  const snapshots=['idle','moving_empty','moving_loaded','waiting_charge','charging','idle']
    .map(status=>({agfs:[{id:'A1',status,taskId:null}],tasks:[]}));
  const result={scenario:{durationMin:1000/60000},events,snapshots,final:snapshots.at(-1)};
  const data=analyzeRun(result),agf=data.agfs[0];
  assert.equal(agf.durations.idle,400);
  assert.equal(agf.durations.moving_empty??0,0);
  assert.equal(agf.durations.moving_loaded,200);
  assert.equal(agf.durations.waiting_charge,200);
  assert.equal(agf.durations.charging,200);
  assert.equal(agf.utilizationPct,20);
  assert.equal(agf.timeline.reduce((total,segment)=>total+segment.endMs-segment.startMs,0),1000);
});

test('dashboard scenario uses explicit sample inventory and compares the same production input',()=>{
  const scenario=createDemoScenario('standard');
  const original=structuredClone(scenario);
  const [left,right]=compareRuns(scenario);
  const production=run=>run.events.filter(event=>event.type==='PALLET_EXITED')
    .map(({timeMs,lineId,palletId,inputKind})=>({timeMs,lineId,palletId,inputKind}));
  assert.deepEqual(production(left),production(right));
  assert.deepEqual(scenario,original);
  assert.equal(left.scenario.warehouse.length,802);
  assert.equal(left.scenario.evidence.inventory,'synthetic');
  for(const run of [left,right]) {
    const analysis=analyzeRun(run);
    assert.equal(analysis.completed,run.metrics.completed);
    assert.equal(analysis.requested,run.final.tasks.length);
    for(const agf of analysis.agfs)
      assert.equal(agf.timeline.reduce((n,s)=>n+s.endMs-s.startMs,0),10800000);
    assert.ok(run.snapshots.every(snap=>Object.values(snap.chargers).filter(Boolean).length<=2));
    assert.ok(Object.values(run.final.warehouse).every(slot=>slot.palletIds.length+slot.reserved.length<=1));
  }
});

test('invalid manual reservation cannot mutate the saved result or its scenario',()=>{
  const result=simulate(createDemoScenario('manual'));
  const before=structuredClone(result.scenario);
  const bad={...result.scenario,manualRequests:[{timeMs:0,kind:'05',palletId:'SIM-TEMP-1',
    locationId:'OT1',destinationLocationId:result.scenario.generatedDestinationIds[0]}]};
  assert.throws(()=>simulate(bad),/explicit permission/);
  assert.deepEqual(result.scenario,before);
  assert.equal(result.final.temporaryPallets.length,3);
});
