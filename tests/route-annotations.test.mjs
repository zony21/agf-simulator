import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnnotation, addNode, addRoute, moveNode, insertRoutePoint,
  removeRoutePoint, deleteRoute, validateAnnotation
} from '../src/map/route-annotations.mjs';

const hash='a'.repeat(64);
const box=[100,-200,400,100]; // DXF: top-left (100,200), bottom-right (500,100)
const point=(id,u,v,type='waypoint')=>({id,u,v,type});

test('user-specified mm SVG coordinates are orientation-correct and remain draft-only',()=>{
  const base=createAnnotation(hash,box);
  const a=addNode(base,point('H01',0.25,0.5,'pickup'));
  assert.equal(a.nodes[0].xCadMm,200);
  assert.equal(a.nodes[0].yCadMm,150);
  assert.equal(a.nodes[0].u,0.25);
  assert.equal(a.nodes[0].v,0.5);
  assert.equal(a.routable,false);
  assert.equal(a.metricScaleVerified,false);
  assert.equal(a.physicalEtaAllowed,false);
  assert.equal(a.approvalStatus,'draft-only');
  assert.equal(base.nodes.length,0);
});
test('PNG permits fractional annotations without inventing CAD millimetre coordinates',()=>{
  const a=addNode(createAnnotation(hash),point('P1',0.1,0.9));
  assert.equal(a.cadViewBox,null);
  assert.equal(Object.hasOwn(a.nodes[0],'xCadMm'),false);
});
test('route must use explicitly selected existing points and remains draft',()=>{
  const a=addNode(addNode(createAnnotation(hash,box),point('H01',0,0,'pickup')),
    point('H02',1,1,'dropoff'));
  assert.throws(()=>addRoute(a,{id:'R1',taskType:'01',phase:'loaded',nodeIds:['H01','FAKE']}),/undefined point/);
  assert.throws(()=>addRoute(a,{id:'R1',taskType:'01',phase:'loaded',nodeIds:['H01','H01']}),/differ/);
  assert.throws(()=>addRoute(a,{id:'R1',taskType:'charge',phase:'loaded',nodeIds:['H01','H02']}),/charge/);
  const result=addRoute(a,{id:'R1',taskType:'01',phase:'loaded',nodeIds:['H01','H02']});
  assert.deepEqual(result.routes[0],{id:'R1',taskType:'01',phase:'loaded',
    nodeIds:['H01','H02'],status:'draft'});
  assert.equal(result.routable,false);
});
test('reject stale preview import, changed viewBox and illicit confirmation flags',()=>{
  let a=createAnnotation(hash,box);
  a=addNode(a,point('H01',0.2,0.3));
  assert.deepEqual(validateAnnotation(a,hash,box),a);
  assert.throws(()=>validateAnnotation(a,'b'.repeat(64),box),/exact CAD preview/);
  assert.throws(()=>validateAnnotation(a,hash,[100,-200,401,100]),/viewBox mismatch/);
  assert.throws(()=>validateAnnotation({...a,routable:true},hash,box),/unsafe/);
  assert.throws(()=>validateAnnotation({...a,approvalStatus:'confirmed'},hash,box),/unsafe/);
  assert.throws(()=>validateAnnotation({...a,nodes:[{...a.nodes[0],id:'../../evil'}]},hash,box),/point ID/);
  assert.throws(()=>validateAnnotation({...a,nodes:[{...a.nodes[0],u:Infinity}]},hash,box),/point must/);
});
test('derived CAD coordinates are recomputed during import',()=>{
  let a=addNode(createAnnotation(hash,box),point('P1',0.5,0.5));
  a.nodes[0].xCadMm=9999;
  assert.equal(validateAnnotation(a,hash,box).nodes[0].xCadMm,300);
});

test('dragging a waypoint updates normalized and SVG-derived mm coordinates only in new state',()=>{
  const base=addNode(createAnnotation(hash,box),point('P1',0.2,0.2));
  const moved=moveNode(base,'P1',0.75,0.75);
  assert.equal(base.nodes[0].u,0.2);
  assert.deepEqual([moved.nodes[0].u,moved.nodes[0].v],[0.75,0.75]);
  assert.deepEqual([moved.nodes[0].xCadMm,moved.nodes[0].yCadMm],[400,125]);
  assert.equal(moved.routable,false);
  assert.equal(moved.physicalEtaAllowed,false);
  assert.throws(()=>moveNode(base,'P1',1.1,0.5),/preview image/);
  assert.throws(()=>moveNode(base,'unknown',0.5,0.5),/undefined point/);
});
test('insert waypoint on a selected segment, delete a waypoint and a route with independent source',()=>{
  let a=createAnnotation(hash,box);
  a=addNode(a,point('A',0,0));a=addNode(a,point('B',1,1));
  a=addRoute(a,{id:'R1',taskType:'01',phase:'loaded',nodeIds:['A','B']});
  const inserted=insertRoutePoint(a,{routeId:'R1',segmentIndex:0,id:'MID',u:.25,v:.75});
  assert.deepEqual(inserted.routes[0].nodeIds,['A','MID','B']);
  assert.deepEqual([inserted.nodes[2].xCadMm,inserted.nodes[2].yCadMm],[200,125]);
  assert.deepEqual(a.routes[0].nodeIds,['A','B']);
  assert.deepEqual(validateAnnotation(inserted,hash,box),inserted);
  assert.throws(()=>insertRoutePoint(inserted,{routeId:'R1',segmentIndex:3,id:'ERR',u:0,v:0}),/segment/);
  assert.throws(()=>insertRoutePoint(inserted,{routeId:'R1',segmentIndex:0,id:'MID',u:0,v:0}),/duplicate point/);
  const reduced=removeRoutePoint(inserted,{routeId:'R1',nodeIndex:1});
  assert.deepEqual(reduced.routes[0].nodeIds,['A','B']);
  assert.throws(()=>removeRoutePoint(reduced,{routeId:'R1',nodeIndex:0}),/at least two/);
  const cleared=deleteRoute(reduced,'R1');
  assert.equal(cleared.routes.length,0);
  assert.equal(cleared.nodes.length,3);
  assert.equal(cleared.approvalStatus,'draft-only');
});
test('proposal made from two explicit anchors and elbow remains unverified on export/import',()=>{
  let a=createAnnotation(hash,box);
  for(const p of [point('A',.1,.1),point('ELBOW',.8,.1),point('B',.8,.8)])a=addNode(a,p);
  a=addRoute(a,{id:'R01',taskType:'05',phase:'loaded',nodeIds:['A','ELBOW','B']});
  assert.equal(a.routable,false);
  assert.equal(a.physicalEtaAllowed,false);
  assert.deepEqual(validateAnnotation(JSON.parse(JSON.stringify(a)),hash,box),a);
});
