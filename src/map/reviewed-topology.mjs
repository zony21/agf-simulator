/**
 * Private review overlay for a PRIVATE draft annotation. Generic public-safe
 * contract only: no site coordinates, geometry or operational timing here.
 *
 * A checked box is an operator declaration, not a safety certification.
 * This module never upgrades route-annotations-v1 or enables physical ETA.
 */
import {validateAnnotation} from './route-annotations.mjs';

const fail = message => {throw new Error(message);};
const check = (yes,message) => {if(!yes) fail(message);};
const choices = (value,allowed,name) => check(allowed.includes(value),'invalid '+name);
const idPattern = /^[A-Za-z0-9_-]{1,32}$/;
const reviewedStates = ['unresolved','operator-confirmed'];
const accessValues = ['unresolved','allowed','forbidden'];
const directions = ['unresolved','forward','reverse','both'];
const passingValues = ['unresolved','yes','no-alternating'];
const gateValues = ['unresolved','none','controlled'];

function normalized(input) {
  check(input && typeof input==='object' && !Array.isArray(input),'annotation required');
  return validateAnnotation(input,input.backgroundSha256,input.cadViewBox);
}
function snapshot(annotation) {
  return {
    nodes:annotation.nodes.map(({id,type,u,v})=>({id,type,u,v})),
    routes:annotation.routes.map(({id,taskType,phase,nodeIds})=>
      ({id,taskType,phase,nodeIds:[...nodeIds]}))
  };
}
function segmentsFor(annotation) {
  return annotation.routes.flatMap(route=>route.nodeIds.slice(0,-1).map((fromId,index)=>({
    routeId:route.id,segmentIndex:index,fromId,toId:route.nodeIds[index+1],
    reviewState:'unresolved',access:'unresolved',direction:'unresolved',
    laneCount:null,simultaneousPassing:'unresolved',gate:'unresolved',
    gateId:null,waitNodeId:null
  })));
}
export function createSegmentChecklist(annotation) {
  const draft=normalized(annotation);
  return {
    schemaVersion:'private-segment-review-v1',
    backgroundSha256:draft.backgroundSha256,
    cadViewBox:draft.cadViewBox,
    sourceSnapshot:snapshot(draft),
    segments:segmentsFor(draft)
  };
}

/**
 * A segment review is bound to the full route ordering, point coordinates and
 * type/classification. Any subsequent drag, insertion or classification makes
 * the old checklist stale and it must be reviewed again.
 */
export function validateSegmentChecklist(annotation,input) {
  const expected=createSegmentChecklist(annotation);
  check(input && typeof input==='object' && !Array.isArray(input) &&
    input.schemaVersion===expected.schemaVersion,'review schema mismatch');
  check(input.backgroundSha256===expected.backgroundSha256 &&
    JSON.stringify(input.cadViewBox)===JSON.stringify(expected.cadViewBox),
    'review belongs to a different CAD preview');
  check(JSON.stringify(input.sourceSnapshot)===JSON.stringify(expected.sourceSnapshot),
    'stale review: route or point geometry changed');
  check(Array.isArray(input.segments) && input.segments.length===expected.segments.length,
    'review must list every segment exactly once');
  const sourceNodes=new Map(expected.sourceSnapshot.nodes.map(n=>[n.id,n]));
  const seen=new Set();
  for(const entry of input.segments) {
    check(entry && typeof entry==='object' && !Array.isArray(entry),'invalid review entry');
    const key=entry.routeId+':'+entry.segmentIndex;
    const reference=expected.segments.find(s=>
      s.routeId===entry.routeId && s.segmentIndex===entry.segmentIndex);
    check(reference && !seen.has(key) && entry.fromId===reference.fromId &&
      entry.toId===reference.toId,'duplicate or mismatched segment review');
    seen.add(key);
    choices(entry.reviewState,reviewedStates,'review state');
    choices(entry.access,accessValues,'segment access');
    choices(entry.direction,directions,'segment direction');
    choices(entry.simultaneousPassing,passingValues,'passing');
    choices(entry.gate,gateValues,'gate');
    check(entry.laneCount===null||
      (Number.isInteger(entry.laneCount)&&entry.laneCount>0&&entry.laneCount<=8),
      'invalid lane count');
    check(entry.gateId===null||
      (typeof entry.gateId==='string'&&idPattern.test(entry.gateId)),'invalid gate ID');
    check(entry.waitNodeId===null||
      (typeof entry.waitNodeId==='string'&&idPattern.test(entry.waitNodeId)),
      'invalid shutter wait point');
    if(entry.reviewState==='unresolved') {
      check(entry.access==='unresolved' && entry.direction==='unresolved' &&
        entry.laneCount===null && entry.simultaneousPassing==='unresolved' &&
        entry.gate==='unresolved' && entry.gateId===null &&
        entry.waitNodeId===null,'unreviewed segment cannot claim verified attributes');
    } else if(entry.access==='allowed') {
      check(entry.direction!=='unresolved' && entry.laneCount!==null &&
        entry.gate!=='unresolved','allowed segment requires direction, lanes and gate review');
      if(entry.gate==='controlled') {
        check(entry.gateId!==null && entry.waitNodeId!==null &&
          sourceNodes.get(entry.waitNodeId)?.type==='shutter_wait',
          'controlled gate requires ID and a declared shutter wait point');
      } else check(entry.gateId===null && entry.waitNodeId===null,
        'no-gate segment cannot specify a gate');
    } else {
      check(entry.direction==='unresolved' && entry.laneCount===null &&
        entry.simultaneousPassing==='unresolved' && entry.gate==='unresolved' &&
        entry.gateId===null && entry.waitNodeId===null,
        'forbidden/unresolved segment cannot gain traversal attributes');
    }
    if(entry.gate!=='controlled')
      check(entry.gateId===null && entry.waitNodeId===null,
        'gate details require controlled gate');
  }
  return structuredClone(input);
}

/** Explicit operator input; defaults cannot silently become allowed. */
export function setSegmentReview(annotation,checklist,{routeId,segmentIndex,
  reviewState,access,direction='unresolved',laneCount=null,
  simultaneousPassing='unresolved',gate='unresolved',gateId=null,waitNodeId=null}) {
  const source=validateSegmentChecklist(annotation,checklist);
  const index=source.segments.findIndex(item=>
    item.routeId===routeId && item.segmentIndex===segmentIndex);
  check(index!==-1,'unknown segment');
  const next=structuredClone(source);
  next.segments[index]={...next.segments[index],reviewState,access,direction,
    laneCount,simultaneousPassing,gate,gateId,waitNodeId};
  return validateSegmentChecklist(annotation,next);
}

/**
 * A reviewed TOPOLOGY, not a physical AGF routing/safety model. Unassigned
 * 'guide' lines are never exported as traversable edges, even if marked allowed.
 * No distance, travel time, traffic clearance or real-machine authorization.
 */
export function buildReviewedTopology(annotation,checklist) {
  const draft=normalized(annotation);
  const reviews=validateSegmentChecklist(draft,checklist);
  const routes=new Map(draft.routes.map(r=>[r.id,r]));
  const edges=[],excluded=[];
  for(const segment of reviews.segments) {
    const route=routes.get(segment.routeId);
    if(segment.reviewState!=='operator-confirmed' ||
       segment.access!=='allowed' || route.taskType==='guide') {
      excluded.push({routeId:segment.routeId,segmentIndex:segment.segmentIndex,
        reason:route.taskType==='guide'?'unassigned-guide':segment.access});
      continue;
    }
    edges.push({
      id:segment.routeId+':'+segment.segmentIndex,
      routeId:segment.routeId,taskType:route.taskType,phase:route.phase,
      fromId:segment.fromId,toId:segment.toId,
      direction:segment.direction,laneCount:segment.laneCount,
      simultaneousPassing:segment.simultaneousPassing,
      gate:segment.gate,gateId:segment.gateId,waitNodeId:segment.waitNodeId,
      access:'allowed',reviewState:'operator-confirmed'
    });
  }
  return {
    schemaVersion:'reviewed-topology-v1',
    backgroundSha256:draft.backgroundSha256,cadViewBox:draft.cadViewBox,
    nodes:structuredClone(draft.nodes.map(({id,type,u,v})=>({id,type,u,v}))),
    edges,excluded,
    kind:'reviewed-topology-only',metricScaleVerified:false,
    physicalEtaAllowed:false,trafficReady:false,operationalRoutingReady:false
  };
}

/**
 * Directed BFS for contract tests and future planning. Still no traffic
 * reservation, signal state, geometry clearance, measured distance or ETA.
 */
export function findReviewedTopologyPath(graph,fromId,toId,{taskType,phase}={}) {
  check(graph?.schemaVersion==='reviewed-topology-v1' &&
    graph.kind==='reviewed-topology-only' && graph.physicalEtaAllowed===false &&
    graph.trafficReady===false && graph.operationalRoutingReady===false,
    'reviewed topology required');
  check(typeof taskType==='string' && typeof phase==='string' &&
    taskType!=='guide' && phase!=='guide',
    'explicit transport and phase scope required');
  const nodes=new Set(graph.nodes.map(n=>n.id));
  check(nodes.has(fromId)&&nodes.has(toId),'unknown endpoint');
  const next=new Map([...nodes].map(id=>[id,[]]));
  for(const edge of graph.edges) {
    if(edge.taskType!==taskType || edge.phase!==phase)continue;
    if(edge.direction!=='reverse')next.get(edge.fromId).push({to:edge.toId,id:edge.id,gate:edge.gate});
    if(edge.direction!=='forward')next.get(edge.toId).push({to:edge.fromId,id:edge.id,gate:edge.gate});
  }
  const queue=[fromId],seen=new Map([[fromId,null]]);
  for(let at=0;at<queue.length;at++) {
    const current=queue[at];
    if(current===toId) {
      const path=[],edgeIds=[];
      for(let node=current;seen.get(node)!==null;) {
        path.unshift(node);
        const previous=seen.get(node);
        edgeIds.unshift(previous.id);node=previous.from;
      }
      path.unshift(fromId);
      return {kind:'reviewed-topology-only',nodeIds:path,edgeIds,
        measuredDistanceMm:null,etaMs:null,trafficAuthorized:false};
    }
    for(const item of next.get(current))if(!seen.has(item.to)){
      seen.set(item.to,{from:current,id:item.id});queue.push(item.to);
    }
  }
  return null;
}
