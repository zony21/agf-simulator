import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSegmentChecklist,validateSegmentChecklist,setSegmentReview,
  buildReviewedTopology,findReviewedTopologyPath
} from '../src/map/reviewed-topology.mjs';
import {
  createAnnotation,addNode,addRoute,moveNode,insertRoutePoint,classifyRoute
} from '../src/map/route-annotations.mjs';

const hash='a'.repeat(64),box=[0,-100,200,100];
const source=()=>{
  let note=createAnnotation(hash,box);
  for(const [id,u,v,type] of [
    ['A',0.1,0.2,'pickup'],['B',0.5,0.2,'junction'],
    ['C',0.8,0.8,'dropoff'],['WAIT',0.5,0.4,'shutter_wait']
  ])note=addNode(note,{id,u,v,type});
  note=addRoute(note,{id:'R01',taskType:'01',phase:'loaded',nodeIds:['A','B','C']});
  note=addRoute(note,{id:'G01',taskType:'guide',phase:'guide',nodeIds:['B','WAIT']});
  return note;
};
const allowed={
  reviewState:'operator-confirmed',access:'allowed',direction:'forward',
  laneCount:1,simultaneousPassing:'unresolved',
  gate:'none',gateId:null,waitNodeId:null
};

test('unreviewed lines and guides cannot enter a traversable topology',()=>{
  const draft=source(),review=createSegmentChecklist(draft);
  assert.equal(review.segments.length,3);
  const graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,0);
  assert.equal(graph.excluded.length,3);
  assert.equal(graph.physicalEtaAllowed,false);
  assert.equal(graph.trafficReady,false);
  assert.equal(graph.operationalRoutingReady,false);
  assert.equal(findReviewedTopologyPath(graph,'A','C'),null);
  assert.equal(draft.approvalStatus,'draft-only');
});

test('only individually operator-reviewed directed segments can form a topological path',()=>{
  const draft=source();
  let review=createSegmentChecklist(draft);
  review=setSegmentReview(draft,review,{routeId:'R01',segmentIndex:0,...allowed});
  let graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,1);
  assert.equal(findReviewedTopologyPath(graph,'A','C'),null);
  assert.equal(findReviewedTopologyPath(graph,'B','A'),null);
  assert.deepEqual(findReviewedTopologyPath(graph,'A','B'),{
    kind:'reviewed-topology-only',nodeIds:['A','B'],edgeIds:['R01:0'],
    measuredDistanceMm:null,etaMs:null,trafficAuthorized:false
  });
  review=setSegmentReview(draft,review,{routeId:'R01',segmentIndex:1,
    ...allowed,direction:'both',laneCount:2,
    simultaneousPassing:'yes',gate:'controlled',gateId:'SH01',waitNodeId:'WAIT'});
  graph=buildReviewedTopology(draft,review);
  assert.deepEqual(findReviewedTopologyPath(graph,'A','C').edgeIds,['R01:0','R01:1']);
  assert.equal(findReviewedTopologyPath(graph,'C','A'),null);
  assert.deepEqual(findReviewedTopologyPath(graph,'C','B').edgeIds,['R01:1']);
  assert.equal(graph.edges[1].laneCount,2);
  assert.equal(graph.edges[1].gateId,'SH01');
  assert.equal(graph.physicalEtaAllowed,false);
});

test('a guide stays unassigned even with an explicit review',()=>{
  const draft=source();
  const review=setSegmentReview(draft,createSegmentChecklist(draft),
    {routeId:'G01',segmentIndex:0,...allowed});
  const graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,0);
  assert.equal(graph.excluded[2].reason,'unassigned-guide');
  const classified=classifyRoute(draft,{routeId:'G01',taskType:'charge',phase:'charge'});
  assert.throws(()=>buildReviewedTopology(classified,review),/stale review/);
});

test('forbidden edge is excluded; unresolved access cannot claim a direction',()=>{
  const draft=source();
  const review=setSegmentReview(draft,createSegmentChecklist(draft),
    {routeId:'R01',segmentIndex:0,reviewState:'operator-confirmed',access:'forbidden'});
  const graph=buildReviewedTopology(draft,review);
  assert.equal(graph.edges.length,0);
  assert.equal(graph.excluded[0].reason,'forbidden');
  assert.throws(()=>setSegmentReview(draft,review,{routeId:'R01',segmentIndex:1,
    reviewState:'operator-confirmed',access:'unresolved',direction:'both'}),
  /cannot gain traversal/);
});

test('editing a point, splitting a line or changing a task invalidates all old segment reviews',()=>{
  const draft=source(),review=createSegmentChecklist(draft);
  assert.throws(()=>validateSegmentChecklist(moveNode(draft,'B',0.6,0.2),review),
    /stale review/);
  assert.throws(()=>validateSegmentChecklist(insertRoutePoint(draft,{
    routeId:'R01',segmentIndex:0,id:'NEW',u:0.3,v:0.2}),review),/stale review/);
  assert.throws(()=>validateSegmentChecklist(classifyRoute(draft,{
    routeId:'R01',taskType:'05',phase:'loaded'}),review),/stale review/);
  assert.throws(()=>validateSegmentChecklist(draft,{...review,backgroundSha256:'b'.repeat(64)}),
    /different CAD preview/);
});

test('reject forged or inconsistent review records without silently filling fields',()=>{
  const draft=source(),base=createSegmentChecklist(draft);
  assert.throws(()=>validateSegmentChecklist(draft,{
    ...base,segments:base.segments.slice(0,2)
  }),/every segment/);
  assert.throws(()=>validateSegmentChecklist(draft,{
    ...base,segments:[base.segments[0],base.segments[0],base.segments[2]]
  }),/duplicate or mismatched/);
  assert.throws(()=>setSegmentReview(draft,base,{routeId:'R01',segmentIndex:0,
    ...allowed,gate:'controlled'}),/requires ID/);
  assert.throws(()=>setSegmentReview(draft,base,{routeId:'R01',segmentIndex:0,
    ...allowed,gate:'controlled',gateId:'SH01',waitNodeId:'B'}),/shutter wait point/);
  assert.throws(()=>setSegmentReview(draft,base,{routeId:'R01',segmentIndex:0,
    ...allowed,laneCount:0}),/lane count/);
  assert.throws(()=>setSegmentReview(draft,base,{routeId:'R01',segmentIndex:0,
    ...allowed,reviewState:'unresolved'}),/unreviewed segment/);
  assert.throws(()=>setSegmentReview(draft,base,{routeId:'UNKNOWN',segmentIndex:0,
    ...allowed}),/unknown segment/);
});

test('review functions are pure and do not modify draft or checklist in place',()=>{
  const draft=source(),initial=createSegmentChecklist(draft);
  const edited=setSegmentReview(draft,initial,{routeId:'R01',segmentIndex:0,...allowed});
  assert.equal(initial.segments[0].access,'unresolved');
  assert.equal(edited.segments[0].access,'allowed');
  assert.equal(draft.routes[0].status,'draft');
  assert.deepEqual(validateSegmentChecklist(draft,JSON.parse(JSON.stringify(edited))),edited);
  assert.throws(()=>findReviewedTopologyPath(buildReviewedTopology(draft,initial),'missing','A'),
    /unknown endpoint/);
});
