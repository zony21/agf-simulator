import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPrivateGuide,main} from '../tools/build-private-route-seed.mjs';

const svg=Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n'+
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 -200 400 100">'+
  '<desc>PRIVATE-CAD-PREVIEW-V1</desc></svg>','utf8');
const config={guides:[
  {id:'GUIDE01',points:[[0,0.1],[0.5,0.1],[0.5,0.9]]},
  {id:'GUIDE02',points:[[0.5,0.9],[1,0.9]]}
]};

test('seeded private guides are tied to exact SVG SHA/viewBox and never routable',()=>{
  const output=buildPrivateGuide(svg,config);
  assert.equal(output.backgroundSha256,createHash('sha256').update(svg).digest('hex'));
  assert.deepEqual(output.cadViewBox,[100,-200,400,100]);
  assert.equal(output.routes.length,2);
  assert.deepEqual(output.routes.map(r=>[r.taskType,r.phase,r.status]),
    [['guide','guide','draft'],['guide','guide','draft']]);
  assert.equal(output.nodes[1].xCadMm,300);
  assert.equal(output.nodes[1].yCadMm,190);
  assert.equal(output.routable,false);
  assert.equal(output.physicalEtaAllowed,false);
  assert.equal(output.approvalStatus,'draft-only');
});
test('builder rejects unsupported file or coordinates rather than inferring geometry',()=>{
  assert.throws(()=>buildPrivateGuide(Buffer.from('<svg/>'),config),/approved private/);
  assert.throws(()=>buildPrivateGuide(svg,{guides:[{id:'X',points:[[0,0],[1.2,.3]]}]}),/fractions/);
  assert.throws(()=>buildPrivateGuide(svg,{guides:[{id:'X',points:[[0,0]]}]}),/explicit normalized/);
  assert.throws(()=>buildPrivateGuide(svg,{guides:[{id:'X',points:[[0,0],[.2,.2]]},{id:'X',points:[[0,0],[.3,.3]]}]}),/duplicate guide point/);
});
test('CLI writes only to explicitly supplied private destination and refuses overwrite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'agf-seed-'));
  try {
    const svgPath=join(dir,'preview.svg'),cfg=join(dir,'config.json'),out=join(dir,'seed.json');
    await writeFile(svgPath,svg);await writeFile(cfg,JSON.stringify(config));
    await main(['--svg',svgPath,'--config',cfg,'--out',out]);
    const result=JSON.parse(await readFile(out,'utf8'));
    assert.equal(result.routes.length,2);
    await assert.rejects(()=>main(['--svg',svgPath,'--config',cfg,'--out',out]),/EEXIST/);
    await assert.rejects(()=>main(['--svg',svgPath,'--config',cfg,'--out',
      new URL('../assets/public.json',import.meta.url).pathname]),/gitignored private/);
  }finally {await rm(dir,{recursive:true,force:true});}
});
