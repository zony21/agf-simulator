import test from 'node:test';
import assert from 'node:assert/strict';
import {warehouseLocations,flexibleWarehouseLocations} from '../src/map/warehouse-layout.mjs';
import {validateWarehousePolicy,chooseWarehouseLocation,warehouseAvailability} from '../src/core/warehouse-policy.mjs';
import {syntheticWarehousePolicy} from '../examples/synthetic-warehouse-policy.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {prepareWarehouseRouting} from '../src/map/warehouse-routing.mjs';
import {warehouseSettingsRowIds} from '../src/ui/extended-settings.mjs';
import {customerConditionRows} from '../src/ui/customer-conditions.mjs';
import {customerConditionsCsv} from '../src/ui/customer-export.mjs';
import {simulate} from '../src/core/simulate.mjs';

const lineIds=Array.from({length:8},(_,i)=>'L'+(i+1));
const locations=()=>[...warehouseLocations(),...flexibleWarehouseLocations()];
const validate=(policy,slots=locations())=>validateWarehousePolicy(policy,slots,{lineIds,specialEnabled:true});
function joinedPolicy(){
  const p=syntheticWarehousePolicy();
  for(const rowId of ['WB1-WB2-FLEX-R01','WB1-WB2-FLEX-R02'])p.rowAssignments.push({rowId,usage:'normal',sourceLineId:'L2'});
  p.rowAssignments.find(a=>a.rowId==='WB2-R01').sourceLineId='L2';
  p.rowPriority.L2.push('WB1-WB2-FLEX-R01','WB1-WB2-FLEX-R02','WB2-R01');
  p.rowPriority.L3=p.rowPriority.L3.filter(id=>id!=='WB2-R01');return p;
}

test('WB1 tail, two flexible rows and WB2 head are one contiguous allocation region',()=>{
  const policy=joinedPolicy();assert.doesNotThrow(()=>validate(policy));
  assert.doesNotThrow(()=>validate({...policy,rowAssignments:policy.rowAssignments.toReversed()},locations().toReversed()));
});

test('a series may end at the first flexible row without taking the next row',()=>{
  const policy=joinedPolicy();
  policy.rowAssignments=policy.rowAssignments.filter(a=>a.rowId!=='WB1-WB2-FLEX-R02');
  policy.rowAssignments.find(a=>a.rowId==='WB2-R01').sourceLineId='L3';
  policy.rowPriority.L2=policy.rowPriority.L2.filter(id=>!['WB1-WB2-FLEX-R02','WB2-R01'].includes(id));
  policy.rowPriority.L3.unshift('WB2-R01');assert.doesNotThrow(()=>validate(policy));
});

test('missing or differently assigned bridge rows still split the same series',()=>{
  for(const gap of ['WB1-WB2-FLEX-R01','WB1-WB2-FLEX-R02','WB1-R07']){
    const p=joinedPolicy();p.rowAssignments=p.rowAssignments.filter(a=>a.rowId!==gap);
    p.rowPriority.L2=p.rowPriority.L2.filter(id=>id!==gap);
    assert.throws(()=>validate(p),/L2の領域が分断/);
  }
});

test('WB1 cannot jump across unassigned flexible storage directly into WB2',()=>{
  const p=joinedPolicy();p.rowAssignments=p.rowAssignments.filter(a=>!a.rowId.startsWith('WB1-WB2-FLEX'));
  p.rowPriority.L2=p.rowPriority.L2.filter(id=>!id.startsWith('WB1-WB2-FLEX'));
  assert.throws(()=>validate(p),/分断/);
});

test('the confirmed WB1/flexible/WB2 connection does not authorize other block crossings',()=>{
  const p=joinedPolicy();p.rowAssignments.find(a=>a.rowId==='WB3-R01').sourceLineId='L2';
  p.rowPriority.L2.push('WB3-R01');p.rowPriority.L4.shift();
  assert.throws(()=>validate(p),/ブロック跨ぎ/);
});

test('ordinary defaults give every source line at least two rows and keep a SPECIAL row',()=>{
  for(const preset of ['standard','extended']){
    const s=createDemoScenario(preset),p=s.warehousePolicy;
    for(const id of lineIds)assert.ok(p.rowAssignments.filter(a=>a.usage==='normal'&&a.sourceLineId===id).length>=2,id);
    assert.ok(p.rowAssignments.some(a=>a.usage==='special'));
    assert.equal(s.warehouse.filter(slot=>!slot.flexibleAreaId).length,802);
    assert.equal(s.warehouse.filter(slot=>slot.flexibleAreaId).length,26);
    assert.doesNotThrow(()=>validate(p,s.warehouse));
  }
});

test('settings and saved conditions place the two flexible rows immediately between WB1 and WB2',()=>{
  const scenario=createDemoScenario(),order=warehouseSettingsRowIds(scenario);
  const next=order.indexOf('WB1-R07');
  assert.deepEqual(order.slice(next,next+4),['WB1-R07','WB1-WB2-FLEX-R01','WB1-WB2-FLEX-R02','WB2-R01']);
  assert.deepEqual(warehouseSettingsRowIds({...scenario,warehouse:scenario.warehouse.toReversed()}),order);
  const rows=customerConditionRows({scenario}).filter(row=>row.key.startsWith('warehouse.row.')&&row.key.endsWith('.owner'));
  assert.deepEqual(rows.map(row=>row.target),order);
  assert.equal(rows.find(row=>row.target==='EB2-R02').value,'GWVIII (L8)');
  assert.equal(rows.find(row=>row.target==='EB2-R03').value,'特注');
  const csv=customerConditionsCsv({scenario});assert.match(csv,/EB2-R02,GWVIII \(L8\)/);
});

test('saved one-row configurations stay valid; the two-row minimum applies to defaults only',()=>{
  assert.doesNotThrow(()=>validate(syntheticWarehousePolicy()));
});

test('normal storage can continue into the bridge; detour keeps it unavailable and selects WB2',()=>{
  for(const mode of ['normal','detour']){
    const s=createDemoScenario();s.warehousePolicy=joinedPolicy();s.warehouseRouteMode=mode;
    const configured=prepareWarehouseRouting(s);validate(configured.warehousePolicy,configured.warehouse);
    const slots=new Map(configured.warehouse.map(slot=>[slot.id,{...slot,palletIds:[],reserved:[]}])) ,pallets=new Map();
    for(const slot of slots.values())if(slot.blockId==='WB1'&&slot.row>=4){
      const id='SYN-ROW-FULL-'+slot.id;slot.palletIds=[id];pallets.set(id,{sourceLineId:'L2',loadType:'full',productType:'normal'});
    }
    const choice=chooseWarehouseLocation({policy:configured.warehousePolicy,slots,pallets,rowBusy:new Set(),
      pallet:{sourceLineId:'L2',productType:'normal',loadType:'full'}});
    assert.equal(choice.location.id,mode==='normal'?'WB1-WB2-FLEX-R01-C01-T1':'WB2-R01-C01-T1');
    const capacity=warehouseAvailability(slots,pallets,configured.warehousePolicy);
    assert.equal(capacity.theoretical,802);assert.equal(capacity.flexibleFloorLocations,26);
    assert.equal(capacity.flexibleUsableLocations,mode==='normal'?26:0);
  }
});

test('actual 02 follows an explicitly ranked cross-block allocation in both route modes',()=>{
  for(const mode of ['normal','detour']){
    const s=createDemoScenario();s.durationMin=25;s.warehouseRouteMode=mode;s.warehousePolicy=joinedPolicy();
    s.lineIntervalsMin.fill(0);s.productStreams.forEach(stream=>{stream.enabled=false;});
    s.warehousePolicy.rowPriority.L2=['WB1-WB2-FLEX-R01','WB1-WB2-FLEX-R02','WB2-R01','WB1-R04','WB1-R05','WB1-R06','WB1-R07'];
    s.productionEvents=[{timeMs:1000,lineId:'L2',palletId:'SYN-CROSS-BLOCK',sourceLineId:'L2',productType:'normal',loadType:'full'}];
    const r=simulate(s),stored=r.events.find(e=>e.type==='STORE_COMPLETED');
    assert.ok(stored);assert.equal(stored.locationId,mode==='normal'?'WB1-WB2-FLEX-R01-C01-T1':'WB2-R01-C01-T1');
    assert.deepEqual(simulate(s).events,r.events);
  }
});
