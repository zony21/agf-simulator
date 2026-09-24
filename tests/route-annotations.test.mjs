import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnnotation, addNode, addRoute, validateAnnotation
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
