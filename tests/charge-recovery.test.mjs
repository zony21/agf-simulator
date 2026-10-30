import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {buildRunConditions} from '../src/ui/run-conditions.mjs';
import {customerConditionRows} from '../src/ui/customer-conditions.mjs';
import {conditionCsv,eventCsv} from '../src/ui/export.mjs';
import {buildTransportHistoryRows} from '../src/ui/transport-history.mjs';

function quietScenario(preset='standard'){
  const scenario=createDemoScenario(preset);
  scenario.productStreams.forEach(stream=>{stream.enabled=false;});
  scenario.productionEvents=[];
  scenario.agfs.slice(1).forEach(agf=>{agf.blocked=true;});
  return scenario;
}

function request(scenario,count=1){
  scenario.temporaryPallets=Array.from({length:count},(_,i)=>({
    palletId:'SYN-RECOVERY-'+(i+1),locationId:'OT'+(i+1),
    sourceLineId:'L1',productType:'normal',loadType:'full'
  }));
  scenario.manualRequests=scenario.temporaryPallets.map(pallet=>({
    timeMs:0,kind:'04',palletId:pallet.palletId,locationId:pallet.locationId,reentryPermission:true
  }));
}

for(const preset of ['standard','extended'])test(`${preset} resumes dispatch at 60 percent while idle charging targets 100 without a global start threshold`,()=>{
  const scenario=createDemoScenario(preset);
  assert.equal(scenario.battery.chargeTargetPct,100);
  assert.equal(scenario.battery.chargeDispatchPct,60);
  assert.equal(scenario.battery.chargeStartPct,40);
  assert.equal(scenario.battery.reservePct,40);
  assert.equal(Object.hasOwn(scenario.battery,'taskStartPct'),false);
  assert.equal(scenario.evidence.chargeTargetPct,'user-confirmed-charge-to-full-when-idle');
});

test('charging at 59 percent cannot take a task before reaching the 60 percent charge target',()=>{
  const scenario=quietScenario();scenario.durationMin=48;
  scenario.agfs[0].batteryPct=39;request(scenario);
  const run=simulate(scenario);
  assert.equal(run.events.find(event=>event.type==='CHARGE_STARTED')?.timeMs,0);
  assert.equal(run.final.agfs[0].batteryPct,59);
  assert.equal(run.final.agfs[0].status,'charging');
  assert.equal(run.events.some(event=>event.type==='TASK_ASSIGNED'),false);
  assert.equal(run.events.some(event=>event.type==='CHARGE_ENDED'),false);
});

test('reaching 60 percent interrupts charging only for an assigned task and releases the electrical port',()=>{
  const scenario=quietScenario();scenario.durationMin=51;
  scenario.agfs[0].batteryPct=39;request(scenario);
  const run=simulate(scenario);
  const ended=run.events.find(event=>event.type==='CHARGE_INTERRUPTED');
  assert.ok(ended);
  assert.equal(ended.batteryPct,60);
  assert.equal(ended.timeMs,Math.round((60-39)*2.4*60000));
  const released=run.events.find(event=>event.type==='CHARGER_RELEASED');
  assert.equal(released.chargerId,ended.chargerId);
  assert.equal(released.timeMs,ended.timeMs);
  const assigned=run.events.find(event=>event.type==='TASK_ASSIGNED');
  assert.equal(assigned.agfId,'AGF1');
  assert.equal(assigned.timeMs,ended.timeMs);
  assert.ok(assigned.sequence>released.sequence);
  assert.equal(assigned.dispatchSelection.selectedBatteryPct,60);
  assert.ok(Object.values(run.snapshots[assigned.sequence].chargers).every(owner=>owner===null));
  assert.equal(run.events.some(event=>event.type==='CHARGE_ENDED'),false);
  const history=buildTransportHistoryRows(run),ready=history.find(row=>row.type==='CHARGE_DISPATCH_READY');
  assert.equal(ready.content,'充電中・搬送復帰可能');
  assert.match(history.find(row=>row.type==='CHARGE_INTERRUPTED').content,/充電中断/);
  assert.doesNotMatch(history.find(row=>row.type==='CHARGE_INTERRUPTED').detail,/TASK_DISPATCH/);
  const csv=eventCsv(run,'SYN-CHARGE'),headers=csv.slice(1).split('\r\n')[0].split(',');
  assert.equal(new Set(headers).size,headers.length);assert.ok(headers.includes('chargeDispatchPct'));
  assert.match(csv,/CHARGE_INTERRUPTED/);
});

test('without a task charging continues past 60 and releases its port only on reaching 100',()=>{
  const scenario=quietScenario();scenario.durationMin=100;scenario.agfs[0].batteryPct=39;
  const run=simulate(scenario),ready=run.events.find(e=>e.type==='CHARGE_DISPATCH_READY');
  assert.ok(ready);assert.equal(ready.batteryPct,60);assert.equal(run.final.agfs[0].status,'charging');
  assert.ok(run.final.agfs[0].batteryPct>60&&run.final.agfs[0].batteryPct<100);
  assert.equal(run.final.chargers[run.final.agfs[0].chargerId],'AGF1');
  assert.equal(run.events.some(e=>e.type==='CHARGE_INTERRUPTED'||e.type==='CHARGE_ENDED'),false);
  const full=simulate({...scenario,durationMin:160}),ended=full.events.find(e=>e.type==='CHARGE_ENDED');
  assert.equal(ended.batteryPct,100);assert.equal(full.final.agfs[0].batteryPct,100);
  assert.ok(Object.values(full.final.chargers).every(owner=>owner===null));
});

test('a later task interrupts charging at its actual residual above 60, never at the readiness event alone',()=>{
  const scenario=quietScenario();scenario.durationMin=66;scenario.agfs[0].batteryPct=39;request(scenario);
  scenario.manualRequests[0].timeMs=65*60000;
  const run=simulate(scenario),assigned=run.events.find(e=>e.type==='TASK_ASSIGNED'),stop=run.events.find(e=>e.type==='CHARGE_INTERRUPTED');
  assert.equal(assigned.timeMs,65*60000);assert.equal(stop.timeMs,assigned.timeMs);
  assert.ok(stop.batteryPct>60);assert.equal(assigned.dispatchSelection.selectedBatteryPct,stop.batteryPct);
  assert.equal(assigned.dispatchSelection.evaluations.find(e=>e.agfId==='AGF1').status,'charging');
});

test('a blocked priority task does not interrupt charging merely because dispatch readiness was reached',()=>{
  const scenario=quietScenario();scenario.durationMin=100;scenario.agfs[0].batteryPct=39;
  scenario.productionModel='legacy_external_pallets';scenario.magazines[0].quantity=4;
  scenario.magazineUses=[{timeMs:0,magazineId:'M1'}];
  scenario.permissionEvents=[{timeMs:1,target:'aligner',targetId:'AL1',permitted:false}];
  const run=simulate(scenario);assert.equal(run.events.some(e=>e.type==='TASK_ASSIGNED'),false);
  assert.equal(run.events.some(e=>e.type==='CHARGE_INTERRUPTED'),false);assert.equal(run.final.agfs[0].status,'charging');
  assert.ok(run.final.agfs[0].batteryPct>60);
});

test('cancelled full-charge completion cannot end a later charging session on the same port',()=>{
  const scenario=quietScenario();scenario.durationMin=170;scenario.agfs[0].batteryPct=39;request(scenario);
  scenario.times.wrapMin=1000; // Keep the follow-on 02 outside this session-isolation test.
  scenario.battery.consumptionModel='per_task';scenario.battery.consumptionPct=30;
  const run=simulate(scenario);
  assert.equal(run.events.filter(e=>e.type==='CHARGE_STARTED').length,2);
  assert.equal(run.events.filter(e=>e.type==='CHARGE_INTERRUPTED').length,1);
  assert.equal(run.events.filter(e=>e.type==='CHARGE_ENDED').length,0);
  assert.equal(run.final.agfs[0].status,'charging');assert.ok(run.final.agfs[0].batteryPct>60&&run.final.agfs[0].batteryPct<100);
  assert.deepEqual(simulate(scenario).events,run.events);
});

test('crossing 60 percent while working neither interrupts the task nor prevents the next assignment',()=>{
  const scenario=quietScenario();scenario.mode='low_battery_first';
  scenario.agfs[0].batteryPct=60.01;request(scenario,2);
  const run=simulate(scenario);
  const first=run.events.find(event=>event.type==='TASK_COMPLETED'&&event.kind==='04');
  assert.ok(first);
  const agf=run.snapshots[first.sequence].agfs[0];
  assert.ok(agf.batteryPct<60&&agf.batteryPct>40);
  const second=run.events.find(event=>event.type==='TASK_ASSIGNED'&&event.taskId!==first.taskId&&event.kind==='04');
  assert.ok(second);
  assert.equal(second.agfId,'AGF1');
  assert.equal(second.timeMs,first.timeMs);
  assert.equal(run.events.some(event=>event.type==='CHARGE_REQUESTED'),false);
});

test('saved condition summaries and condition CSV report the charge target without inventing a task-start gate',()=>{
  const scenario=quietScenario();scenario.durationMin=1;
  const run=simulate(scenario),rows=buildRunConditions(run);
  const target=rows.find(row=>row.category==='BATTERY'&&row.subkey==='chargeTargetPct');
  assert.equal(target.value,100);
  assert.equal(target.evidence,'user-confirmed-charge-to-full-when-idle');
  assert.equal(rows.find(row=>row.category==='BATTERY'&&row.subkey==='chargeDispatchPct').value,60);
  assert.equal(rows.some(row=>row.subkey==='taskStartPct'),false);
  assert.doesNotMatch(rows.find(row=>row.category==='AGF'&&row.subkey==='eligibility').value,/60|taskStartPct/);
  const customerRows=customerConditionRows(run);
  assert.equal(customerRows.find(row=>row.key==='battery.chargeTargetPct').value,100);
  assert.equal(customerRows.find(row=>row.key==='battery.chargeDispatchPct').value,60);
  assert.equal(customerRows.some(row=>row.key==='battery.taskStartPct'),false);
  assert.match(conditionCsv(run),/BATTERY,settings,chargeTargetPct,100,user-confirmed-charge-to-full-when-idle/);
  scenario.battery.chargeTargetPct=80;
  assert.equal(customerConditionRows(run).find(row=>row.key==='battery.chargeTargetPct').value,100);
});
