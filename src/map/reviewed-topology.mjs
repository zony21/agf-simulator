/**
 * Local review declarations, not physical routing or safety certification.
 * Draft geometry is never promoted; coordinates and review exports stay private.
 */
import {validateAnnotation,createAnnotation,addNode,TASK_TYPES} from './route-annotations.mjs';

const check=(yes,message)=>{if(!yes)throw new Error(message);};
const choices=(value,allowed,name)=>check(allowed.includes(value),'invalid '+name);
const idPattern=/^[A-Za-z0-9_-]{1,32}$/;
const isId=value=>typeof value==='string'&&idPattern.test(value);
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const reviewedStates=['unresolved','operator-confirmed'];
const keyOf=entry=>entry.routeId+':'+entry.segmentIndex;
const compare=(a,b)=>a<b?-1:a>b?1:0;

function normalized(input) {
  check(isObject(input),'annotation required');
  return validateAnnotation(input,input.backgroundSha256,input.cadViewBox);
}
function snapshot(annotation) {
  return {
    nodes:annotation.nodes.map(({id,type,u,v})=>({id,type,u,v})),
    routes:annotation.routes.map(({id,taskType,phase,nodeIds})=>
      ({id,taskType,phase,nodeIds:[...nodeIds]}))
  };
}
function routeIdsFor(annotation,nodeId) {
  return annotation.routes.filter(route=>route.nodeIds.includes(nodeId))
    .map(route=>route.id).sort(compare);
}
function segmentsFor(annotation) {
  return annotation.routes.flatMap(route=>route.nodeIds.slice(0,-1).map((fromId,index)=>({
    routeId:route.id,segmentIndex:index,fromId,toId:route.nodeIds[index+1],
    reviewState:'unresolved',access:'unresolved',direction:'unresolved',
    laneCount:null,simultaneousPassing:'unresolved',gate:'unresolved',
    gateId:null,forwardWaitNodeId:null,reverseWaitNodeId:null
  })));
}
export function createSegmentChecklist(annotation) {
  const draft=normalized(annotation);
  return {
    schemaVersion:'private-segment-review-v2',
    backgroundSha256:draft.backgroundSha256,cadViewBox:draft.cadViewBox,
    sourceSnapshot:snapshot(draft),
    nodes:draft.nodes.map(node=>({nodeId:node.id,reviewState:'unresolved',
      sharedConnection:routeIdsFor(draft,node.id).length>1?'unresolved':'not-applicable'})),
    segments:segmentsFor(draft)
  };
}
function checkNodeReview(entry,routeIds) {
  choices(entry.reviewState,reviewedStates,'point review state');
  if(routeIds.length>1) {
    choices(entry.sharedConnection,['unresolved','connected'],'shared connection');
    check(entry.reviewState==='operator-confirmed'||entry.sharedConnection==='unresolved',
      'unreviewed point cannot confirm a shared connection');
  } else check(entry.sharedConnection==='not-applicable','point is not shared between routes');
}
function checkGate(entry,nodes) {
  for(const field of ['gateId','forwardWaitNodeId','reverseWaitNodeId'])
    check(entry[field]===null||isId(entry[field]),'invalid '+field);
  if(entry.gate!=='controlled') {
    check(entry.gateId===null&&entry.forwardWaitNodeId===null&&entry.reverseWaitNodeId===null,
      'gate details require controlled gate');
    return;
  }
  check(isId(entry.gateId),'controlled gate requires ID');
  for(const [direction,field,endpoint] of [
    ['forward','forwardWaitNodeId','fromId'],['reverse','reverseWaitNodeId','toId']
  ]) {
    if(entry.direction===direction||entry.direction==='both') {
      check(entry[field]===entry[endpoint]&&nodes.get(entry[field])?.type==='shutter_wait',
        direction+' gate requires a shutter wait point at its entry endpoint');
    } else check(entry[field]===null,'wait point supplied for a forbidden direction');
  }
}
function checkSegment(entry,nodes,legacy=false) {
  choices(entry.reviewState,reviewedStates,'review state');
  choices(entry.access,['unresolved','allowed','forbidden'],'segment access');
  choices(entry.direction,['unresolved','forward','reverse','both'],'segment direction');
  choices(entry.simultaneousPassing,['unresolved','yes','no-alternating'],'passing');
  choices(entry.gate,['unresolved','none','controlled'],'gate');
  check(entry.laneCount===null||(Number.isInteger(entry.laneCount)&&
    entry.laneCount>0&&entry.laneCount<=8),'invalid lane count');
  if(entry.reviewState==='unresolved')
    check(entry.access==='unresolved','unreviewed segment cannot claim verified attributes');
  if(entry.access==='allowed') {
    check(entry.direction!=='unresolved'&&entry.laneCount!==null&&entry.gate!=='unresolved',
      'allowed segment requires direction, lanes and gate review');
  } else check(entry.direction==='unresolved'&&entry.laneCount===null&&
    entry.simultaneousPassing==='unresolved'&&entry.gate==='unresolved',
    'forbidden/unresolved segment cannot gain traversal attributes');
  if(legacy) {
    check(entry.gateId===null||isId(entry.gateId),'invalid gate ID');
    check(entry.waitNodeId===null||isId(entry.waitNodeId),'invalid shutter wait point');
    if(entry.gate==='controlled')
      check(entry.gateId!==null&&nodes.get(entry.waitNodeId)?.type==='shutter_wait',
        'controlled gate requires ID and a declared shutter wait point');
    else check(entry.gateId===null&&entry.waitNodeId===null,'gate details require controlled gate');
  } else checkGate(entry,nodes);
}
function validateChecklist(annotation,input,legacy=false) {
  const expected=createSegmentChecklist(annotation);
  check(isObject(input)&&input.schemaVersion===
    (legacy?'private-segment-review-v1':expected.schemaVersion),'review schema mismatch');
  check(input.backgroundSha256===expected.backgroundSha256&&
    JSON.stringify(input.cadViewBox)===JSON.stringify(expected.cadViewBox),
    'review belongs to a different CAD preview');
  check(JSON.stringify(input.sourceSnapshot)===JSON.stringify(expected.sourceSnapshot),
    'stale review: route or point geometry changed');
  const sourceNodes=new Map(expected.sourceSnapshot.nodes.map(node=>[node.id,node]));
  if(!legacy) {
    check(Array.isArray(input.nodes)&&input.nodes.length===sourceNodes.size,
      'review must list every point exactly once');
    const seen=new Set();
    for(const entry of input.nodes) {
      check(isObject(entry)&&sourceNodes.has(entry.nodeId)&&!seen.has(entry.nodeId),
        'duplicate or unknown point review');
      seen.add(entry.nodeId);
      checkNodeReview(entry,routeIdsFor(expected.sourceSnapshot,entry.nodeId));
    }
  }
  check(Array.isArray(input.segments)&&input.segments.length===expected.segments.length,
    'review must list every segment exactly once');
  const references=new Map(expected.segments.map(entry=>[keyOf(entry),entry]));
  const seen=new Set();
  for(const entry of input.segments) {
    check(isObject(entry),'invalid review entry');
    const key=keyOf(entry),reference=references.get(key);
    check(reference&&!seen.has(key)&&entry.segmentIndex===reference.segmentIndex&&
      entry.fromId===reference.fromId&&entry.toId===reference.toId,
      'duplicate or mismatched segment review');
    seen.add(key);checkSegment(entry,sourceNodes,legacy);
  }
  return structuredClone(input);
}
/** Geometry, role, route ordering and task/phase changes invalidate all reviews. */
export function validateSegmentChecklist(annotation,input) {
  return validateChecklist(annotation,input);
}
/** v1 never contained point or shared-connection confirmation: leave them pending. */
export function importSegmentChecklist(annotation,input) {
  if(input?.schemaVersion!=='private-segment-review-v1')
    return {checklist:validateSegmentChecklist(annotation,input),migrated:false,resetSegmentIds:[]};
  const previous=validateChecklist(annotation,input,true),next=createSegmentChecklist(annotation);
  const sourceNodes=new Map(next.sourceSnapshot.nodes.map(node=>[node.id,node]));
  const resetSegmentIds=[];
  next.segments=previous.segments.map(entry=>{
    const {waitNodeId,...fields}=entry;
    const migrated={...fields,forwardWaitNodeId:null,reverseWaitNodeId:null};
    if(entry.gate==='controlled') {
      if(entry.direction==='forward')migrated.forwardWaitNodeId=waitNodeId;
      if(entry.direction==='reverse')migrated.reverseWaitNodeId=waitNodeId;
      try {checkGate(migrated,sourceNodes);}
      catch {
        resetSegmentIds.push(keyOf(entry));
        return next.segments.find(item=>keyOf(item)===keyOf(entry));
      }
    }
    return migrated;
  });
  return {checklist:validateSegmentChecklist(annotation,next),migrated:true,resetSegmentIds};
}
export function setNodeReview(annotation,checklist,{nodeId,reviewState,sharedConnection}) {
  const next=validateSegmentChecklist(annotation,checklist);
  const index=next.nodes.findIndex(node=>node.nodeId===nodeId);
  check(index!==-1,'unknown point');
  next.nodes[index]={nodeId,reviewState,sharedConnection};
  return validateSegmentChecklist(annotation,next);
}
export function setSegmentReview(annotation,checklist,{routeId,segmentIndex,
  reviewState,access,direction='unresolved',laneCount=null,
  simultaneousPassing='unresolved',gate='unresolved',gateId=null,
  forwardWaitNodeId=null,reverseWaitNodeId=null}) {
  const next=validateSegmentChecklist(annotation,checklist);
  const index=next.segments.findIndex(item=>item.routeId===routeId&&item.segmentIndex===segmentIndex);
  check(index!==-1,'unknown segment');
  next.segments[index]={...next.segments[index],reviewState,access,direction,laneCount,
    simultaneousPassing,gate,gateId,forwardWaitNodeId,reverseWaitNodeId};
  return validateSegmentChecklist(annotation,next);
}
/** Only explicit shared IDs connect routes; proximity and crossings do not. */
export function buildReviewedTopology(annotation,checklist) {
  const draft=normalized(annotation),reviews=validateSegmentChecklist(draft,checklist);
  const routes=new Map(draft.routes.map(route=>[route.id,route]));
  const nodeReviews=new Map(reviews.nodes.map(node=>[node.nodeId,node]));
  const nodeReason=id=>{
    const review=nodeReviews.get(id);
    return review.reviewState!=='operator-confirmed'?'unreviewed-point':
      review.sharedConnection==='unresolved'?'unresolved-shared-connection':null;
  };
  const edges=[],excluded=[];
  for(const segment of reviews.segments) {
    const route=routes.get(segment.routeId);
    const reason=route.taskType==='guide'?'unassigned-guide':
      segment.access!=='allowed'?segment.access:
      nodeReason(segment.fromId)||nodeReason(segment.toId);
    if(reason) {
      excluded.push({routeId:segment.routeId,segmentIndex:segment.segmentIndex,reason});
      continue;
    }
    edges.push({id:keyOf(segment),...segment,taskType:route.taskType,phase:route.phase});
  }
  const used=new Set(edges.flatMap(edge=>[edge.fromId,edge.toId]));
  const nodes=draft.nodes.filter(node=>used.has(node.id)).map(({id,type,u,v})=>({
    id,type,u,v,reviewState:nodeReviews.get(id).reviewState,
    sharedConnection:nodeReviews.get(id).sharedConnection,routeIds:routeIdsFor(draft,id)
  }));
  const graph={
    schemaVersion:'reviewed-topology-v2',backgroundSha256:draft.backgroundSha256,
    cadViewBox:draft.cadViewBox,nodes,edges,excluded,
    excludedNodes:draft.nodes.filter(node=>!used.has(node.id)).map(node=>
      ({nodeId:node.id,reason:nodeReason(node.id)||'no-reviewed-segment'})),
    kind:'reviewed-topology-only',metricScaleVerified:false,
    physicalEtaAllowed:false,trafficReady:false,operationalRoutingReady:false
  };
  return validateReviewedTopology(graph);
}
function checkScope(taskType,phase) {
  check(TASK_TYPES.includes(taskType)&&taskType!=='guide'&&
    (taskType==='charge'?phase==='charge':['empty','loaded'].includes(phase)),
    'explicit transport and phase scope required');
}
/** Validate even serialized input; unknown directions must never imply both ways. */
export function validateReviewedTopology(graph) {
  check(isObject(graph)&&graph.schemaVersion==='reviewed-topology-v2'&&
    graph.kind==='reviewed-topology-only'&&graph.metricScaleVerified===false&&
    graph.physicalEtaAllowed===false&&graph.trafficReady===false&&
    graph.operationalRoutingReady===false,'reviewed topology required');
  check(Array.isArray(graph.nodes)&&graph.nodes.length<=1000&&
    Array.isArray(graph.edges)&&graph.edges.length<=39800,'invalid topology lists');
  let points=createAnnotation(graph.backgroundSha256,graph.cadViewBox);
  const nodes=new Map();
  for(const node of graph.nodes) {
    check(isObject(node),'invalid topology point');
    points=addNode(points,node);
    check(Array.isArray(node.routeIds)&&node.routeIds.length>0&&node.routeIds.every(isId)&&
      new Set(node.routeIds).size===node.routeIds.length,'invalid point route membership');
    checkNodeReview(node,node.routeIds);
    check(node.reviewState==='operator-confirmed'&&node.sharedConnection!=='unresolved',
      'unreviewed point or shared connection in topology');
    nodes.set(node.id,node);
  }
  const seen=new Set();
  for(const edge of graph.edges) {
    check(isObject(edge)&&isId(edge.routeId)&&Number.isInteger(edge.segmentIndex)&&
      edge.segmentIndex>=0&&edge.segmentIndex<199&&edge.id===keyOf(edge)&&!seen.has(edge.id),
      'duplicate or invalid topology edge');
    seen.add(edge.id);
    check(nodes.has(edge.fromId)&&nodes.has(edge.toId)&&edge.fromId!==edge.toId,
      'unknown or identical topology endpoints');
    check([edge.fromId,edge.toId].every(id=>nodes.get(id).routeIds.includes(edge.routeId)),
      'edge does not match point route membership');
    checkScope(edge.taskType,edge.phase);
    checkSegment(edge,nodes);
    check(edge.access==='allowed'&&edge.reviewState==='operator-confirmed',
      'unreviewed or forbidden edge in topology');
  }
  return structuredClone(graph);
}
/** Fewest-edge BFS; equal-hop ties use edge ID order, independent of JSON order. */
export function findReviewedTopologyPath(input,fromId,toId,{taskType,phase}={}) {
  const graph=validateReviewedTopology(input);
  checkScope(taskType,phase);
  const nodes=new Set(graph.nodes.map(node=>node.id));
  check(nodes.has(fromId)&&nodes.has(toId),'unknown or unreviewed endpoint');
  const next=new Map([...nodes].map(id=>[id,[]]));
  const scoped=new Set();
  for(const edge of [...graph.edges].sort((a,b)=>compare(a.id,b.id))) {
    if(edge.taskType!==taskType||edge.phase!==phase)continue;
    scoped.add(edge.fromId);scoped.add(edge.toId);
    if(edge.direction!=='reverse')next.get(edge.fromId).push({to:edge.toId,id:edge.id});
    if(edge.direction!=='forward')next.get(edge.toId).push({to:edge.fromId,id:edge.id});
  }
  if(!scoped.has(fromId)||!scoped.has(toId))return null;
  const queue=[fromId],seen=new Map([[fromId,null]]);
  for(let at=0;at<queue.length;at++) {
    const current=queue[at];
    if(current===toId) {
      const path=[],edgeIds=[];
      for(let node=current;seen.get(node)!==null;) {
        path.unshift(node);
        const previous=seen.get(node);edgeIds.unshift(previous.id);node=previous.from;
      }
      path.unshift(fromId);
      return {kind:'reviewed-topology-only',nodeIds:path,edgeIds,
        measuredDistanceMm:null,etaMs:null,trafficAuthorized:false};
    }
    for(const item of next.get(current))if(!seen.has(item.to)) {
      seen.set(item.to,{from:current,id:item.id});queue.push(item.to);
    }
  }
  return null;
}
