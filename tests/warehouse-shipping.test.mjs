import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {warehouseShippingSummary,renderWarehouseShippingResults} from '../src/ui/warehouse-shipping-view.mjs';
import {shippingResultsCsv,customerConditionsCsv,transportHistoryCsv,customerCsvFilename} from '../src/ui/customer-export.mjs';
import {eventCsv,conditionCsv} from '../src/ui/export.mjs';
import {warehouseShippingFromSettings,renderWarehouseShippingSettings} from '../src/ui/extended-settings.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {analyzeRun} from '../src/ui/replay-model.mjs';
import {renderWarehouseBlock} from '../src/ui/map-view.mjs';
import {warehouseAvailability} from '../src/core/warehouse-policy.mjs';
import {customerPendingReason} from '../src/ui/customer-results.mjs';
import {createInitialPreview} from '../src/ui/run-input.mjs';

// Tiny synthetic storage rows and times: no site coordinates or forklift measurements.
function fixture({durationMin=5,columns=2,fullRows=[1],cycleMin=2}={}){
  const warehouse=[],initialPallets=[];
  for(let row=1;row<=8;row++)for(let column=1;column<=(row===1?columns:1);column++)for(let tier=1;tier<=2;tier++){
    const rowId=`WB3-R${String(row).padStart(2,'0')}`,id=`${rowId}-C${String(column).padStart(2,'0')}-T${tier}`;
    const palletId=`SYN-INITIAL-${row}-${column}-${tier}`,occupied=fullRows.includes(row);
    warehouse.push({id,rowId,blockId:'WB3',row,column,tier,capacity:1,permission:true,palletIds:occupied?[palletId]:[]});
    if(occupied)initialPallets.push({palletId,sourceLineId:'L'+row,productType:'normal',loadType:'full'});
  }
  return {durationMin,mode:'area_first',fallback:'any',lineCapacity:2,lineIntervalsMin:Array(8).fill(0),
    generatedDestinationIds:[warehouse[0].id],wrapper:{inputCapacity:1,outputCapacity:1,conveyorCapacity:5},
    agfs:[1,2,3,4].map(i=>({id:'AGF'+i,area:i<3?'PZ':'WH',batteryPct:100})),chargerIds:['C1','C2'],
    battery:{reservePct:40,chargeStartPct:40,chargeTargetPct:60,consumptionPct:0,chargeMinPerPct:2.4},
    times:{emptyMin:.01,loadedMin:.01,pickupMin:0,dropoffMin:0,wrapMin:.01,labelMin:0,exitMin:0,chargeTravelMin:.01},
    magazines:[{id:'M1',quantity:10,capacity:20,trigger:3,refillBatch:10}],aligners:[],
    warehouse,initialPallets,warehousePolicy:{rowAssignments:Array.from({length:8},(_,i)=>({
      rowId:`WB3-R${String(i+1).padStart(2,'0')}`,usage:'normal',sourceLineId:'L'+(i+1)}))},
    warehouseShipping:{enabled:true,cycleMin,forkliftCount:1,loadCapacityPL:2,timeEvidence:'synthetic-test-assumption'},
    productionEvents:[],manualRequests:[]};
}
const events=(r,type)=>r.events.filter(e=>e.type===type);

test('a full row ships two-tier stacks over timed trips, keeps its row locked, and retains pallet identity',()=>{
  const s=fixture(),r=simulate(s),picked=events(r,'WAREHOUSE_SHIPMENT_PICKED');
  assert.equal(events(r,'WAREHOUSE_SHIPMENT_STARTED').length,1);
  assert.deepEqual(picked.map(e=>[e.timeMs,e.palletIds.length]),[[120000,2],[240000,2]]);
  assert.equal(events(r,'WAREHOUSE_SHIPMENT_COMPLETED')[0].timeMs,240000);
  assert.equal(r.final.warehouseShipping.shippedPL,4);
  assert.equal(r.final.warehouseShipping.byLine.L1,4);
  assert.ok(r.final.pallets.every(p=>p.stage==='shipped'&&p.shipmentId));
  const mid=r.snapshots[picked[0].sequence];
  assert.equal(mid.warehouse['WB3-R01-C01-T1'].palletIds.length,0);
  assert.ok(mid.warehouse['WB3-R01-C01-T1'].shippingJobId);
  assert.equal(warehouseAvailability(new Map(Object.entries(mid.warehouse)),new Map(mid.pallets.map(p=>[p.palletId,p])),s.warehousePolicy).immediatelyPlaceable,7);
  assert.equal(r.snapshots[0].warehouse['WB3-R01-C01-T1'].palletIds.length,1);
  assert.deepEqual(simulate(s).events,r.events);
});

test('02 cannot reserve a partly cleared shipping row until all trips complete, then resumes',()=>{
  const s=fixture();s.productionEvents=[{timeMs:0,lineId:'L1',palletId:'SYN-AFTER-SHIP',productType:'normal',loadType:'full'}];
  const r=simulate(s),request=events(r,'TASK_REQUESTED').find(e=>e.kind==='02');
  assert.ok(request);assert.ok(request.timeMs>=240000);
  assert.ok(events(r,'TASK_02_HELD').some(e=>e.reason==='WAREHOUSE_SHIPPING'));
  assert.equal(r.final.pallets.find(p=>p.palletId==='SYN-AFTER-SHIP').stage,'stored');
});

test('one forklift queues full rows without parallel work and counts the actual source line',()=>{
  const r=simulate(fixture({fullRows:[1,2],durationMin:7}));
  assert.deepEqual(events(r,'WAREHOUSE_SHIPMENT_STARTED').map(e=>e.timeMs),[0,240000]);
  assert.deepEqual(r.final.warehouseShipping.byLine,{L1:4,L2:2});
  assert.equal(r.final.warehouseShipping.shippedPL,6);
});

test('a horizon during shipping counts only removed pallets and does not release the row',()=>{
  const r=simulate(fixture({durationMin:3}));
  assert.equal(r.final.warehouseShipping.shippedPL,2);
  assert.equal(events(r,'WAREHOUSE_SHIPMENT_COMPLETED').length,0);
  assert.ok(r.final.warehouse['WB3-R01-C01-T1'].shippingJobId);
  assert.equal(r.final.pallets.filter(p=>p.stage==='stored').length,2);
});

test('partial loads with unusable upper tiers form a saturated row and leave as single-pallet trips',()=>{
  const s=fixture();
  s.initialPallets=s.initialPallets.filter(p=>!p.palletId.endsWith('-2')).map(p=>({...p,loadType:'partial'}));
  s.warehouse.forEach(slot=>{if(slot.tier===2)slot.palletIds=[];});
  const r=simulate(s);
  assert.deepEqual(events(r,'WAREHOUSE_SHIPMENT_PICKED').map(e=>e.palletIds.length),[1,1]);
  assert.equal(r.final.warehouseShipping.shippedPL,2);
});

test('a non-full row and explicit legacy disable never cause premature shipment',()=>{
  const s=fixture();s.warehouse[1].palletIds=[];s.initialPallets.splice(1,1);
  assert.equal(events(simulate(s),'WAREHOUSE_SHIPMENT_STARTED').length,0);
  const disabled=fixture();disabled.warehouseShipping.enabled=false;
  assert.equal(events(simulate(disabled),'WAREHOUSE_SHIPMENT_PICKED').length,0);
});

test('only real delivered inventory fills a row; completing storage triggers one new shipment',()=>{
  const s=fixture({fullRows:[],columns:1,durationMin:6});
  s.productionEvents=[0,30000,60000,90000].map((timeMs,i)=>({timeMs,lineId:'L1',palletId:'SYN-NEW-'+i,productType:'normal',loadType:'full'}));
  const r=simulate(s),stores=events(r,'STORE_COMPLETED'),starts=events(r,'WAREHOUSE_SHIPMENT_STARTED');
  assert.equal(stores.length,4);assert.equal(starts.length,2);
  assert.ok(starts[0].sequence>stores[1].sequence);assert.ok(starts[1].sequence>stores[3].sequence);
  assert.equal(r.final.warehouseShipping.shippedPL,4);
  assert.equal(new Set(events(r,'WAREHOUSE_SHIPMENT_PICKED').flatMap(e=>e.palletIds)).size,4);
  assert.equal(analyzeRun(r).products.find(row=>row.sourceLineId==='L1').pending,0);
  assert.equal(analyzeRun(r).products.find(row=>row.sourceLineId==='L1').stored,4);
});

test('a shared SPECIAL row attributes each removed pallet to its own original production line',()=>{
  const s=fixture({columns:1});s.warehousePolicy.rowAssignments[0]={rowId:'WB3-R01',usage:'special'};
  s.warehousePolicy.rowAssignments.push({rowId:'WB3-R09',usage:'normal',sourceLineId:'L1'});
  for(let tier=1;tier<=2;tier++)s.warehouse.push({id:`WB3-R09-C01-T${tier}`,rowId:'WB3-R09',blockId:'WB3',row:9,column:1,tier,capacity:1,palletIds:[],permission:true});
  s.initialPallets=s.initialPallets.map((p,i)=>({...p,productType:'special',sourceLineId:i===0?'L1':'L2'}));
  const r=simulate(s),summary=warehouseShippingSummary(r);
  assert.equal(summary.byLine.find(row=>row.sourceLineId==='L1').shippedPL,1);
  assert.equal(summary.byLine.find(row=>row.sourceLineId==='L2').shippedPL,1);
});

test('configured separate forklifts may run two rows concurrently without duplicate inventory or resources',()=>{
  const s=fixture({columns:1,fullRows:[1,2],durationMin:3});s.warehouseShipping.forkliftCount=2;
  const r=simulate(s),starts=events(r,'WAREHOUSE_SHIPMENT_STARTED');
  assert.deepEqual(starts.map(e=>e.timeMs),[0,0]);
  assert.equal(new Set(starts.map(e=>e.forkliftId)).size,2);
  assert.equal(r.final.warehouseShipping.shippedPL,4);
});

test('saved shipment achievements agree with Japanese results, separate BOM CSV and 14-column transport history',()=>{
  const s=fixture({durationMin:3}),r=simulate(s),summary=warehouseShippingSummary(r);
  s.warehouseShipping.cycleMin=99;
  assert.equal(summary.shippedPL,2);assert.equal(summary.byLine[0].storedPL,2);assert.equal(summary.byLine[0].shippingPL,2);
  assert.match(renderWarehouseShippingResults(r),/系列別出荷実績/);
  const csv=shippingResultsCsv(r);assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/L1,2,2,2/);
  assert.match(customerCsvFilename('SYN','shipping'),/系列別出荷実績/);
  assert.match(customerConditionsCsv(r),/1往復,共通,2,分/);
  assert.match(conditionCsv(r),/SHIPPING,warehouseShipping,cycleMin,2/);
  assert.match(eventCsv(r,'SYN'),/sourceLineCounts/);
  const history=transportHistoryCsv(r);assert.equal(history.split('\r\n')[0].slice(1).split(',').length,14);
  assert.match(history,/有人フォーク運び出し完了/);assert.match(history,/SYN-INITIAL-1-1-1 \/ SYN-INITIAL-1-1-2/);
  assert.match(history,/L1 2PL/);
  assert.match(customerPendingReason({status:'queued',waitReason:'WAREHOUSE_SHIPPING'}),/出荷作業中/);
});

test('ordinary defaults expose provisional shipping settings and validate field-specific input errors',()=>{
  const s=createDemoScenario('standard');assert.equal(s.warehouseShipping.enabled,true);
  assert.equal(s.warehouseShipping.cycleMin,2);assert.equal(s.warehouseShipping.loadCapacityPL,2);
  assert.match(renderWarehouseShippingSettings(s),/暫定仮定/);
  const updated=warehouseShippingFromSettings(s.warehouseShipping,{enabled:true,cycleMin:'3',forkliftCount:'2'});
  assert.equal(updated.cycleMin,3);assert.equal(updated.timeEvidence,'explicit-scenario-assumption');
  assert.throws(()=>warehouseShippingFromSettings(updated,{enabled:true,cycleMin:'',forkliftCount:'2'}),e=>e.settingsFieldSelectors.includes('#warehouse-shipping-cycle'));
  assert.throws(()=>warehouseShippingFromSettings(updated,{enabled:true,cycleMin:'3',forkliftCount:'0'}),e=>e.settingsFieldSelectors.includes('#warehouse-shipping-forklifts'));
  assert.equal(createDemoScenario('physical').warehouseShipping,undefined);
  const preview=createInitialPreview(s);assert.equal(preview.previewOnly,true);
  assert.deepEqual(preview.scenario.warehouseShipping,s.warehouseShipping);
  assert.equal(preview.events.filter(e=>e.type.startsWith('WAREHOUSE_SHIPMENT_')).length,0);
});

test('public warehouse replay shows a partly cleared shipping row as unavailable until row completion',()=>{
  const s=createDemoScenario('standard');s.durationMin=3;s.lineIntervalsMin=Array(8).fill(0);
  s.productStreams.forEach(stream=>{stream.enabled=false;});
  const row=s.warehouse.filter(slot=>slot.rowId==='EB2-R01');
  s.initialPallets=row.map((slot,i)=>({palletId:'SYN-EB-'+i,sourceLineId:'L8',productType:'normal',loadType:'full'}));
  row.forEach((slot,i)=>{slot.palletIds=[s.initialPallets[i].palletId];});
  const r=simulate(s),snap={...r.final,warehouseAllocation:r.scenario.warehousePolicy};
  const html=renderWarehouseBlock('EB2',1,snap);
  assert.match(html,/出荷中・入庫不可/);assert.match(html,/slot-unavailable/);
  assert.equal(r.final.warehouseShipping.shippedPL,2);
});

test('invalid shipping durations, capacity or forklift counts are rejected before work starts',()=>{
  for(const patch of [{cycleMin:0},{cycleMin:-1},{cycleMin:NaN},{forkliftCount:0},{forkliftCount:1.5},{loadCapacityPL:3}]){
    const s=fixture();Object.assign(s.warehouseShipping,patch);
    assert.throws(()=>simulate(s),/SHIPPING_CONFIG/);
  }
});
