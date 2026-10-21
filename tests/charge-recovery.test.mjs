import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {buildRunConditions} from '../src/ui/run-conditions.mjs';
import {customerConditionRows} from '../src/ui/customer-conditions.mjs';
import {conditionCsv} from '../src/ui/export.mjs';

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

for(const preset of ['standard','extended'])test(`${preset} defaults to a user-confirmed 60 percent charge target without a global start threshold`,()=>{
  const scenario=createDemoScenario(preset);
  assert.equal(scenario.battery.chargeTargetPct,60);
  assert.equal(scenario.battery.chargeStartPct,40);
  assert.equal(scenario.battery.reservePct,40);
  assert.equal(Object.hasOwn(scenario.battery,'taskStartPct'),false);
  assert.equal(scenario.evidence.chargeTargetPct,'user-confirmed-charge-recovery-target');
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

test('reaching 60 percent ends charging, releases the electrical port and dispatches the pending task',()=>{
  const scenario=quietScenario();scenario.durationMin=51;
  scenario.agfs[0].batteryPct=39;request(scenario);
  const run=simulate(scenario);
  const ended=run.events.find(event=>event.type==='CHARGE_ENDED');
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
  assert.equal(target.value,60);
  assert.equal(target.evidence,'user-confirmed-charge-recovery-target');
  assert.equal(rows.some(row=>row.subkey==='taskStartPct'),false);
  assert.doesNotMatch(rows.find(row=>row.category==='AGF'&&row.subkey==='eligibility').value,/60|taskStartPct/);
  const customerRows=customerConditionRows(run);
  assert.equal(customerRows.find(row=>row.key==='battery.chargeTargetPct').value,60);
  assert.equal(customerRows.some(row=>row.key==='battery.taskStartPct'),false);
  assert.match(conditionCsv(run),/BATTERY,settings,chargeTargetPct,60,user-confirmed-charge-recovery-target/);
  scenario.battery.chargeTargetPct=80;
  assert.equal(customerConditionRows(run).find(row=>row.key==='battery.chargeTargetPct').value,60);
});
