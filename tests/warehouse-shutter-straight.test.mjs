import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {syntheticMetricLayout} from '../examples/synthetic-metric-layout.mjs';
import {findOperationalPath,validateOperationalTopology} from '../src/map/operational-topology.mjs';
import {directionHeading} from '../src/core/motion-control.mjs';
import {simulate} from '../src/core/simulate.mjs';
import {initMap} from '../src/ui/map-view.mjs';

const nonlinear=structuredClone(syntheticMetricLayout);
nonlinear.id='synthetic-shutter-approach-bands';
nonlinear.xBands=[
  {atY:322,anchors:[[0,0],[1280,51200]]},
  {atY:475,anchors:[[0,0],[800,28000],[880,33200],[1280,51200]]},
  {atY:500,anchors:[[0,0],[845,33800],[880,35600],[1280,51200]]},
  {atY:970,anchors:[[0,0],[845,33800],[880,35600],[1280,51200]]}
]; // Invented nonlinear dimensions; never CAD measurements.

function onePallet(profile){
  const s=createDemoScenario('standard',{metricProfile:profile});
  s.durationMin=20;s.productionModel='legacy_external_pallets';
  s.productStreams.forEach(stream=>{stream.enabled=false;});s.lineIntervalsMin.fill(0);
  delete s.initialParking;
  s.agfs[0].currentNodeId='WH-E-TOP-WALL';s.agfs[0].headingDeg=270;
  s.agfs.slice(1).forEach(agf=>{agf.blocked=true;});
  s.productionEvents=[{timeMs:0,lineId:'L1',sourceLineId:'L1',palletId:'SYN-STRAIGHT-SH',
    productType:'normal',loadType:'full'}];
  return s;
}
const route=(g,from,to,movement='empty')=>findOperationalPath(g,from,to,{movement,taskType:'02'});

for(const [name,profile] of [['public mm',syntheticMetricLayout],['nonlinear mm',nonlinear]]){
  test(`${name}: both east-shutter lanes align with their warehouse main aisle through the complete approach`,()=>{
    const g=createDemoScenario('standard',{metricProfile:profile}).operationalTopology;
    validateOperationalTopology(g);
    const nodes=new Map(g.nodes.map(n=>[n.id,n]));
    for(const [ids,heading] of [
      [['WH-E-TOP-WALL','WH-E-INNER-L1','WH-GATE','WH-E-OUTER-L1','E08-TURN1'],270],
      [['WH-E-TURN-L2','WH-E-OUTER-L2','WH-E-GATE-L2','WH-E-INNER-L2','WH-E-TOP'],90]
    ]){
      const p=route(g,ids[0],ids.at(-1));assert.ok(p);
      assert.deepEqual([p.steps[0].fromNodeId,...p.steps.map(s=>s.toNodeId)],ids);
      for(const step of p.steps){
        const a=nodes.get(step.fromNodeId),b=nodes.get(step.toNodeId);
        assert.equal(a.x,b.x,'a straight two-wide opening must not introduce a lateral step');
        assert.equal(directionHeading(a,b),heading);
        assert.equal(step.displayPath[0].x,step.displayPath.at(-1).x);
      }
    }
  });

  test(`${name}: actual 01 empty travel and 02 loaded return pass the east shutter without stopped turns`,()=>{
    const s=onePallet(profile),r=simulate(s),g=r.scenario.operationalTopology;
    const outbound=route(g,'WH-E-TOP-WALL','E08-TURN1'),inbound=route(g,'WH-E-TURN-L2','WH-E-TOP','loaded');
    const straight=new Set(['WH-E-TOP-WALL','WH-E-INNER-L1','WH-GATE','WH-E-OUTER-L1',
      'WH-E-OUTER-L2','WH-E-GATE-L2','WH-E-INNER-L2']);
    assert.ok(r.events.some(e=>e.type==='TASK_COMPLETED'&&e.kind==='02'),'fixture completes the warehouse return');
    assert.ok(!r.events.some(e=>e.type==='TURN_STARTED'&&straight.has(e.nodeId)),
      'the engine must not charge turn time for a synthetic side step at the opening');
    for(const [p,movement,heading] of [[outbound,'empty',270],[inbound,'loaded',90]]){
      const entered=p.steps.map(step=>r.events.find(e=>e.type==='SEGMENT_ENTERED'&&e.edgeId===step.edgeId&&e.movement===movement));
      assert.ok(entered.every(Boolean),'the real task follows each straight approach segment');
      assert.ok(entered.every(e=>e.headingDeg===heading));
      const last=entered.at(-1),exit=r.events.find(e=>e.type==='SEGMENT_EXITED'&&e.agfId===last.agfId&&
        e.edgeId===last.edgeId&&e.timeMs>=last.timeMs);
      assert.equal(exit.timeMs-entered[0].timeMs,p.steps.reduce((sum,step)=>sum+step.durationMs,0),
        'elapsed approach time contains travel only, without hidden turn time');
    }
    assert.ok(r.events.some(e=>e.type==='TURN_STARTED'&&e.nodeId==='E08-TURN1'&&Math.abs(e.angleDeg)===90),
      'the real corner into the horizontal outdoor route still takes turn time');
    assert.equal(g.readiness.metricScaleVerified,false);assert.equal(g.readiness.physicalEtaAllowed,false);
  });

  test(`${name}: the rendered east opening covers both saved lane centers`,()=>{
    const r=simulate({...onePallet(profile),durationMin:.01,productionEvents:[]});
    const svg={innerHTML:'',setAttribute(){},addEventListener(){}};
    initMap({svg,onSelectAgf(){},onSelectBlock(){}}).render(r.final,'AGF1',{topology:r.scenario.operationalTopology});
    const tag=svg.innerHTML.match(/<rect\b[^>]*data-map-id="WH-E-GATE"[^>]*>/)?.[0];
    assert.ok(tag);
    const value=key=>Number(tag.match(new RegExp(`\\s${key}="([^"]*)"`))?.[1]);
    const left=value('x'),right=left+value('width');
    for(const id of ['WH-GATE','WH-E-GATE-L2']){
      const n=r.scenario.operationalTopology.nodes.find(n=>n.id===id);
      assert.ok(left<n.x&&n.x<right,`${id} passes through the displayed opening`);
    }
  });
}
