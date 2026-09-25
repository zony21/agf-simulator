#!/usr/bin/env node
/**
 * Build a PRIVATE, image-bound, unassigned route guide JSON from an explicitly
 * reviewed private normalized-coordinate config. Does not infer walkability.
 *
 * node tools/build-private-route-seed.mjs --svg private/preview.svg
 *   --config private/guide-seed.json --out private/initial-guides.json
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAnnotation,addNode,addRoute,validateAnnotation} from '../src/map/route-annotations.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fail=message=>{throw new Error(message)};
function requirePrivate(file) {
  const path=resolve(file);
  const inside=parent=>{
    const part=relative(parent,path);
    return part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);
  };
  if(inside(root)&&!inside(resolve(root,'private')))
    fail('CAD-derived source/config/output inside the repository must stay under gitignored private/');
  return path;
}
export function parsePreview(buffer) {
  const head=buffer.subarray(0,4096).toString('utf8');
  if(!head.includes('PRIVATE-CAD-PREVIEW-V1')||!head.includes('<svg'))
    fail('source must be the approved private display SVG');
  const hit=head.match(/<svg\b[^>]*\bviewBox="([^"]+)"/);
  const box=hit?.[1]?.trim().split(/[\s,]+/).map(Number);
  if(!box||box.length!==4||box.some(x=>!Number.isFinite(x))||box[2]<=0||box[3]<=0)
    fail('valid private SVG viewBox required');
  return box;
}
export function buildPrivateGuide(buffer,config) {
  if(!Buffer.isBuffer(buffer)||buffer.length>80_000_000)fail('SVG must be a buffer <= 80MB');
  const box=parsePreview(buffer);
  if(!config||!Array.isArray(config.guides)||!config.guides.length||
     config.guides.length>50)fail('guides must contain 1–50 explicitly authored candidate lines');
  let result=createAnnotation(createHash('sha256').update(buffer).digest('hex'),box);
  const usedIds=new Set();
  for(const guide of config.guides) {
    if(!guide||typeof guide.id!=='string'||
       !Array.isArray(guide.points)||guide.points.length<2||guide.points.length>200)
      fail('each guide requires an ID and 2–200 explicit normalized points');
    if(result.routes.some(route=>route.id===guide.id))
      fail('duplicate route ID');
    const ids=[];
    for(const [index,point] of guide.points.entries()) {
      // Explicit {id,u,v} permits a junction shared by multiple draft guides.
      const shared=point&&!Array.isArray(point)&&typeof point==='object';
      const pointId=shared?point.id:guide.id+'_'+String(index+1).padStart(2,'0');
      const u=shared?point.u:point?.[0],v=shared?point.v:point?.[1];
      if((!shared&&(!Array.isArray(point)||point.length!==2))||
         typeof u!=='number'||!Number.isFinite(u)||u<0||u>1||
         typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)
        fail('guide points must be [u,v] or {id,u,v} fractions inside the preview');
      if(usedIds.has(pointId)) {
        const existing=result.nodes.find(n=>n.id===pointId);
        if(!shared||!existing||existing.u!==u||existing.v!==v)
          fail('shared guide point ID has inconsistent coordinates');
      } else {
        result=addNode(result,{id:pointId,type:'waypoint',u,v});
        usedIds.add(pointId);
      }
      ids.push(pointId);
    }
    result=addRoute(result,{id:guide.id,taskType:'guide',phase:'guide',nodeIds:ids});
  }
  return validateAnnotation(result,result.backgroundSha256,box);
}
function argumentsFrom(argv) {
  const args={};
  for(let i=0;i<argv.length;i+=2) {
    const key=argv[i];
    if(!['--svg','--config','--out'].includes(key)||!argv[i+1]||args[key])
      fail('usage: --svg private.svg --config private.json --out private.json');
    args[key]=argv[i+1];
  }
  if(Object.keys(args).length!==3)fail('provide --svg --config --out');
  return args;
}
export async function main(argv=process.argv.slice(2)) {
  const args=argumentsFrom(argv);
  const svgPath=requirePrivate(args['--svg']);
  const configPath=requirePrivate(args['--config']);
  const outPath=requirePrivate(args['--out']);
  if(outPath===svgPath||outPath===configPath)fail('output must be a separate file');
  const buffer=await readFile(svgPath),config=JSON.parse(await readFile(configPath,'utf8'));
  const guide=buildPrivateGuide(buffer,config);
  await mkdir(dirname(outPath),{recursive:true});
  await writeFile(outPath,JSON.stringify(guide,null,2)+'\n',{flag:'wx'});
  process.stdout.write('private draft guides: '+guide.routes.length+'; routable=false; output='+outPath+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(err=>{console.error('ERROR: '+err.message);process.exitCode=2;});
