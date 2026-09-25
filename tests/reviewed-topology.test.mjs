import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSegmentChecklist,validateSegmentChecklist,importSegmentChecklist,
  setNodeReview,setSegmentReview,buildReviewedTopology,validateReviewedTopology,
  findReviewedTopologyPath
} from '../src/map/reviewed-topology.mjs';
import {
  createAnnotation,addNode,addRoute,moveNode,insertRoutePoint,classifyRoute,
  setNodeType,replaceRoutePoint
} from '../src/map/route-annotations.mjs';

// Entirely synthetic points, image identity and reviews, not facility data.
const hash='a'.repeat(64),box=[0,-100,200,100];
const scope={taskType:'01',phase:'loaded'};
const source=()=>{
  let draft=createAnnotation(hash,box);
  for(const [id,u,v,type] of [
    ['A',0.1,0.2,'pickup'],['B',0.5,0.2,'junction'],
    ['C',0.8,0.8,'dropoff'],['WAIT',0.5,0.4,'shutter_wait']
  ])draft=addNode(draft,{id,u,v,type});
  draft=addRoute(draft,{id:'R01',...scope,nodeIds:['A','B','C']});
  return addRoute(draft,{id:'G01',taskType:'guide',phase:'guide',nodeIds:['B','WAIT']});
};
const allowed={reviewState:'operator-confirmed',access:'allowed',direction:'forward',
  laneCount:1,simultaneousPassing:'unresolved',gate:'none'};
const approvePoints=(draft,review=createSegmentChecklist(draft),shared=true)=>{
  for(const entry of review.nodes)review=setNodeReview(draft,review,{
    ...entry,reviewState:'operator-confirmed',
    sharedConnection:entry.sharedConnection==='not-applicable'?'not-applicable':
      shared?'connected':'unresolved'
  });
  return review;
};
const approveSegments=(draft,review=createSegmentChecklist(draft))=>{
  for(const entry of review.segments)review=setSegmentReview(draft,review,{...entry,...allowed});
  return review;
};
const completeGraph=()=>{
  const draft=source();
  return buildReviewedTopology(draft,approveSegments(draft,approvePoints(draft)));
};
const legacyChecklist=draft=>{
  const {nodes,...review}=createSegmentChecklist(draft);
  return {...review,schemaVersion:'private-segment-review-v1',
    segments:review.segments.map(({forwardWaitNodeId,reverseWaitNodeId,...entry})=>
      ({...entry,waitNodeId:null}))};
};

test('segment approval alone never confirms endpoint positions',()=>{
  const draft=source();
  const review=setSegmentReview(draft,createSegmentChecklist(draft),
    {routeId:'R01',segmentIndex:0,...allowed});
  const graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,0);
  assert.equal(graph.nodes.length,0);
  assert.equal(graph.excluded[0].reason,'unreviewed-point');
});

test('controlled segment must wait at its entry endpoint, not an unrelated point',()=>{
  const draft=source();
  assert.throws(()=>setSegmentReview(draft,createSegmentChecklist(draft),
    {routeId:'R01',segmentIndex:0,...allowed,gate:'controlled',gateId:'SH01',
      forwardWaitNodeId:'WAIT'}),/entry endpoint/);
});

test('path finder rejects invalid serialized direction instead of treating it as both',()=>{
  const graph=completeGraph();
  graph.edges[0].direction='unresolved';
  assert.throws(()=>findReviewedTopologyPath(graph,'B','A',scope));
});

test('unreviewed segments, unused points and guides cannot enter topology',()=>{
  const draft=source(),review=approvePoints(draft);
  const graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,0);
  assert.equal(graph.nodes.length,0);
  assert.equal(graph.excluded.length,3);
  assert.equal(graph.excludedNodes.length,4);
  const approved=buildReviewedTopology(draft,approveSegments(draft,review));
  assert.equal(approved.edges.length,2);
  assert.deepEqual(approved.nodes.map(node=>node.id),['A','B','C']);
  assert.equal(approved.excluded[0].reason,'unassigned-guide');
  for(const flag of ['metricScaleVerified','physicalEtaAllowed','trafficReady','operationalRoutingReady'])
    assert.equal(approved[flag],false);
  assert.equal(draft.approvalStatus,'draft-only');
});

test('shared node positions and route connectivity require separate declarations',()=>{
  const draft=source();
  let review=approveSegments(draft,approvePoints(draft,undefined,false));
  let graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,0);
  assert.equal(graph.excluded[0].reason,'unresolved-shared-connection');
  review=setNodeReview(draft,review,{nodeId:'B',reviewState:'operator-confirmed',sharedConnection:'connected'});
  graph=buildReviewedTopology(draft,review);
  assert.deepEqual(findReviewedTopologyPath(graph,'A','C',scope),{
    kind:'reviewed-topology-only',nodeIds:['A','B','C'],edgeIds:['R01:0','R01:1'],
    measuredDistanceMm:null,etaMs:null,trafficAuthorized:false
  });
  assert.equal(findReviewedTopologyPath(graph,'C','A',scope),null);
  const revoked=setNodeReview(draft,review,{nodeId:'B',reviewState:'unresolved',sharedConnection:'unresolved'});
  assert.equal(buildReviewedTopology(draft,revoked).edges.length,0);
});

test('coincident points do not connect routes without explicit ID replacement and re-review',()=>{
  let draft=source();
  draft=addNode(draft,{id:'D',type:'junction',u:0.5,v:0.2});
  draft=addNode(draft,{id:'E',type:'dropoff',u:0.9,v:0.2});
  draft=addRoute(draft,{id:'R02',...scope,nodeIds:['D','E']});
  const review=approveSegments(draft,approvePoints(draft));
  assert.equal(findReviewedTopologyPath(buildReviewedTopology(draft,review),'A','E',scope),null);
  const joined=replaceRoutePoint(draft,{routeId:'R02',nodeIndex:0,nodeId:'B'});
  assert.throws(()=>buildReviewedTopology(joined,review),/stale review/);
  const graph=buildReviewedTopology(joined,approveSegments(joined,approvePoints(joined)));
  assert.deepEqual(findReviewedTopologyPath(graph,'A','E',scope).nodeIds,['A','B','E']);
  assert.deepEqual(draft.routes.at(-1).nodeIds,['D','E']);
});

test('task and phase scope are enforced even at the same endpoint',()=>{
  const graph=completeGraph();
  for(const query of [{taskType:'05',phase:'loaded'},{taskType:'01',phase:'empty'},
    {taskType:'charge',phase:'charge'}]) {
    assert.equal(findReviewedTopologyPath(graph,'A','C',query),null);
    assert.equal(findReviewedTopologyPath(graph,'A','A',query),null);
  }
  for(const query of [undefined,{}, {taskType:'unknown',phase:'empty'},
    {taskType:'charge',phase:'loaded'},{taskType:'01',phase:'charge'},
    {taskType:'guide',phase:'guide'}])
    assert.throws(()=>findReviewedTopologyPath(graph,'A','A',query),/explicit transport and phase/);
});

test('each allowed gate direction needs its own reviewed entry wait point',()=>{
  let draft=createAnnotation(hash,box);
  for(const [id,u] of [['LEFT',0.2],['RIGHT',0.8],['ORPHAN',0.5]])
    draft=addNode(draft,{id,type:'shutter_wait',u,v:0.5});
  draft=addRoute(draft,{id:'GATE',...scope,nodeIds:['LEFT','RIGHT']});
  const base=approvePoints(draft);
  const gate={routeId:'GATE',segmentIndex:0,...allowed,direction:'both',
    gate:'controlled',gateId:'SYN_GATE',forwardWaitNodeId:'LEFT',reverseWaitNodeId:'RIGHT'};
  for(const bad of [
    {forwardWaitNodeId:null},{reverseWaitNodeId:null},{forwardWaitNodeId:'ORPHAN'},
    {reverseWaitNodeId:'LEFT'},{forwardWaitNodeId:'RIGHT'},
    {direction:'forward'},{direction:'reverse'}, {gate:'none'}, {gateId:null}
  ])assert.throws(()=>setSegmentReview(draft,base,{...gate,...bad}));
  const review=setSegmentReview(draft,base,gate);
  const graph=buildReviewedTopology(draft,review);
  assert.deepEqual(findReviewedTopologyPath(graph,'LEFT','RIGHT',scope).edgeIds,['GATE:0']);
  assert.deepEqual(findReviewedTopologyPath(graph,'RIGHT','LEFT',scope).edgeIds,['GATE:0']);
  assert.equal(graph.edges[0].laneCount,1);
  assert.equal(graph.edges[0].simultaneousPassing,'unresolved');
  const reverse=setSegmentReview(draft,base,{...gate,direction:'reverse',forwardWaitNodeId:null});
  const reverseGraph=buildReviewedTopology(draft,reverse);
  assert.equal(findReviewedTopologyPath(reverseGraph,'LEFT','RIGHT',scope),null);
  assert.ok(findReviewedTopologyPath(reverseGraph,'RIGHT','LEFT',scope));
  const wrongType=setNodeType(draft,'LEFT','waypoint');
  assert.throws(()=>setSegmentReview(wrongType,createSegmentChecklist(wrongType),gate),/entry endpoint/);
});

test('forbidden and unresolved segments retain their status, never traversal attributes',()=>{
  const draft=source(),review=approvePoints(draft);
  const forbidden=setSegmentReview(draft,review,{routeId:'R01',segmentIndex:0,
    reviewState:'operator-confirmed',access:'forbidden'});
  assert.equal(buildReviewedTopology(draft,forbidden).excluded[0].reason,'forbidden');
  assert.throws(()=>setSegmentReview(draft,review,{routeId:'R01',segmentIndex:0,
    reviewState:'operator-confirmed',access:'unresolved',direction:'both'}),/cannot gain traversal/);
  assert.throws(()=>setSegmentReview(draft,review,{routeId:'R01',segmentIndex:0,
    ...allowed,reviewState:'unresolved'}),/unreviewed segment/);
});

test('geometry, role, classification and route membership changes invalidate every review',()=>{
  const draft=source(),review=approveSegments(draft,approvePoints(draft));
  for(const changed of [
    moveNode(draft,'B',0.6,0.2),
    insertRoutePoint(draft,{routeId:'R01',segmentIndex:0,id:'NEW',u:0.3,v:0.2}),
    classifyRoute(draft,{routeId:'R01',taskType:'05',phase:'loaded'}),
    setNodeType(draft,'A','stop'),
    replaceRoutePoint(draft,{routeId:'G01',nodeIndex:0,nodeId:'A'})
  ])assert.throws(()=>validateSegmentChecklist(changed,review),/stale review/);
  assert.throws(()=>validateSegmentChecklist(draft,{...review,backgroundSha256:'b'.repeat(64)}),/different CAD/);
});

test('node and segment review lists reject duplicate, missing and inconsistent declarations',()=>{
  const draft=source(),base=createSegmentChecklist(draft);
  for(const edited of [
    {...base,nodes:base.nodes.slice(1)},
    {...base,nodes:[base.nodes[0],base.nodes[0],...base.nodes.slice(2)]},
    {...base,segments:base.segments.slice(1)},
    {...base,segments:[base.segments[0],base.segments[0],base.segments[2]]}
  ])assert.throws(()=>validateSegmentChecklist(draft,edited));
  assert.throws(()=>setNodeReview(draft,base,{nodeId:'B',reviewState:'unresolved',sharedConnection:'connected'}));
  assert.throws(()=>setNodeReview(draft,base,{nodeId:'A',reviewState:'operator-confirmed',sharedConnection:'connected'}));
  assert.throws(()=>setNodeReview(draft,base,{nodeId:'missing',reviewState:'operator-confirmed',sharedConnection:'not-applicable'}));
  assert.throws(()=>setSegmentReview(draft,base,{routeId:'R01',segmentIndex:0,...allowed,laneCount:0}));
});

test('v1 migration preserves valid segment declarations but never invents point confirmation',()=>{
  const draft=source(),old=legacyChecklist(draft);
  old.segments[0]={...old.segments[0],...allowed};
  old.segments[1]={...old.segments[1],...allowed,gate:'controlled',gateId:'SH01',waitNodeId:'WAIT'};
  const result=importSegmentChecklist(draft,old);
  assert.equal(result.migrated,true);
  assert.deepEqual(result.resetSegmentIds,['R01:1']);
  assert.equal(result.checklist.segments[0].access,'allowed');
  assert.equal(result.checklist.segments[1].access,'unresolved');
  assert.ok(result.checklist.nodes.every(node=>node.reviewState==='unresolved'));
  assert.equal(buildReviewedTopology(draft,result.checklist).edges.length,0);
  assert.deepEqual(importSegmentChecklist(draft,result.checklist),{
    checklist:result.checklist,migrated:false,resetSegmentIds:[]
  });
  assert.throws(()=>importSegmentChecklist(moveNode(draft,'B',0.6,0.2),old),/stale review/);
  assert.throws(()=>validateSegmentChecklist(draft,old),/schema mismatch/);
  assert.equal(old.segments[1].access,'allowed');
});

test('v1 migration retains correctly placed one-way waits and resets ambiguous two-way gates',()=>{
  let draft=setNodeType(source(),'A','shutter_wait');
  draft=setNodeType(draft,'B','shutter_wait');
  for(const [direction,waitNodeId,field] of [
    ['forward','A','forwardWaitNodeId'],['reverse','B','reverseWaitNodeId']
  ]) {
    const old=legacyChecklist(draft);
    old.segments[0]={...old.segments[0],...allowed,direction,gate:'controlled',gateId:'SH01',waitNodeId};
    const result=importSegmentChecklist(draft,old);
    assert.deepEqual(result.resetSegmentIds,[]);
    assert.equal(result.checklist.segments[0][field],waitNodeId);
    old.segments[0].direction='both';
    assert.deepEqual(importSegmentChecklist(draft,old).resetSegmentIds,['R01:0']);
  }
});

test('serialized topology rejects incomplete approvals and malformed attributes',()=>{
  const original=completeGraph();
  for(const mutate of [
    g=>{g.metricScaleVerified=true;},g=>{g.physicalEtaAllowed=true;},
    g=>{g.schemaVersion='reviewed-topology-v1';},
    g=>{g.nodes[0].reviewState='unresolved';},g=>{g.nodes[1].sharedConnection='unresolved';},
    g=>{g.nodes[0].routeIds=['FAKE'];},g=>{g.nodes[0].type='equipment';},
    g=>{g.nodes[0].u=Infinity;},g=>{g.nodes.push(g.nodes[0]);},
    g=>{g.edges[0].direction='sideways';},g=>{g.edges[0].access='forbidden';},
    g=>{g.edges[0].reviewState='unresolved';},g=>{g.edges[0].fromId='MISSING';},
    g=>{g.edges[0].toId=g.edges[0].fromId;},g=>{g.edges[0].laneCount=0;},
    g=>{g.edges[0].taskType='guide';},g=>{g.edges[0].phase='charge';},
    g=>{g.edges[0].gate='controlled';},g=>{g.edges.push(g.edges[0]);},
    g=>{g.edges[0].segmentIndex='0';}
  ]) {
    const graph=structuredClone(original);mutate(graph);
    assert.throws(()=>findReviewedTopologyPath(graph,'A','C',scope));
  }
  const validated=validateReviewedTopology(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(validated,original);
  validated.nodes[0].u=0;
  assert.equal(original.nodes[0].u,0.1);
});

test('equal-hop path ties are independent of serialized edge order',()=>{
  let draft=source();
  draft=addNode(draft,{id:'D',type:'turn',u:0.2,v:0.8});
  draft=addRoute(draft,{id:'R00',...scope,nodeIds:['A','D','C']});
  const review=approveSegments(draft,approvePoints(draft));
  const graph=buildReviewedTopology(draft,review);
  const reversed={...graph,nodes:[...graph.nodes].reverse(),edges:[...graph.edges].reverse()};
  const result=findReviewedTopologyPath(graph,'A','C',scope);
  assert.deepEqual(result.edgeIds,['R00:0','R00:1']);
  assert.deepEqual(findReviewedTopologyPath(reversed,'A','C',scope),result);
  assert.deepEqual(buildReviewedTopology(draft,review),graph);
});
