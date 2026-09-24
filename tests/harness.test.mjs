import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectAgf } from '../src/core/select-agf.mjs';
import { validateTrace } from '../src/core/validate-trace.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/synthetic-trace.json',import.meta.url),'utf8'));
const {scenario,events}=fixture;
const ev=(type,extra={},timeMs=0,sequence=0)=>({type,timeMs,sequence,...extra});
test('a valid synthetic trace is deterministic',()=>{
  const first=validateTrace(scenario,events), second=validateTrace(scenario,events);
  assert.deepEqual(first,second); assert.equal(first.stored,1);
  assert.equal(first.magazines.M.qty,7); assert.equal(first.wrapper.output,0);
});
test('a downstream task cannot appear before exit readiness',()=>{
  assert.throws(()=>validateTrace(scenario,[ev('PALLET_EXITED',{palletId:'P',lineId:'L'}),ev('TASK_02_ASSIGNED',{palletId:'P',agfId:'A'},1)]),/02 requires exit-ready/);
});
test('line buffer capacity is enforced',()=>{
  const e=[0,1,2].map((i)=>ev('PALLET_EXITED',{palletId:'P'+i,lineId:'L'},i));
  assert.throws(()=>validateTrace(scenario,e),/line buffer overflow/);
});
test('one charger cannot charge two vehicles',()=>{
  const e=[ev('CHARGE_STARTED',{agfId:'A',chargerId:'C'}),ev('CHARGE_STARTED',{agfId:'B',chargerId:'C'},1)];
  assert.throws(()=>validateTrace(scenario,e),/charging slot unavailable/);
});
test('refill request requires exact trigger and no duplicate',()=>{
  assert.throws(()=>validateTrace(scenario,[ev('MAGAZINE_REFILL_REQUESTED',{magazineId:'M'})]),/exact trigger/);
  const e=[ev('MAGAZINE_USED',{magazineId:'M'}),ev('MAGAZINE_USED',{magazineId:'M'},1),ev('MAGAZINE_REFILL_REQUESTED',{magazineId:'M'},2),ev('MAGAZINE_REFILL_REQUESTED',{magazineId:'M'},3)];
  assert.throws(()=>validateTrace(scenario,e),/exact trigger/);
});
test('replenishment requires source-ready confirmation',()=>{
  const e=[ev('MAGAZINE_USED',{magazineId:'M'}),ev('MAGAZINE_USED',{magazineId:'M'},1),ev('MAGAZINE_REFILL_REQUESTED',{magazineId:'M'},2),ev('MAGAZINE_REFILLED',{magazineId:'M',sourceReady:false},3)];
  assert.throws(()=>validateTrace(scenario,e),/ready source/);
});
test('area-first and low-battery-first produce distinct, stable selections',()=>{
  const agfs=[{id:'A',status:'idle',area:'west',batteryPct:55},{id:'B',status:'idle',area:'east',batteryPct:75},{id:'C',status:'charging',area:'east',batteryPct:41}];
  assert.equal(selectAgf(agfs,{destinationArea:'east'},{mode:'area_first',reservePct:40})?.id,'B');
  assert.equal(selectAgf(agfs,{originArea:'east'},{mode:'low_battery_first',reservePct:40})?.id,'A');
  assert.equal(selectAgf(agfs,{originArea:'east'},{mode:'low_battery_first',reservePct:60})?.id,'B');
});
test('equal battery breaks ties by ID',()=>{
  const agfs=[{id:'B',status:'idle',area:'x',batteryPct:70},{id:'A',status:'idle',area:'x',batteryPct:70}];
  assert.equal(selectAgf(agfs,{destinationArea:'x'},{mode:'low_battery_first',reservePct:40})?.id,'A');
});
test('destination differs from origin; origin-area AGF cannot take precedence',()=>{
  const agfs=[
    {id:'A',status:'idle',area:'pickup',batteryPct:41},
    {id:'B',status:'idle',area:'drop',batteryPct:75},
    {id:'C',status:'idle',area:'drop',batteryPct:60}
  ];
  assert.equal(selectAgf(agfs,{originArea:'pickup',destinationArea:'drop'},{mode:'area_first',reservePct:40})?.id,'C');
});
test('area-first missing destination is rejected and fallback is explicit',()=>{
  const agfs=[{id:'A',status:'idle',area:'pickup',batteryPct:60}];
  assert.throws(()=>selectAgf(agfs,{originArea:'pickup'},{mode:'area_first',reservePct:40}),/destinationArea/);
  assert.equal(selectAgf(agfs,{destinationArea:'drop'},{mode:'area_first',reservePct:40}),null);
  assert.equal(selectAgf(agfs,{destinationArea:'drop'},{mode:'area_first',reservePct:40,fallback:'any'})?.id,'A');
});
test('out-of-order timestamps fail',()=>{
  assert.throws(()=>validateTrace(scenario,[ev('PALLET_EXITED',{palletId:'P',lineId:'L'},2),ev('PALLET_EXITED',{palletId:'Q',lineId:'L'},1)]),/out of order/);
});
