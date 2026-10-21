import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/core/simulate.mjs';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {selectAgfWithReason} from '../src/core/select-agf.mjs';
import topology from '../examples/synthetic-operational-topology.json' with {type:'json'};
import {WAREHOUSE_SERVICE,NORMAL_WAITING_PRIORITY} from '../src/map/warehouse-layout.mjs';

test('standard Run starts at two charge places and two pillar stops; HP waiting is retired',()=>{
  const scenario=createDemoScenario('standard');
  assert.deepEqual(scenario.initialParking.placeIds,
    ['CHARGE-PLACE1','CHARGE-PLACE2','PILLAR-WAIT-W','PILLAR-WAIT-E']);
  assert.deepEqual(scenario.agfs.map(agf=>agf.currentNodeId),scenario.initialParking.placeIds);
  assert.deepEqual(NORMAL_WAITING_PRIORITY,
    ['PILLAR-WAIT-E','PILLAR-WAIT-W','CHARGE-PLACE1','CHARGE-PLACE2']);
  assert.deepEqual(WAREHOUSE_SERVICE.waitingPlaces.map(place=>place.id),['PILLAR-WAIT-E','PILLAR-WAIT-W']);
  assert.equal(topology.nodes.some(node=>['HP1','HP2'].includes(node.id)),false);
  assert.equal(Object.hasOwn(scenario.battery,'taskStartPct'),false,
    'the charge recovery target is not a separate global task-start threshold');
  assert.equal(scenario.battery.chargeStartPct,40);
  assert.equal(scenario.battery.chargeTargetPct,60);
});

test('aligners are a vertical synthetic stack approached from their west side, charges keep their positions',()=>{
  const byId=new Map(topology.nodes.map(node=>[node.id,node]));
  const charges=['CHARGE-PLACE1','CHARGE-PLACE2'].map(id=>byId.get(id));
  assert.deepEqual(charges.map(node=>[node.x,node.y]),[[962,842.5],[962,873.5]]);
  const accesses=Array.from({length:5},(_,i)=>byId.get(`WH-AL${i+1}-ACCESS`));
  const pickups=Array.from({length:5},(_,i)=>byId.get(`WH-AL${i+1}-PICKUP`));
  assert.equal(new Set(accesses.map(node=>node.x)).size,1);
  assert.equal(new Set(pickups.map(node=>node.x)).size,1);
  for(let i=0;i<5;i++){
    assert.equal(accesses[i].y,pickups[i].y);
    assert.ok(accesses[i].x<pickups[i].x,'AGF access and pickup must be west of equipment');
    if(i)assert.ok(accesses[i-1].y<accesses[i].y,'aligner slots must be vertically ordered');
  }
});

const agf=(id,area,batteryPct)=>({id,area,batteryPct,status:'idle'});
const select=(agfs,priorities)=>selectAgfWithReason(agfs,{originArea:'PZ',destinationArea:'WH'},
  {mode:'source_area_agf_priority',reservePct:40,agfPriorities:priorities,fallback:'any'});

test('source-area AGF-priority mode compares source area before configured AGF rank',()=>{
  const decision=select([agf('AGF1','WH',95),agf('AGF2','PZ',60),agf('AGF3','PZ',99),agf('AGF4','WH',80)],
    {AGF1:1,AGF2:4,AGF3:3,AGF4:2});
  assert.equal(decision.agf.id,'AGF3');
  assert.equal(decision.selection.basis,'source_area');
  assert.deepEqual(decision.selection.candidates.map(item=>item.agfId),['AGF3','AGF2']);
  assert.equal(decision.selection.stages.some(stage=>stage.stage==='agf_priority'),true);
});

test('source-area AGF-priority mode uses numeric rank before battery among same-area AGFs',()=>{
  const decision=select([agf('AGF1','PZ',70),agf('AGF2','PZ',95),agf('AGF3','WH',99),agf('AGF4','WH',80)],
    {AGF1:2,AGF2:1,AGF3:3,AGF4:4});
  assert.equal(decision.agf.id,'AGF2');
  assert.equal(decision.selection.selectedAgfPriority,1);
});

test('59 percent remains eligible when not charging; charge recovery is not a task-start gate',()=>{
  const decision=select([agf('AGF1','PZ',59.9),agf('AGF2','PZ',60),agf('AGF3','PZ',75),agf('AGF4','WH',90)],
    {AGF1:1,AGF2:2,AGF3:3,AGF4:4});
  assert.equal(decision.agf.id,'AGF1');
  assert.equal(decision.selection.evaluations.find(item=>item.agfId==='AGF1').eligible,true);
});

test('standard Run assigns an idle 59 percent AGF and does not treat charge recovery as a start gate',()=>{
  const scenario=createDemoScenario('extended');scenario.durationMin=2;scenario.mode='low_battery_first';
  scenario.productStreams.forEach(stream=>{stream.enabled=false;});scenario.productionEvents=[];
  scenario.agfs[0].batteryPct=59;
  scenario.agfs.slice(1).forEach(agf=>{agf.blocked=true;});
  scenario.temporaryPallets=[{palletId:'SYN-59-PCT',locationId:'OT1',destinationLocationId:null,
    sourceLineId:'L1',productType:'normal',loadType:'full'}];
  scenario.manualRequests=[{timeMs:0,kind:'04',palletId:'SYN-59-PCT',locationId:'OT1',reentryPermission:true}];
  const run=simulate(scenario),assigned=run.events.find(event=>event.type==='TASK_ASSIGNED');
  assert.equal(assigned.agfId,'AGF1');
  assert.equal(assigned.timeMs,0);
  assert.equal(run.events.some(event=>event.type==='CHARGE_REQUESTED'&&event.agfId==='AGF1'),false);
});
