import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {findOperationalPath,splitSyntheticDisplayTurns} from '../src/map/operational-topology.mjs';
import {prepareVehicleTravel} from '../src/core/vehicle-travel.mjs';
import {simulate} from '../src/core/simulate.mjs';
import {renderVehicleTravelSettings} from '../src/ui/vehicle-travel-settings.mjs';
import {buildRunConditions} from '../src/ui/run-conditions.mjs';
import {conditionCsv,eventCsv} from '../src/ui/export.mjs';

const path=(g,from,to,movement='empty')=>findOperationalPath(g,from,to,{movement,taskType:'01'});

test('equipment entry is fork-leading reverse and withdrawal is vehicle-forward',()=>{
  const g=createDemoScenario().operationalTopology;
  const node=g.nodes.find(n=>n.interfaceId==='L1'),from=node.accessNodeId;
  const entry=path(g,from,node.id),exit=path(g,node.id,from,'loaded');
  assert.equal(entry.steps.at(-1).vehicleTravelDirection,'reverse');
  assert.equal(entry.steps.at(-1).vehicleSpeedMmPerSec,600);
  assert.equal(entry.steps.at(-1).serviceMotionPhase,'service-entry');
  assert.equal(exit.steps[0].vehicleTravelDirection,'forward');
  assert.equal(exit.steps[0].vehicleSpeedMmPerSec,2100);
  assert.equal(exit.steps[0].serviceMotionPhase,'service-exit');
});

test('warehouse row entry is fork-leading reverse and empty exit is forward',()=>{
  const g=createDemoScenario().operationalTopology;
  const node=g.nodes.find(n=>n.id==='WB1-R01-DROP');
  const edge=g.edges.find(e=>e.toNodeId===node.id),from=edge.fromNodeId;
  const entry=path(g,from,node.id,'loaded'),exit=path(g,node.id,from);
  assert.equal(entry.steps.at(-1).vehicleTravelDirection,'reverse');
  assert.equal(entry.steps.at(-1).vehicleSpeedMmPerSec,600);
  assert.equal(exit.steps[0].vehicleTravelDirection,'forward');
  assert.equal(exit.steps[0].vehicleSpeedMmPerSec,2500);
});

test('the same entry/exit rule covers equipment types and both western/eastern storage rows',()=>{
  const g=createDemoScenario().operationalTopology;
  for(const id of ['PZ-WRAP-IN','PZ-WRAP-OUT','PZ-M1-DROPOFF','PZ-OT1-PICKUP','WH-AL1-PICKUP',
    'WB1-R01-DROP','EB1-R01-DROP','WB1-WB2-FLEX-R01-DROP']){
    const edge=g.edges.find(e=>e.vehicleServiceApproach?.nodeId===id),from=edge.fromNodeId===id?edge.toNodeId:edge.fromNodeId;
    assert.ok(edge,id);
    for(const movement of ['empty','loaded']){
      const entry=path(g,from,id,movement),exit=path(g,id,from,movement);
      assert.equal(entry.steps.at(-1).vehicleTravelDirection,'reverse',id);
      assert.equal(entry.steps.at(-1).vehicleSpeedMmPerSec,600,id);
      assert.equal(exit.steps[0].vehicleTravelDirection,'forward',id);
      assert.equal(exit.steps[0].vehicleSpeedMmPerSec,movement==='loaded'?2100:2500,id);
    }
  }
});

test('entry speed follows actual traversal even when the stored edge points out of equipment',()=>{
  const s=createDemoScenario(),g=s.operationalTopology;
  const node=g.nodes.find(n=>n.id==='WB1-R01-DROP'),edge=g.edges.find(e=>e.toNodeId===node.id),from=edge.fromNodeId;
  [edge.fromNodeId,edge.toNodeId]=[edge.toNodeId,edge.fromNodeId];
  if(edge.displayPath)edge.displayPath.reverse();
  const configured=prepareVehicleTravel(s).operationalTopology;
  assert.equal(path(configured,from,node.id).steps.at(-1).traversal,'reverse');
  assert.equal(path(configured,from,node.id).steps.at(-1).vehicleTravelDirection,'reverse');
  assert.equal(path(configured,node.id,from).steps[0].vehicleTravelDirection,'forward');
});

test('split access paths and re-simulation preserve the service side on every segment',()=>{
  const s=createDemoScenario(),g=s.operationalTopology,node=g.nodes.find(n=>n.id==='WB1-R01-DROP');
  const edge=g.edges.find(e=>e.toNodeId===node.id),from=g.nodes.find(n=>n.id===edge.fromNodeId);
  edge.displayPath=[{x:from.x,y:from.y},{x:from.x+4,y:from.y},
    {x:from.x+4,y:node.y},{x:node.x,y:node.y}].filter((p,i,all)=>!i||p.x!==all[i-1].x||p.y!==all[i-1].y);
  const split=splitSyntheticDisplayTurns(g),prepared=prepareVehicleTravel({...s,operationalTopology:split});
  const inbound=path(prepared.operationalTopology,from.id,node.id),outbound=path(prepared.operationalTopology,node.id,from.id,'loaded');
  assert.ok(inbound.steps.length>1);
  assert.ok(inbound.steps.every(step=>step.vehicleTravelDirection==='reverse'&&step.vehicleSpeedMmPerSec===600));
  assert.ok(outbound.steps.every(step=>step.vehicleTravelDirection==='forward'&&step.vehicleSpeedMmPerSec===2100));
  assert.deepEqual(prepareVehicleTravel(prepared).operationalTopology,prepared.operationalTopology);
});

test('cruise direction settings and shutter passages do not overwrite service approach rules',()=>{
  const s=createDemoScenario();s.vehicleTravelProfile.defaultDirection.empty='reverse';
  const g=prepareVehicleTravel(s).operationalTopology,node=g.nodes.find(n=>n.interfaceId==='L1');
  const entry=path(g,node.accessNodeId,node.id),exit=path(g,node.id,node.accessNodeId);
  assert.equal(entry.steps[0].vehicleTravelDirection,'reverse');
  assert.equal(exit.steps[0].vehicleTravelDirection,'forward');
  const normal=createDemoScenario().operationalTopology;
  for(const edge of normal.edges.filter(e=>e.shutterId)){
    assert.equal(edge.vehicleServiceApproach,null);
    assert.equal(edge.vehicleTravelDirection.empty,'forward');
  }
  const html=renderVehicleTravelSettings(s);
  assert.match(html,/進入時に後進（フォーク先頭）/);assert.match(html,/下の方向設定は通路移動/);
});

test('legacy profiles without a service policy retain their original direction model',()=>{
  const s=createDemoScenario();delete s.vehicleTravelProfile.serviceApproachPolicy;
  delete s.vehicleTravelProfile.serviceApproachEvidence;
  const g=prepareVehicleTravel(s).operationalTopology,node=g.nodes.find(n=>n.interfaceId==='L1');
  assert.equal(path(g,node.accessNodeId,node.id).steps[0].vehicleTravelDirection,'forward');
  assert.equal(path(g,node.accessNodeId,node.id).steps[0].serviceMotionPhase,undefined);
});

test('an ambiguous access edge between two service endpoints is rejected rather than guessing an entry side',()=>{
  const s=createDemoScenario();
  s.operationalTopology={nodes:[{id:'A',type:'pickup'},{id:'B',type:'dropoff'}],
    edges:[{id:'SYN-AMBIGUOUS',fromNodeId:'A',toNodeId:'B'}],
    interfaceBindings:[{pattern:'SYN-A',nodeId:'A'},{pattern:'SYN-B',nodeId:'B'}]};
  assert.throws(()=>prepareVehicleTravel(s),/複数の荷役点.*進入区間の明示/);
});

test('actual 01/02 events enter with forks leading and withdraw without a spurious half-turn',()=>{
  const s=createDemoScenario();s.durationMin=40;s.lineIntervalsMin.fill(0);
  s.productStreams.forEach(stream=>{stream.enabled=false;});
  s.productionEvents=[{timeMs:1000,lineId:'L1',palletId:'SYN-SERVICE-APPROACH',sourceLineId:'L1',productType:'normal',loadType:'full'}];
  const run=simulate(s),entered=run.events.filter(e=>e.type==='SEGMENT_ENTERED'&&e.serviceNodeId);
  for(const id of ['PZ-L1-PICKUP','PZ-WRAP-IN','PZ-WRAP-OUT','WB1-R01-DROP']){
    const entry=entered.find(e=>e.serviceNodeId===id&&e.serviceMotionPhase==='service-entry');
    const exit=entered.find(e=>e.serviceNodeId===id&&e.serviceMotionPhase==='service-exit');
    assert.ok(entry,id+' entry');assert.ok(exit,id+' exit');
    assert.equal(entry.vehicleTravelDirection,'reverse');assert.equal(entry.vehicleSpeedMmPerSec,600);
    assert.equal(entry.forkHeadingDeg,entry.travelHeadingDeg);
    assert.equal(exit.vehicleTravelDirection,'forward');assert.equal(exit.headingDeg,exit.travelHeadingDeg);
    assert.ok(!run.events.some(e=>e.type==='TURN_STARTED'&&e.nodeId===id),id+' must not turn around inside the service stop');
  }
  assert.ok(run.final.tasks.some(t=>t.kind==='02'&&t.status==='completed'));
  assert.deepEqual(simulate(s).events,run.events);
  assert.deepEqual(simulate(run.scenario).events,run.events);
  const conditions=buildRunConditions(run),csv=conditionCsv(run),events=eventCsv(run,'SYN-SERVICE');
  assert.ok(conditions.some(r=>r.subkey==='serviceApproachPolicy'&&r.evidence==='user-requested-fork-leading-approach-model'));
  assert.match(csv,/vehicleTravelByTraversal/);assert.match(events,/serviceMotionPhase/);assert.match(events,/service-entry/);
});
