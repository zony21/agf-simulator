import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario,createLegacyScenario} from '../src/ui/scenario.mjs';
import {syntheticMetricLayout} from '../examples/synthetic-metric-layout.mjs';
import {convertTopologyToMetric} from '../src/map/metric-layout.mjs';
import {simulate} from '../src/core/simulate.mjs';

test('same-time resource release and waiting-request retries cannot report a transient three-AGF deadlock',()=>{
  const s=createDemoScenario('standard',{metricProfile:syntheticMetricLayout});
  // Reproduce the original exact-time collision with its original synthetic
  // speeds. Changing the ordinary catalogue reference must not erase this case.
  delete s.vehicleTravelProfile;
  s.operationalTopology=convertTopologyToMetric(createLegacyScenario('physical').operationalTopology,syntheticMetricLayout);
  s.warehouseRouteMode='detour';s.durationMin=100;
  s.magazineEmptyRecoveryPolicy='next_takt'; // Explicit synthetic acceptance setting.
  const run=simulate(s);
  assert.ok(run.events.some(e=>e.type==='SEGMENT_WAITING'));
  assert.equal(run.events.filter(e=>e.type==='DEADLOCK_DETECTED').length,0);
  assert.ok(run.events.some(e=>e.type==='TRAFFIC_WAIT_ENDED'&&e.agfId==='AGF3'&&e.timeMs===5884127),
    'the released conflict really becomes traversable at the same simulation time');
});

test('catalogue reference speeds also settle same-time traffic retries without a false deadlock',()=>{
  const s=createDemoScenario('standard',{metricProfile:syntheticMetricLayout});
  s.warehouseRouteMode='detour';s.durationMin=100;s.magazineEmptyRecoveryPolicy='next_takt';
  const run=simulate(s);
  assert.ok(run.events.some(e=>e.type==='SEGMENT_WAITING'));
  assert.equal(run.events.filter(e=>e.type==='DEADLOCK_DETECTED').length,0);
  assert.ok(run.events.some(e=>e.type==='TRAFFIC_WAIT_ENDED'));
});

test('a real reciprocal stopped-node cycle is still reported after same-time retries settle',()=>{
  const s=createDemoScenario('standard');s.durationMin=1;
  s.warehouseRouteMode='detour';
  delete s.initialParking;s.productionModel='legacy_external_pallets';
  s.productStreams.forEach(stream=>{stream.enabled=false;});s.lineIntervalsMin.fill(0);
  // Explicit opposing requests on the same west approach lane. The east
  // normal approaches now continue the declared one-way main aisles straight.
  s.agfs[0].currentNodeId='WH-W-GATE';s.agfs[0].headingDeg=90;
  s.agfs[1].currentNodeId='WH-W-INNER-L1';s.agfs[1].headingDeg=270;
  s.agfs.slice(2).forEach(a=>{a.blocked=true;});
  s.magazines[0].quantity=4;s.magazineUses=[{timeMs:0,magazineId:'M1'}];
  s.productionEvents=[{timeMs:1,lineId:'L1',palletId:'CYCLE-PRODUCT',sourceLineId:'L1',productType:'normal',loadType:'full'}];
  const run=simulate(s),cycles=run.events.filter(e=>e.type==='DEADLOCK_DETECTED');
  assert.ok(cycles.some(e=>e.cycles.some(c=>c.includes('AGF1')&&c.includes('AGF2'))));
  assert.ok(cycles.every(e=>e.recoveryPolicy==='detect-only'));
  assert.equal(run.final.agfs[0].currentNodeId,'WH-W-GATE');assert.equal(run.final.agfs[1].currentNodeId,'WH-W-INNER-L1');
});
