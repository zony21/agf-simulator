import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {syntheticMetricLayout} from '../examples/synthetic-metric-layout.mjs';
import {simulate} from '../src/core/simulate.mjs';
import {buildTransportHistoryRows} from '../src/ui/transport-history.mjs';

test('a front-vehicle constraint before turning retains its actual reason in events and customer history',()=>{
  const s=createDemoScenario('standard',{metricProfile:syntheticMetricLayout});
  s.durationMin=40;s.warehouseRouteMode='detour';s.magazineEmptyRecoveryPolicy='next_takt';
  const r=simulate(s),rows=buildTransportHistoryRows(r);
  const waiting=r.events.filter(e=>e.type==='SEGMENT_WAITING'&&
    r.snapshots[e.sequence].agfs.find(a=>a.id===e.agfId)?.movement?.waitingReason==='TURN_RESOURCE'&&
    r.snapshots[e.sequence].traffic.waiting.find(w=>w.agfId===e.agfId)?.reason==='NO_OVERTAKING');
  assert.ok(waiting.length,'synthetic run must exercise a same-direction turn admission wait');
  for(const e of waiting){
    assert.equal(e.reason,'NO_OVERTAKING');
    const row=rows.find(row=>row.sequence===e.sequence);
    assert.match(row.detail,/前方AGF/);assert.doesNotMatch(row.detail,/旋回位置の占有/);
  }
});
