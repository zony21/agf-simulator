import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {simulate} from '../src/core/simulate.mjs';
import {findOperationalPath} from '../src/map/operational-topology.mjs';
import {SCHEMATIC_LAYOUT} from '../src/map/schematic-layout.mjs';
import {prepareWarehouseRouting} from '../src/map/warehouse-routing.mjs';
import {chooseWarehouseLocation,warehouseAvailability,validateWarehousePolicy} from '../src/core/warehouse-policy.mjs';
import {createTrafficController} from '../src/core/traffic-controller.mjs';
import {directionHeading} from '../src/core/motion-control.mjs';
import {initMap,renderWarehouseBlock} from '../src/ui/map-view.mjs';
import {conditionCsv} from '../src/ui/export.mjs';
import {customerConditionsCsv} from '../src/ui/customer-export.mjs';
import {integratedAcceptanceScenario} from '../examples/integrated-acceptance.mjs';

const path=(graph,from,to,movement='empty',taskType='01')=>findOperationalPath(graph,from,to,{movement,taskType});
function assignFlexibleToL1(s){
  const rows=['WB1-WB2-FLEX-R01','WB1-WB2-FLEX-R02'];
  s.warehousePolicy.rowAssignments=s.warehousePolicy.rowAssignments.filter(a=>a.sourceLineId!=='L1');
  s.warehousePolicy.rowAssignments.push(...rows.map(rowId=>({rowId,usage:'normal',sourceLineId:'L1'})));
  s.warehousePolicy.rowPriority.L1=rows;return s;
}
function quiet(mode='normal'){
  const scenario=createDemoScenario('standard');scenario.warehouseRouteMode=mode;
  scenario.durationMin=1;scenario.productStreams.forEach(stream=>{stream.enabled=false;});
  scenario.productionEvents=[];return scenario;
}
test('ordinary Run defaults to normal warehouse routing with 26 single-tier flexible locations',()=>{
  const scenario=createDemoScenario('standard');
  assert.equal(scenario.warehouseRouteMode,'normal');
  const locations=scenario.warehouse.filter(slot=>slot.flexibleAreaId==='WB1-WB2-FLEX');
  assert.equal(locations.length,26);
  assert.ok(locations.every(slot=>slot.tier===1));
});
test('west perimeter opening is on the north boundary west of WB1 rather than beside the fire wall',()=>{
  const gate=SCHEMATIC_LAYOUT.gates.whWest;
  assert.equal(gate.boundaryY,SCHEMATIC_LAYOUT.buildings.WH.y);
  assert.ok(gate.x<225,'WB1 synthetic drawing starts at x=225');
  assert.ok(gate.x>SCHEMATIC_LAYOUT.buildings.WH.x);
});
test('detour Run actually uses west shutter and reverses PZ gate roles without reversing the PZ main lanes',()=>{
  const run=simulate(quiet('detour')),graph=run.scenario.operationalTopology;
  const inbound=path(graph,'WH-HOME','PZ-L1-PICKUP');
  const outbound=path(graph,'PZ-WRAP-OUT','WH-HOME','loaded','02');
  assert.ok(inbound&&outbound);
  const shutters=route=>route.steps.map(step=>step.shutterId).filter(Boolean);
  assert.ok(shutters(inbound).includes('SH-WEST'));
  assert.ok(shutters(inbound).includes('SH-PZ-EXIT'));
  assert.ok(shutters(outbound).includes('SH-PZ-ENTRY'));
  assert.ok(shutters(outbound).includes('SH-WEST'));
  assert.ok(!shutters(inbound).includes('SH-EAST')&&!shutters(outbound).includes('SH-EAST'));
  assert.equal(graph.trafficPolicy.pz.north,'east_to_west');
  assert.equal(graph.trafficPolicy.pz.south,'west_to_east');
});

for(const mode of ['normal','detour'])test(`${mode} routes cover every transport origin and charge stop with mode-specific gates`,()=>{
  const scenario=prepareWarehouseRouting(quiet(mode)),g=scenario.operationalTopology;
  const pairs=[['WH-HOME','PZ-L1-PICKUP','empty','01'],['PZ-WRAP-OUT','WB1-R01-DROP','loaded','02'],
    ['WH-AL1-PICKUP','PZ-M1-DROPOFF','loaded','03'],['PZ-OT1-PICKUP','PZ-WRAP-IN','loaded','04'],
    ['PZ-OT1-PICKUP','EB1-R01-DROP','loaded','05'],['PZ-L1-PICKUP','CHARGE-PLACE1','charge','CHARGE']];
  for(const [from,to,movement,kind] of pairs){
    const route=path(g,from,to,movement,kind);assert.ok(route,`${kind}: ${from} → ${to}`);
    const shutters=route.steps.map(s=>s.shutterId);
    assert.ok(!shutters.includes(mode==='normal'?'SH-WEST':'SH-EAST'));
    if(from.startsWith('WH-')&&to.startsWith('PZ-')){
      assert.ok(shutters.includes(mode==='normal'?'SH-EAST':'SH-WEST'));
      assert.ok(shutters.includes(mode==='normal'?'SH-PZ-ENTRY':'SH-PZ-EXIT'));
    }
    if(from.startsWith('PZ-')&&!to.startsWith('PZ-')){
      assert.ok(shutters.includes(mode==='normal'?'SH-EAST':'SH-WEST'));
      assert.ok(shutters.includes(mode==='normal'?'SH-PZ-EXIT':'SH-PZ-ENTRY'));
    }
    if(mode==='detour'&&(from.startsWith('WH-')&&to.startsWith('PZ-')||from.startsWith('PZ-')&&!to.startsWith('PZ-')))
      assert.ok(route.steps.some(s=>s.edgeId==='WB12-DETOUR'));
  }
  for(const id of ['WB1-WB2-FLEX-R01-DROP','WB1-WB2-FLEX-R02-DROP'])
    assert.equal(!!path(g,'PZ-WRAP-OUT',id,'loaded','02'),mode==='normal');
});

for(const [name,change,reason] of [
  ['stock',s=>{s.warehouse.at(-1).palletIds=['PALLET'];},/在荷/],
  ['inbound reservation',s=>{s.warehouse.at(-1).reserved=['PALLET'];},/搬入予約/],
  ['active task',s=>{s.initialTasks=[{id:'ACTIVE',status:'moving',destinationId:s.warehouse.at(-1).id}];},/使用中/],
  ['manual reservation',s=>{s.manualRequests=[{kind:'05',destinationLocationId:s.warehouse.at(-1).id}];},/搬送予約/]
])test(`detour start rejects flexible-area ${name} and never deletes or relocates it`,()=>{
  const s=quiet('detour');change(s);const saved=structuredClone(s);
  assert.throws(()=>simulate(s),reason);assert.deepEqual(s,saved);
});

test('route mode and the unresolved flexible upper tier cannot be silently invented',()=>{
  const invalid=quiet('unknown');assert.throws(()=>simulate(invalid),/走行モード/);
  const upper=quiet();upper.warehouse.at(-1).tier=2;assert.throws(()=>simulate(upper),/上段は未確定/);
});

test('a saved detour scenario can return to normal without retaining detour-only merge reservations',()=>{
  const s=prepareWarehouseRouting(quiet('normal')),baseline=structuredClone(s.operationalTopology);
  s.warehouseRouteMode='detour';prepareWarehouseRouting(s);
  assert.ok(s.operationalTopology.edges.find(e=>e.id==='E07').mergeConflictResourceId?.startsWith('DETOUR-PZ-APPROACH:'));
  s.warehouseRouteMode='normal';prepareWarehouseRouting(s);
  assert.deepEqual(s.operationalTopology,baseline);
  assert.ok(s.warehouse.filter(slot=>slot.flexibleAreaId).every(slot=>slot.storageEnabled===true));
});

test('normal flexible storage is usable only with explicit row ownership; detour excludes all 26 slots and reservations',()=>{
  for(const mode of ['normal','detour']){
    const s=assignFlexibleToL1(prepareWarehouseRouting(quiet(mode))),policy=s.warehousePolicy;
    validateWarehousePolicy(policy,s.warehouse,{lineIds:Array.from({length:8},(_,i)=>'L'+(i+1)),specialEnabled:true});
    const slots=new Map(s.warehouse.map(slot=>[slot.id,{...slot,palletIds:[],reserved:[]}]));
    const context={pallet:{sourceLineId:'L1',productType:'normal',loadType:'full'},policy,slots,pallets:new Map(),rowBusy:new Set()};
    const choice=chooseWarehouseLocation(context);
    if(mode==='normal'){assert.equal(choice.location.id,'WB1-WB2-FLEX-R01-C01-T1');}
    else {assert.equal(choice.location,null);assert.ok([...slots.values()].filter(slot=>slot.flexibleAreaId).every(slot=>slot.storageEnabled===false));}
    const capacity=warehouseAvailability(slots,new Map(),policy);
    assert.equal(capacity.theoretical,802);assert.equal(capacity.flexibleFloorLocations,26);
    assert.equal(capacity.flexibleUsableLocations,mode==='normal'?26:0);
    assert.equal(capacity.modeCapacity,mode==='normal'?828:802);assert.equal(capacity.upperTierStatus,'unresolved');
  }
});

test('actual 02 stores into an explicitly assigned flexible floor location only in normal mode',()=>{
  for(const mode of ['normal','detour']){
    const s=assignFlexibleToL1(quiet(mode));s.durationMin=35;s.lineIntervalsMin.fill(0);
    s.productionEvents=[{timeMs:1000,lineId:'L1',palletId:'FLEX-PRODUCT',sourceLineId:'L1',productType:'normal',loadType:'full'}];
    const run=simulate(s),locations=Object.values(run.final.warehouse).filter(slot=>slot.flexibleAreaId);
    assert.equal(locations.flatMap(slot=>slot.palletIds).length,mode==='normal'?1:0);
    assert.ok(run.events.some(e=>e.type==='STORE_COMPLETED'&&e.locationId.startsWith('WB1-WB2-FLEX'))=== (mode==='normal'));
    if(mode==='detour')assert.ok(run.events.filter(e=>e.type==='WAREHOUSE_LOCATION_RESERVED').every(e=>!e.locationId?.startsWith('WB1-WB2-FLEX')));
  }
});

test('detour events and final state are deterministic without mutating the saved route input',()=>{
  const s=quiet('detour');s.durationMin=45;s.productStreams.forEach(stream=>{
    stream.enabled=stream.sourceLineId==='L1'&&stream.productType==='normal'&&stream.loadType==='full';
    stream.intervalMin=5;stream.startOffsetMin=0;
  });
  const saved=structuredClone(s),a=simulate(s),b=simulate(s);
  assert.deepEqual(a.events,b.events);assert.deepEqual(a.final,b.final);assert.deepEqual(s,saved);
});

for(const side of ['E','W'])test(`WH ${side} shutter permits two same-direction lanes with distinct positions and excludes unresolved opposing use`,()=>{
  const g=prepareWarehouseRouting(quiet(side==='E'?'normal':'detour')).operationalTopology;
  const ids=side==='E'?['E08','WH-E-PORTAL-L2-OUT']:['WH-W-PORTAL-L1','WH-W-PORTAL-L2'];
  const edges=ids.map(id=>g.edges.find(e=>e.id===id)),traffic=createTrafficController(g.edges,{nodes:g.nodes});
  const enter=(i,id,traversal='forward')=>traffic.tryEnter({agfId:id,edgeId:ids[i],traversal});
  assert.equal(enter(0,'A').entered,true);assert.equal(enter(1,'B').entered,true);
  assert.notEqual(edges[0].lanes[0].resourceId,edges[1].lanes[0].resourceId);
  assert.notEqual(g.nodes.find(n=>n.id===edges[0].fromNodeId).x,g.nodes.find(n=>n.id===edges[1].fromNodeId).x);
  assert.equal(enter(0,'C').entered,false);
  for(const id of ['A','B']){traffic.release(id);traffic.cancelNodeReservation(id);}
  const inbound=side==='E'?'E09-PART3':ids[0];
  assert.equal(traffic.tryEnter({agfId:'IN',edgeId:inbound,traversal:side==='E'?'forward':'reverse'}).entered,true);
  const opposed=enter(1,'OUT');assert.equal(opposed.entered,false);assert.equal(opposed.reason,'OPPOSING_PASSAGE_UNCONFIRMED');
  traffic.release('IN');traffic.cancelNodeReservation('IN');assert.equal(enter(1,'OUT').entered,true);
  for(const edge of edges){
    const gate=g.nodes.find(n=>n.id===edge.fromNodeId),outer=g.nodes.find(n=>n.id===edge.toNodeId);
    assert.equal(gate.x,outer.x);assert.equal(directionHeading(gate,outer),270);
  }
  assert.equal(g.warehouseRouting.perimeterPassage.opposingSimultaneous,'unresolved');
});

test('WB1 western two-lane corridor is distinct from the four original main aisles and the alternating flexible lane',()=>{
  const g=prepareWarehouseRouting(quiet('detour')).operationalTopology;
  const roads=g.edges.filter(e=>/^WB1-WEST-L[12]$/.test(e.id));assert.equal(roads.length,2);
  assert.notEqual(roads[0].fromNodeId,roads[1].fromNodeId);
  const flex=g.edges.filter(e=>e.atomicPassageId==='WB12-DETOUR-PASSAGE');assert.equal(flex.length,3);
  assert.ok(flex.every(e=>e.lanes[0].resourceId==='WB12-SINGLE-LANE'&&e.lanePolicy.laneCount===1));
  const traffic=createTrafficController(g.edges,{nodes:g.nodes});
  assert.equal(traffic.tryEnter({agfId:'A',edgeId:'WB12-DETOUR',traversal:'forward'}).entered,true);
  assert.equal(traffic.tryEnter({agfId:'B',edgeId:'WB12-DETOUR',traversal:'reverse'}).entered,false);
  traffic.release('A');assert.equal(traffic.tryEnter({agfId:'B',edgeId:'WB12-DETOUR',traversal:'reverse'}).entered,true);
});

for(const mode of ['normal','detour'])test(`${mode} engine moves two AGFs through separate perimeter lanes at the same event time`,()=>{
  const s=quiet(mode);s.durationMin=5;s.lineIntervalsMin.fill(0);
  // Explicit synthetic approach fixture, not the ordinary initial parking.
  delete s.initialParking;
  s.agfs[0].currentNodeId=mode==='normal'?'WH-GATE':'WH-W-GATE';
  s.agfs[1].currentNodeId=mode==='normal'?'WH-E-GATE-L2':'WH-W-GATE-L2';
  for(const a of s.agfs.slice(0,2)){a.heading='north';a.headingDeg=270;}
  s.agfs.slice(2).forEach(a=>{a.blocked=true;});
  s.productionEvents=[1,2].map(n=>({timeMs:1000,lineId:'L'+n,sourceLineId:'L'+n,palletId:'PARALLEL-'+n,productType:'normal',loadType:'full'}));
  const r=simulate(s),g=r.scenario.operationalTopology,edges=new Map(g.edges.map(e=>[e.id,e]));
  const group=mode==='normal'?'SH-EAST-PARALLEL':'SH-WEST-PARALLEL';
  const index=r.snapshots.findIndex((snap,index)=>snap.agfs.filter(a=>a.movement?.current&&
    a.movement.current.exitAt>r.events[index].timeMs&&edges.get(a.movement.current.edgeId).directionalPassageId===group).length===2);
  assert.ok(index>=0,'two distinct saved movements must overlap inside the two-lane shutter');
  const snap=r.snapshots[index],active=snap.agfs.filter(a=>a.movement?.current&&edges.get(a.movement.current.edgeId).directionalPassageId===group);
  const resources=active.map(a=>{const e=edges.get(a.movement.current.edgeId),lane=e.lanes.find(l=>l.id===a.movement.current.laneId);
    assert.equal(snap.traffic.owners[lane.resourceId],a.id);return lane.resourceId;});
  assert.equal(new Set(resources).size,2);
  assert.notEqual(active[0].movement.current.displayPath[0].x,active[1].movement.current.displayPath[0].x);
});

test('saved run conditions and SVG agree with each selected mode and retain the flexible floor-only capacity',()=>{
  for(const mode of ['normal','detour']){
    const run=simulate(quiet(mode)),g=run.scenario.operationalTopology;
    const svg={innerHTML:'',setAttribute(){},addEventListener(){}};
    initMap({svg,onSelectAgf(){},onSelectBlock(){}}).render(run.final,'AGF1',{topology:g});
    assert.match(svg.innerHTML,new RegExp(`data-flex-mode="${mode==='normal'?'storage':'corridor'}"`));
    assert.match(svg.innerHTML,/data-map-id="WB1-WEST-TWO-LANES" data-lane-count="2"/);
    const dialog=renderWarehouseBlock('WB1-WB2-FLEX',2,run.final);
    assert.match(dialog,/上段.*未確定|26平面/);assert.doesNotMatch(dialog,/-T2/);
    const csv=conditionCsv(run,'ROUTING');assert.ok(csv.includes(`GRAPH,warehouseRouteMode,,${mode},user-confirmed`));
    assert.ok(customerConditionsCsv(run).includes(mode==='normal'?'通常ルート':'迂回ルート'));
    assert.match(csv,/upperTierStatus/);assert.match(csv,/unresolved/);
    assert.equal(run.scenario.warehouseRouteMode,mode);
  }
});

for(const mode of ['normal','detour'])test(`24-hour ${mode} synthetic acceptance completes 01–05 and charging without reciprocal blocking`,()=>{
  // Explicit synthetic regression input: production lasts three hours, then a
  // long idle horizon checks charging/return and avoids presenting a site forecast.
  const s=integratedAcceptanceScenario();s.warehouseRouteMode=mode;s.durationMin=1440;
  s.battery.chargeMinPerPct=.01;s.agfs[0].batteryPct=39.9;
  const r=simulate(s);assert.equal(r.events.at(-1).timeMs,86400000);
  for(const kind of ['01','02','03','04','05'])assert.ok(r.events.some(e=>e.type==='TASK_COMPLETED'&&e.kind===kind),kind);
  assert.ok(r.events.some(e=>e.type==='CHARGE_ENDED'));assert.equal(r.events.filter(e=>e.type==='DEADLOCK_DETECTED').length,0);
  const forbidden=mode==='normal'?'SH-WEST':'SH-EAST';
  const ids=new Set(r.scenario.operationalTopology.edges.filter(e=>e.shutterId===forbidden).map(e=>e.id));
  assert.ok(r.events.filter(e=>e.type==='SEGMENT_ENTERED').every(e=>!ids.has(e.edgeId)));
  const straightStops=new Set(['WH-GATE','WH-E-GATE-L2','WH-E-OUTER-L1','WH-E-OUTER-L2',
    'WH-W-GATE','WH-W-GATE-L2','WH-W-OUTER-L1','WH-W-OUTER-L2']);
  assert.ok(r.events.filter(e=>e.type==='TURN_STARTED').every(e=>!straightStops.has(e.nodeId)),
    'aligned exterior gate stops do not introduce an extra 90° or 180° turn');
  assert.ok(Object.values(r.final.warehouse).filter(s=>s.flexibleAreaId).every(s=>mode==='normal'||!s.palletIds.length&&!s.reserved.length));
});
