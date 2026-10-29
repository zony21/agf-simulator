import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario,createLegacyScenario} from '../src/ui/scenario.mjs';
import {initMap} from '../src/ui/map-view.mjs';
import {createVnp20TravelProfile,prepareVehicleTravel,vehicleFrontHeading,validateVehicleTravelProfile} from '../src/core/vehicle-travel.mjs';
import {findOperationalPath} from '../src/map/operational-topology.mjs';
import {projectAgfPosition} from '../src/core/motion-projection.mjs';
import {simulate} from '../src/core/simulate.mjs';
import {renderVehicleTravelSettings,vehicleTravelProfileFromSettings} from '../src/ui/vehicle-travel-settings.mjs';
import {buildRunConditions} from '../src/ui/run-conditions.mjs';
import {customerConditionRows} from '../src/ui/customer-conditions.mjs';
import {conditionCsv,eventCsv} from '../src/ui/export.mjs';
import {vehicleHeadingLabel} from '../src/ui/format.mjs';

function graph(){
  const nodes=[['START',0,'home'],['PICKUP',-10,'pickup'],['IN',20,'dropoff'],['OUT',30,'pickup'],
    ['STORE',40,'dropoff'],['CHARGE',-20,'charge']].map(([id,x,type])=>({id,x,y:0,type,areaId:'PZ',approvalState:'synthetic-validated'}));
  const edges=[['SOURCE','START','PICKUP'],['INPUT','START','IN'],['PROCESS','IN','OUT'],
    ['STORE','OUT','STORE'],['CHARGE','START','CHARGE']].map(([id,fromNodeId,toNodeId])=>({id,fromNodeId,toNodeId,
      distanceMm:10000,speedMmPerSec:{empty:1000,loaded:750,charge:850,wait:850},
      approvalState:'synthetic-validated',lanes:[{id:id+'-L',direction:'both'}],
      lanePolicy:{laneCount:1,simultaneousPassing:'no-alternating'},occupancyResourceIds:[],
      accessScopes:['empty','loaded','charge','wait'].map(movement=>({movement,taskTypes:['*']}))}));
  return {schemaVersion:'operational-topology-v1',datasetKind:'synthetic',evidence:'synthetic-assumption',
    coordinateSystem:'synthetic-display',readiness:{operationalRoutingReady:true,physicalEtaAllowed:false},nodes,edges,shutters:[],
    interfaceBindings:[{pattern:'L4',nodeId:'PICKUP'},{pattern:'WRAP-INPUT',nodeId:'IN'},
      {pattern:'WRAP-OUTPUT',nodeId:'OUT'},{pattern:'WB*',nodeId:'STORE'},{pattern:'EB*',nodeId:'STORE'},
      {pattern:'CHARGE-PLACE',nodeId:'CHARGE'}]};
}
const configured=(p=createVnp20TravelProfile(),g=graph())=>prepareVehicleTravel({motionModel:'synthetic_graph',operationalTopology:g,vehicleTravelProfile:p});
const path=(g,from='START',to='PICKUP',movement='empty')=>findOperationalPath(g,from,to,{movement,taskType:'01'});

function engineScenario(){
  const s=createLegacyScenario('manual');s.motionModel='synthetic_graph';s.durationMin=20;s.operationalTopology=graph();
  s.agfs=s.agfs.map((a,i)=>({...a,currentNodeId:'START',heading:'east',headingDeg:0,blocked:i!==0}));
  s.vehicleTravelProfile=createVnp20TravelProfile();s.vehicleTravelProfile.defaultDirection.empty='reverse';
  s.productionEvents=[{timeMs:0,lineId:'L4',palletId:'SYN-VEHICLE-POSE',destinationLocationId:s.generatedDestinationIds[0]}];
  return s;
}

test('neutral Run uses separate empty/loaded forward catalogue reference speeds',()=>{
  for(const preset of ['standard','extended']){
    const s=createDemoScenario(preset),speeds=s.operationalTopology.edges.find(edge=>!edge.vehicleServiceApproach).speedMmPerSec;
    assert.equal(speeds.empty,2500);assert.equal(speeds.loaded,2100);
    assert.equal(speeds.charge,2500);assert.equal(speeds.wait,2500);
    assert.equal(s.vehicleTravelProfile.frontDefinition,'opposite-forks');
    assert.equal(s.vehicleTravelProfile.ceVariantVerified,false);
  }
});

test('the AGF symbol places the forks opposite to its declared vehicle front',()=>{
  const s=createDemoScenario(),svg={innerHTML:'',addEventListener(){},setAttribute(){}};
  const agf={...s.agfs[0],status:'moving_empty',heading:'east',headingDeg:0,
    movement:{current:{edgeId:'SYNTHETIC',vehicleTravelDirection:'forward'}},
    displayPosition:{x:100,y:100,heading:'east',headingDeg:0},carriedPalletId:null};
  initMap({svg,onSelectAgf(){},onSelectBlock(){}}).render({agfs:[agf],warehouse:{},tasks:[],pallets:[],
    lines:{},magazines:{},aligners:{},temporaryPallets:[],wrapper:{}},agf.id);
  assert.ok(svg.innerHTML.includes('class="agf-forks" d="M-23 -7 H-33 M-23 7 H-33"'));
});

test('legacy fixtures keep their original graph speeds and do not gain a vehicle profile',()=>{
  const s=createLegacyScenario('physical'),copy=structuredClone(s);
  assert.equal(s.vehicleTravelProfile,undefined);assert.equal(prepareVehicleTravel(s),s);
  assert.deepEqual(s,copy);assert.equal(s.operationalTopology.edges[0].speedMmPerSec.empty,1000);
});

test('empty and loaded forward durations use their different speeds on the same 10m fixture',()=>{
  const g=configured().operationalTopology;
  assert.equal(path(g).modelDurationMs,4000);assert.equal(path(g,'START','PICKUP','loaded').modelDurationMs,4762);
  assert.equal(path(g,'PICKUP','START').modelDurationMs,4000);
  assert.equal(path(g,'PICKUP','START').steps[0].traversal,'reverse');
  assert.equal(path(g,'PICKUP','START').steps[0].vehicleTravelDirection,'forward');
});

test('reverse driving uses 0.6m/s independently of load and of graph traversal',()=>{
  const p=createVnp20TravelProfile();p.defaultDirection.empty='reverse';p.defaultDirection.loaded='reverse';
  const g=configured(p).operationalTopology;
  for(const movement of ['empty','loaded'])for(const [from,to] of [['START','PICKUP'],['PICKUP','START']]){
    const route=path(g,from,to,movement);assert.equal(route.modelDurationMs,16667);
    assert.equal(route.steps[0].vehicleTravelDirection,'reverse');assert.equal(route.steps[0].vehicleSpeedMmPerSec,600);
  }
  assert.equal(g.edges[0].speedMmPerSec.charge,2500);assert.equal(g.edges[0].speedMmPerSec.wait,2500);
});

test('explicit segment reverse and speed caps are preserved without changing graph lane permissions',()=>{
  const input=graph(),edge=input.edges[0];edge.vehicleDirectionOverrides={loaded:'reverse'};
  edge.vehicleSpeedLimitMmPerSec={empty:1200,loaded:500};
  const before=structuredClone(input),g=configured(undefined,input).operationalTopology;
  assert.equal(g.edges[0].speedMmPerSec.empty,1200);assert.equal(g.edges[0].speedMmPerSec.loaded,500);
  assert.equal(g.edges[0].vehicleTravelDirection.loaded,'reverse');assert.deepEqual(input,before);
  assert.deepEqual(g.edges[0].lanes,edge.lanes);
  assert.deepEqual(configured(undefined,g).operationalTopology,g);
});

test('invalid speeds, drive direction or segment limits are rejected instead of silently defaulted',()=>{
  const p=createVnp20TravelProfile();p.straightMmPerSec.loaded.reverse=0;
  assert.throws(()=>validateVehicleTravelProfile(p),/VEHICLE_TRAVEL_CONFIG/);
  p.straightMmPerSec.loaded.reverse=600;p.defaultDirection.empty='both';
  assert.throws(()=>configured(p),/前進／後進/);
  const g=graph();g.edges[0].vehicleSpeedLimitMmPerSec={empty:0};assert.throws(()=>configured(undefined,g),/区間速度制限/);
});

test('m/s settings retain catalogue evidence unless edited and keep empty/loaded directions independent',()=>{
  const p=createVnp20TravelProfile(),html=renderVehicleTravelSettings({vehicleTravelProfile:p});
  assert.match(html,/車体前方はフォークと反対側/);assert.match(html,/CE.*未確認/);
  assert.match(html,/value="2.5"/);assert.match(html,/value="2.1"/);
  assert.deepEqual(vehicleTravelProfileFromSettings(p,{'empty.forward':'2.5','loaded.forward':'2.1'}),p);
  const edited=vehicleTravelProfileFromSettings(p,{'empty.forward':'1.8',loaded:'reverse'});
  assert.equal(edited.straightMmPerSec.empty.forward,1800);assert.equal(edited.defaultDirection.empty,'forward');
  assert.equal(edited.defaultDirection.loaded,'reverse');assert.equal(edited.speedEvidence,'explicit-scenario-setting');
  assert.equal(edited.directionEvidence,'explicit-scenario-setting');assert.equal(p.straightMmPerSec.empty.forward,2500);
  assert.throws(()=>vehicleTravelProfileFromSettings(p,{'empty.forward':''}),/直進速度/);
});

test('reverse replay moves in travel direction while the vehicle front faces the opposite direction',()=>{
  const agf={status:'moving_empty',headingDeg:0,heading:'east',movement:{current:{fromNodeId:'START',toNodeId:'PICKUP',
    vehicleTravelDirection:'reverse',enteredAt:0,exitAt:1000}}};
  const mid=projectAgfPosition(agf,graph(),500);
  assert.equal(mid.x,-5);assert.equal(mid.headingDeg,0);assert.equal(mid.travelHeadingDeg,180);assert.equal(mid.forkHeadingDeg,180);
  assert.equal(mid.vehicleTravelDirection,'reverse');assert.equal(vehicleFrontHeading(270,'reverse'),90);
  const label=vehicleHeadingLabel({...agf,displayPosition:mid});
  assert.match(label,/車体前方 東/);assert.match(label,/後進/);assert.match(label,/進行 西/);
  agf.movement.current.displayPath=[{x:0,y:0},{x:-10,y:0}];
  assert.deepEqual(projectAgfPosition(agf,graph(),500),mid);
});

test('engine separates reverse travel from vehicle pose without adding a spurious 180 degree turn',()=>{
  const s=engineScenario(),run=simulate(s),entered=run.events.find(e=>e.type==='SEGMENT_ENTERED');
  assert.equal(entered.edgeId,'SOURCE');assert.equal(entered.vehicleTravelDirection,'reverse');
  assert.equal(entered.vehicleSpeedMmPerSec,600);assert.equal(entered.modelDurationMs,16667);
  assert.equal(entered.headingDeg,0);assert.equal(entered.travelHeadingDeg,180);assert.equal(entered.forkHeadingDeg,180);
  assert.equal(entered.timeMs,0);assert.ok(!run.events.some(e=>e.type==='TURN_STARTED'&&e.timeMs<16667));
  assert.ok(run.final.tasks.some(t=>t.kind==='01'&&t.status==='completed'));
  assert.deepEqual(simulate(s).events,run.events);
  const old=entered.vehicleSpeedMmPerSec;s.vehicleTravelProfile.straightMmPerSec.empty.reverse=500;
  assert.equal(entered.vehicleSpeedMmPerSec,old);assert.equal(run.scenario.vehicleTravelProfile.straightMmPerSec.empty.reverse,600);
});

test('saved conditions and event CSV preserve catalogue limits, actual direction, speed and pose',()=>{
  const run=simulate(engineScenario()),rows=buildRunConditions(run),csv=conditionCsv(run),events=eventCsv(run,'SYN-DRIVE');
  assert.ok(rows.some(r=>r.category==='VEHICLE_TRAVEL'&&r.subkey==='ceVariantVerified'&&r.value===false));
  assert.ok(rows.some(r=>r.category==='GRAPH_SPEED'&&r.key==='SOURCE'&&r.subkey==='empty'&&r.value===600));
  assert.match(csv,/VEHICLE_TRAVEL,profile,straightMmPerSec/);
  for(const field of ['vehicleTravelDirection','vehicleSpeedMmPerSec','vehicleSpeedEvidence','travelHeadingDeg','forkHeadingDeg'])
    assert.ok(events.split('\r\n')[0].includes(field));
  const customer=customerConditionRows(run);
  assert.equal(customer.find(r=>r.key==='vehicle.direction.empty').value,'後進・フォークが先頭');
  assert.equal(customer.find(r=>r.key==='vehicle.speed.loaded.forward').value,2.1);
});
