import {SCHEMATIC_LAYOUT} from './schematic-layout.mjs';
import {FLEXIBLE_WAREHOUSE_AREA} from './warehouse-layout.mjs';

export const WAREHOUSE_ROUTE_MODES=Object.freeze(['normal','detour']);
export const warehouseRouteName=mode=>mode==='detour'?'迂回ルート':'通常ルート';
const evidence='synthetic-relative-route-not-site-geometry';
const requireRoute=(ok,message)=>{if(!ok)throw new Error('WAREHOUSE_ROUTE_CONFIG: '+message);};
const scopes=[{movement:'empty',taskTypes:['*']},{movement:'loaded',taskTypes:['*']},
  {movement:'charge',taskTypes:['CHARGE']},{movement:'wait',taskTypes:['WAIT']}];

/** Install explicit PUBLIC SYNTHETIC connections, not CAD-derived distances or directions. */
export function installWarehouseRouting(input){
  const g=structuredClone(input);
  if(g.warehouseRoutingVersion===1)return g;
  requireRoute(g.coordinateSystem==='synthetic-display','新規接続は縮尺変換前の合成グラフで登録してください。');
  const nodes=new Map(g.nodes.map(n=>[n.id,n])),edges=new Map(g.edges.map(e=>[e.id,e]));
  const addNode=(id,x,y,areaId='WH',type='junction',extra={})=>{
    const node={id,x,y,areaId,type,approvalState:'synthetic-validated',exclusiveTraffic:true,
      occupancyResourceIds:['NODE:'+id],evidence,...extra};
    if(nodes.has(id))Object.assign(nodes.get(id),node);
    else {g.nodes.push(node);nodes.set(id,node);}
    return nodes.get(id);
  };
  const addEdge=(id,fromNodeId,toNodeId,{direction='both',distanceMm=1000,modes,shutterId=null,
    resources=[],passageId,forwardDirection='forward',laneResource,atomicPassageId}={})=>{
    const a=nodes.get(fromNodeId),b=nodes.get(toNodeId);
    requireRoute(a&&b,'合成接続点が不足しています。'+id);
    const edge={id,fromNodeId,toNodeId,distanceMm,speedMmPerSec:{empty:1000,loaded:750,charge:850,wait:850},
      approvalState:'synthetic-validated',accessScopes:structuredClone(scopes),
      lanes:[{id:id+'-L1',direction,...(laneResource?{resourceId:laneResource}:{})}],
      lanePolicy:{laneCount:1,simultaneousPassing:'no-alternating'},occupancyResourceIds:resources,
      displayPath:[{x:a.x,y:a.y},{x:b.x,y:b.y}],shutterId,modelDistanceEvidence:'explicit-synthetic-test-distance-not-measured',
      ...(modes?{enabledRouteModes:modes}:{}),
      ...(passageId?{directionalPassageId:passageId,passageForwardDirection:forwardDirection,
        passageDirectionEvidence:'conservative-same-direction-parallel-opposing-unresolved'}:{}),
      ...(atomicPassageId?{atomicPassageId,atomicPassageEvidence:'explicit-synthetic-shared-lane-passage-not-site-clearance'}:{})};
    if(edges.has(id)){
      const existing=edges.get(id);for(const key of Object.keys(existing))delete existing[key];Object.assign(existing,edge);
    }else{g.edges.push(edge);edges.set(id,edge);}
    return edges.get(id);
  };
  // Keep each original main aisle, splitting only at explicit new junctions.
  const splitMain=(x,y,id)=>{
    addNode(id,x,y);
    for(const edge of [...g.edges]){
      const a=nodes.get(edge.fromNodeId),b=nodes.get(edge.toNodeId);
      if(a.x!==x||b.x!==x||y<=Math.min(a.y,b.y)||y>=Math.max(a.y,b.y))continue;
      const original=structuredClone(edge),to=edge.toNodeId;
      edge.toNodeId=id;edge.distanceMm=original.distanceMm/2;
      edge.displayPath=[{x:a.x,y:a.y},{x,y}];
      const part={...original,id:original.id+'-'+id,toNodeId:to,fromNodeId:id,distanceMm:original.distanceMm/2,
        displayPath:[{x,y},{x:b.x,y:b.y}],
        lanes:original.lanes.map(l=>({...l,id:l.id+'-'+id}))};
      g.edges.push(part);edges.set(part.id,part);
    }
  };
  for(const [row,y] of [[1,632],[2,638]]){
    const id='WB1-WB2-FLEX-R0'+row;
    splitMain(580,y,id+'-ACCESS');
    addNode(id+'-DROP',540,y,'WH','dropoff',{enabledRouteModes:['normal']});
    addEdge(id+'-BRANCH',id+'-ACCESS',id+'-DROP',{modes:['normal']});
    g.interfaceBindings.push({pattern:id+'-*',nodeId:id+'-DROP'});
  }
  splitMain(580,635,'WH-FLEX-EAST');splitMain(615,635,'WH-FLEX-WALL');
  addNode('WH-FLEX-WEST',215,635);addNode('WH-FLEX-WEST-L2',223,635);
  for(const [id,a,b] of [['FLEX-WEST-JOIN','WH-FLEX-WEST','WH-FLEX-WEST-L2'],
    ['WB12-DETOUR','WH-FLEX-WEST-L2','WH-FLEX-EAST'],['WB12-DETOUR-WALL','WH-FLEX-EAST','WH-FLEX-WALL']])
    addEdge(id,a,b,{modes:['detour'],distanceMm:id==='WB12-DETOUR'?5000:1000,
      laneResource:'WB12-SINGLE-LANE',atomicPassageId:'WB12-DETOUR-PASSAGE'});

  const west=SCHEMATIC_LAYOUT.gates.whWest;
  addNode('WH-W-GATE',west.x,west.y,'WH','shutter-wait');
  for(let lane=1;lane<=2;lane++){
    const x=lane===1?west.x:223,gate=lane===1?'WH-W-GATE':'WH-W-GATE-L2';
    addNode(gate,x,475,'WH','shutter-wait');
    const alignment={metricAlignment:{xNodeId:gate,evidence:'synthetic-relative-layout-alignment-not-site-stop'}};
    addNode('WH-W-INNER-L'+lane,x,500,'WH','junction',alignment);
    addNode('WH-W-OUTER-L'+lane,x,440,'INTER','junction',alignment);
    const turn=lane===1?'DETOUR-OUT-WEST':'WH-W-TURN-L'+lane;
    addNode(turn,x,410,'INTER','turn',alignment);
    addEdge('WB1-WEST-L'+lane,'WH-W-INNER-L'+lane,lane===1?'WH-FLEX-WEST':'WH-FLEX-WEST-L2',{
      distanceMm:8000,passageId:'WB1-WEST-TWO-LANES',forwardDirection:'south'});
    addEdge('WH-W-INNER-L'+lane+'-LINK',gate,'WH-W-INNER-L'+lane,{modes:['detour']});
    addEdge('WH-W-PORTAL-L'+lane,gate,'WH-W-OUTER-L'+lane,{modes:['detour'],shutterId:'SH-WEST',
      passageId:'SH-WEST-PARALLEL',forwardDirection:'outbound',laneResource:'SH-WEST-LANE'+lane});
    addEdge('WH-W-OUTER-L'+lane+'-LINK','WH-W-OUTER-L'+lane,turn,{
      modes:['detour'],resources:['OUTDOOR-JUNCTION']});
  }
  for(const [id,x,gate] of [['DETOUR-PZ-ENTRY-TURN',630,'PZ-ENTRY'],['DETOUR-PZ-EXIT-TURN',800,'PZ-EXIT']])
    addNode(id,x,410,'INTER','turn',{metricAlignment:{xNodeId:gate,evidence:'synthetic-relative-layout-alignment-not-site-stop'}});
  addEdge('DETOUR-WEST-L2-JOIN','WH-W-TURN-L2','DETOUR-OUT-WEST',{modes:['detour'],resources:['OUTDOOR-JUNCTION']});
  for(const [id,a,b] of [['DETOUR-OUT-WEST-SPAN','DETOUR-OUT-WEST','DETOUR-PZ-ENTRY-TURN'],
    ['DETOUR-OUT-EAST-SPAN','DETOUR-PZ-ENTRY-TURN','DETOUR-PZ-EXIT-TURN']])
    addEdge(id,a,b,{modes:['detour'],distanceMm:15000,resources:['OUTDOOR-JUNCTION']});
  addEdge('DETOUR-PZ-IN-LINK','DETOUR-PZ-EXIT-TURN','E09-TURN1',{modes:['detour'],resources:['OUTDOOR-JUNCTION'],direction:'forward'});
  addEdge('DETOUR-PZ-IN','E09-TURN1','PZ-EXIT',{modes:['detour'],shutterId:'SH-PZ-EXIT',resources:['OUTDOOR-JUNCTION'],direction:'forward'});
  addEdge('DETOUR-PZ-OUT','PZ-ENTRY','E08-TURN2',{modes:['detour'],shutterId:'SH-PZ-ENTRY',resources:['OUTDOOR-JUNCTION'],direction:'forward'});
  addEdge('DETOUR-PZ-OUT-LINK','E08-TURN2','DETOUR-PZ-ENTRY-TURN',{modes:['detour'],resources:['OUTDOOR-JUNCTION'],direction:'forward'});
  for(const id of ['E08','E08-PART2','E08-PART3','E08-PART2-EXIT-TURN-PART','E09','E09-PART2','E09-PART3'])
    edges.get(id).enabledRouteModes=['normal'];

  // Two separate straight portal lanes; any turns belong to the approaches.
  // Opposing simultaneous use remains unconfirmed and is conservatively held.
  for(let lane=1;lane<=2;lane++){
    const x=862.5+(lane-1)*8,gate=lane===1?'WH-GATE':'WH-E-GATE-L2',inner='WH-E-INNER-L'+lane,
      outer='WH-E-OUTER-L'+lane,turn='WH-E-TURN-L'+lane;
    const alignment={metricAlignment:{xNodeId:gate,evidence:'synthetic-relative-layout-alignment-not-site-stop'}};
    addNode(gate,x,475,'WH','shutter-wait');addNode(inner,x,500,'WH','junction',alignment);
    addNode(outer,x,440,'INTER','junction',alignment);addNode(turn,x,390,'INTER','turn',alignment);
    addEdge('WH-E-INNER-L'+lane+'-UP','WH-E-TOP-WALL',inner,{direction:'forward',resources:['WH-E-PORTAL-MERGE']});
    addEdge('WH-E-INNER-L'+lane+'-DOWN',inner,'WH-E-TOP',{direction:'forward',resources:['WH-E-PORTAL-MERGE']});
    addEdge(lane===1?'E20':'WH-E-INNER-L2-LINK',gate,inner,{modes:['normal']});
    for(const outbound of [true,false])addEdge(lane===1?(outbound?'E08':'E09-PART3'):
      'WH-E-PORTAL-L2-'+(outbound?'OUT':'IN'),outbound?gate:outer,outbound?outer:gate,{
        modes:['normal'],direction:'forward',shutterId:'SH-EAST',laneResource:'SH-EAST-LANE'+lane,
        passageId:'SH-EAST-PARALLEL',forwardDirection:outbound?'outbound':'inbound'});
    addEdge('WH-E-OUTER-L'+lane+'-LINK',outer,turn,{modes:['normal'],resources:['OUTDOOR-JUNCTION']});
    if(lane===1){
      // E08-TURN1 remains the common outdoor junction, not a second co-located node.
      g.nodes=g.nodes.filter(n=>n.id!==turn);nodes.delete(turn);
      const link=edges.get('WH-E-OUTER-L1-LINK');link.toNodeId='E08-TURN1';
    }else addEdge('WH-E-L2-OUT-MERGE',turn,'E08-TURN1',{modes:['normal'],resources:['OUTDOOR-JUNCTION']});
  }
  for(const id of ['E20-ENTRY','WH-E-GATE-UP','WH-E-GATE-RETURN'])edges.get(id).enabledRouteModes=[];
  // Remove obsolete side-step stops from the active gate path, retaining IDs for old saved inputs.
  g.shutters.find(s=>s.id==='SH-WEST').initiallyPassable=true;
  g.shutters.find(s=>s.id==='SH-WEST').permissionSource='synthetic-scenario';
  const boundary=g.layoutGeometry.boundaries;
  boundary.find(b=>b.id==='PZ-SOUTH').permittedCrossings.push(
    {edgeId:'DETOUR-PZ-IN',gateNodeId:'PZ-EXIT',shutterId:'SH-PZ-EXIT',point:{x:800,y:322}},
    {edgeId:'DETOUR-PZ-OUT',gateNodeId:'PZ-ENTRY',shutterId:'SH-PZ-ENTRY',point:{x:630,y:322}});
  boundary.find(b=>b.id==='WH-NORTH').permittedCrossings=g.edges.filter(e=>
    ['SH-EAST','SH-WEST'].includes(e.shutterId)).map(e=>{
      const gate=nodes.get(e.fromNodeId).areaId==='WH'?nodes.get(e.fromNodeId):nodes.get(e.toNodeId);
      return {edgeId:e.id,gateNodeId:gate.id,shutterId:e.shutterId,point:{x:gate.x,y:458}};
    });
  g.warehouseRoutingVersion=1;g.warehouseRouteMode='normal';
  g.warehouseRouting={evidence:'user-confirmed-mode-contract-synthetic-connections',
    flexibleArea:FLEXIBLE_WAREHOUSE_AREA,normal:{warehouseShutter:'SH-EAST',pzIn:'SH-PZ-ENTRY',pzOut:'SH-PZ-EXIT'},
    detour:{warehouseShutter:'SH-WEST',pzIn:'SH-PZ-EXIT',pzOut:'SH-PZ-ENTRY'},
    westOfWB1:{laneCount:2,individualLaneDirections:'unresolved',connectionEvidence:evidence},
    perimeterPassage:{parallelCapacity:2,opposingSimultaneous:'unresolved',individualLaneDirections:'unresolved',
      syntheticPolicy:'same-direction-parallel-opposing-exclusive'}};
  finalizeWarehouseTraffic(g);
  return g;
}

/** Explicit conservative conflict declarations for this public synthetic graph.
 * Intersections do NOT create graph connections, physical routes, or measured lengths. */
export function finalizeWarehouseTraffic(g){
  for(const id of ['E08','E09']){
    const parts=g.edges.filter(edge=>edge.splitSourceEdgeId===id);
    const total=parts.reduce((sum,edge)=>sum+edge.distanceMm,0);
    for(const part of parts)part.splitSourceDistanceMm=total;
  }
  for(const edge of g.edges){
    if(['E03-ENTRY-PART','PZ-SOUTH-E03-ENTRY-PART','E07'].includes(edge.id))
      edge.mergeConflictByRouteMode={detour:'DETOUR-PZ-APPROACH:'+edge.id};
    if(edge.directionalPassageId?.startsWith('SH-')){
      edge.admissionResourceIds=['OUTDOOR-JUNCTION'];
      edge.mergeConflictResourceId=edge.lanes[0].resourceId;
      if(!edge.occupancyResourceIds.includes(edge.mergeConflictResourceId))edge.occupancyResourceIds.push(edge.mergeConflictResourceId);
    }else if(edge.occupancyResourceIds.includes('OUTDOOR-JUNCTION'))edge.mergeConflictResourceId='OUTDOOR-JUNCTION';
    if(edge.id==='E20'||/^WH-[EW]-INNER-L[12]-(LINK|UP|DOWN)$/.test(edge.id)){
      const resource=edge.id==='E20'?'WH-E-INNER-L1-ADMISSION':
        /^WH-E-INNER/.test(edge.id)?'WH-E-PORTAL-MERGE':edge.id+'-ADMISSION';
      edge.mergeConflictResourceId=resource;
      if(!edge.occupancyResourceIds.includes(resource))edge.occupancyResourceIds.push(resource);
    }
    if(/^WB1-WEST-L[12]$/.test(edge.id)){
      edge.mergeConflictResourceId=edge.id+'-ADMISSION';
      if(!edge.occupancyResourceIds.includes(edge.mergeConflictResourceId))edge.occupancyResourceIds.push(edge.mergeConflictResourceId);
    }
  }
  const nodes=new Map(g.nodes.map(n=>[n.id,n]));
  const modes=edge=>edge.enabledRouteModes??['normal','detour'];
  const shares=(a,b)=>a.occupancyResourceIds.some(id=>b.occupancyResourceIds.includes(id))||
    a.lanes.some(l=>b.lanes.some(r=>(l.resourceId??l.id)===(r.resourceId??r.id)));
  const between=(v,a,b)=>v>=Math.min(a,b)&&v<=Math.max(a,b);
  for(let i=0;i<g.edges.length;i++)for(let j=i+1;j<g.edges.length;j++){
    const a=g.edges[i],b=g.edges[j];
    if(!modes(a).some(mode=>modes(b).includes(mode))||shares(a,b))continue;
    const [p,q]=a.displayPath,[r,s]=b.displayPath;
    let cross=null,overlap=false;
    if(p.x===q.x&&r.y===s.y&&between(p.x,r.x,s.x)&&between(r.y,p.y,q.y))cross={x:p.x,y:r.y};
    if(r.x===s.x&&p.y===q.y&&between(r.x,p.x,q.x)&&between(p.y,r.y,s.y))cross={x:r.x,y:p.y};
    if(p.x===q.x&&r.x===s.x&&p.x===r.x)overlap=Math.min(Math.max(p.y,q.y),Math.max(r.y,s.y))>Math.max(Math.min(p.y,q.y),Math.min(r.y,s.y));
    if(p.y===q.y&&r.y===s.y&&p.y===r.y)overlap=Math.min(Math.max(p.x,q.x),Math.max(r.x,s.x))>Math.max(Math.min(p.x,q.x),Math.min(r.x,s.x));
    const junction=cross&&[a.fromNodeId,a.toNodeId].some(id=>[b.fromNodeId,b.toNodeId].includes(id)&&
      nodes.get(id).exclusiveTraffic&&nodes.get(id).x===cross.x&&nodes.get(id).y===cross.y);
    if(overlap||cross&&!junction){
      const resource='SYNTHETIC-CONFLICT:'+a.id+':'+b.id;
      a.occupancyResourceIds.push(resource);b.occupancyResourceIds.push(resource);
    }
  }
  return g;
}

/** Run-start transition only. No inventory deletion, relocation, or mid-run mode switch. */
export function prepareWarehouseRouting(scenario){
  if(scenario.warehouseRouteMode===undefined)return scenario;
  const mode=scenario.warehouseRouteMode;
  requireRoute(WAREHOUSE_ROUTE_MODES.includes(mode),'走行モードは通常ルートまたは迂回ルートを指定してください。');
  const flexible=(scenario.warehouse??[]).filter(s=>s.flexibleAreaId===FLEXIBLE_WAREHOUSE_AREA.id||
    s.blockId===FLEXIBLE_WAREHOUSE_AREA.id||s.id?.startsWith(FLEXIBLE_WAREHOUSE_AREA.id+'-'));
  requireRoute(flexible.length===26&&new Set(flexible.map(s=>s.id)).size===26&&
    flexible.every(s=>s.tier===1&&[1,2].includes(s.row)&&Number.isInteger(s.column)&&s.column>=1&&s.column<=13),
    'WB1・WB2間は2行×13列の26平面ロケーションが必要です。上段は未確定です。');
  flexible.forEach(slot=>{slot.flexibleAreaId=FLEXIBLE_WAREHOUSE_AREA.id;});
  if(mode==='detour'){
    requireRoute(flexible.every(s=>!(s.palletIds??[]).length),'WB1・WB2間に在荷パレットが残っています。');
    requireRoute(flexible.every(s=>!(s.reserved??[]).length&&!s.reservedTaskId),
      'WB1・WB2間に搬入予約が残っています。');
    const touches=t=>[t.destinationId,t.destinationLocationId,t.storageLocationId,t.originId,t.locationId,t.rowId]
      .some(id=>typeof id==='string'&&id.startsWith(FLEXIBLE_WAREHOUSE_AREA.id));
    requireRoute([...(scenario.initialTasks??[]),...(scenario.activeTasks??[]),...(scenario.tasks??[])].every(t=>
      ['completed','cancelled'].includes(t.status)||!touches(t)), 'WB1・WB2間を使用中の搬送タスクがあります。');
    requireRoute((scenario.manualRequests??[]).every(t=>!touches(t)),
      '迂回ルートではWB1・WB2間への搬送予約を受け付けられません。');
  }
  for(const slot of flexible)slot.storageEnabled=mode==='normal';
  if(scenario.motionModel==='synthetic_graph'){
    requireRoute(scenario.operationalTopology?.warehouseRoutingVersion===1,'走行モードに対応した合成グラフが必要です。');
    scenario.operationalTopology.warehouseRouteMode=mode;
    for(const edge of scenario.operationalTopology.edges){
      if(!edge.mergeConflictByRouteMode)continue;
      // The UI may reuse a saved Run's scenario for a NEW Run. Remove only
      // mode-owned resources before applying it again; base traffic stays intact.
      const scoped=Object.values(edge.mergeConflictByRouteMode);
      edge.occupancyResourceIds=edge.occupancyResourceIds.filter(id=>!scoped.includes(id));
      if(scoped.includes(edge.mergeConflictResourceId))delete edge.mergeConflictResourceId;
      const resource=edge.mergeConflictByRouteMode?.[mode];
      if(!resource)continue;
      edge.mergeConflictResourceId=resource;
      if(!edge.occupancyResourceIds.includes(resource))edge.occupancyResourceIds.push(resource);
    }
  }
  return scenario;
}
