const movements=['empty','loaded','charge','wait'];
const directions=['forward','reverse'];
const required=(ok,message)=>{if(!ok)throw new Error('VEHICLE_TRAVEL_CONFIG: '+message);};

/** Public catalogue reference, not the installed CE vehicle's commissioned speed. */
export function createVnp20TravelProfile(){
  return {requestedModel:'VNP20-66(CE)',catalogueModel:'VNP20(VL)-66',frontDefinition:'opposite-forks',
    ceVariantVerified:false,siteSpeedVerified:false,verifiedOn:'2026-10-29',
    sourceUrl:'https://visionnav.co.jp/service/index53.html?proid=91%2C121%2C125%2C95%2C102%2C124%2C90%2C94%2C126%2C123',
    corroboratingUrl:'https://okaya-logiauto.com/en/model/counterbalance-stacker/',
    speedEvidence:'manufacturer-catalogue-reference-not-site-speed',
    directionEvidence:'provisional-normal-transfer-forward',
    straightMmPerSec:{empty:{forward:2500,reverse:600},loaded:{forward:2100,reverse:600}},
    defaultDirection:{empty:'forward',loaded:'forward',charge:'forward',wait:'forward'}};
}

export function validateVehicleTravelProfile(profile){
  required(profile&&profile.frontDefinition==='opposite-forks','車体前方はフォークと反対側です。');
  required(typeof profile.speedEvidence==='string'&&profile.speedEvidence&&
    typeof profile.directionEvidence==='string'&&profile.directionEvidence,'速度と走行方向の根拠が必要です。');
  for(const load of ['empty','loaded'])for(const direction of directions)
    required(Number.isFinite(profile.straightMmPerSec?.[load]?.[direction])&&profile.straightMmPerSec[load][direction]>0,
      load+'/'+direction+'の直進速度は正の値が必要です。');
  for(const movement of movements)required(directions.includes(profile.defaultDirection?.[movement]),
    movement+'の車体前進／後進を指定してください。');
  if(profile.serviceApproachPolicy!=null)required(profile.serviceApproachPolicy==='fork-leading-entry'&&
    typeof profile.serviceApproachEvidence==='string'&&profile.serviceApproachEvidence,
    '荷役点の進入方式と根拠を指定してください。');
}

/** Existing bound terminal interfaces only; no inferred CAD access, turns or distances. */
function serviceApproaches(graph){
  const bound=new Set((graph.interfaceBindings??[]).map(binding=>binding.nodeId)),result=new Map();
  for(const node of graph.nodes){
    if(!bound.has(node.id)||!['pickup','dropoff'].includes(node.type))continue;
    const incident=graph.edges.filter(edge=>edge.fromNodeId===node.id||edge.toNodeId===node.id);
    const candidates=node.accessNodeId?incident.filter(edge=>[edge.fromNodeId,edge.toNodeId].includes(node.accessNodeId)):
      incident.length===1?incident:[];
    for(const edge of candidates){
      required(!result.has(edge.id)||result.get(edge.id).nodeId===node.id,
        edge.id+'が複数の荷役点へ直結しています。進入区間の明示が必要です。');
      result.set(edge.id,{nodeId:node.id,entryTraversal:edge.toNodeId===node.id?'forward':'reverse'});
    }
  }
  return result;
}

/** Keep chassis direction independent of a graph edge's from/to or lane direction. */
export function prepareVehicleTravel(scenario){
  const profile=scenario.vehicleTravelProfile;
  if(profile==null)return scenario; // Explicit legacy scenarios retain their saved speeds.
  validateVehicleTravelProfile(profile);
  if(scenario.motionModel!=='synthetic_graph')return scenario;
  required(scenario.operationalTopology?.edges,'走行グラフが必要です。');
  const nodes=new Map(scenario.operationalTopology.nodes.map(node=>[node.id,node]));
  const bound=new Set((scenario.operationalTopology.interfaceBindings??[]).map(binding=>binding.nodeId));
  const approaches=profile.serviceApproachPolicy==='fork-leading-entry'?serviceApproaches(scenario.operationalTopology):new Map();
  const edges=scenario.operationalTopology.edges.map(edge=>{
    const inherited=edge.vehicleServiceApproach;
    // Rebinding an interface invalidates derived approach metadata. Keep the
    // inherited side only for still-bound stops in an already split saved graph.
    const inheritedActive=inherited&&bound.has(inherited.nodeId);
    if(profile.serviceApproachPolicy==='fork-leading-entry'&&inheritedActive)required(
      ['forward','reverse'].includes(inherited.entryTraversal)&&
      ['pickup','dropoff'].includes(nodes.get(inherited.nodeId)?.type),
      edge.id+'の保存済み荷役進入区分が不正です。');
    const approach=approaches.get(edge.id)??(profile.serviceApproachPolicy==='fork-leading-entry'&&
      inheritedActive?inherited:null);
    const vehicleTravelByTraversal={};
    for(const traversal of ['forward','reverse']){
      vehicleTravelByTraversal[traversal]={};
      for(const movement of movements){
        const entering=approach&&traversal===approach.entryTraversal;
        const direction=approach?(entering?'reverse':'forward'):
          edge.vehicleDirectionOverrides?.[movement]??profile.defaultDirection[movement];
        required(directions.includes(direction),edge.id+'/'+movement+'の車体走行方向が不正です。');
        const limit=edge.vehicleSpeedLimitMmPerSec?.[movement];
        required(limit===undefined||Number.isFinite(limit)&&limit>0,edge.id+'/'+movement+'の区間速度制限が不正です。');
        const speed=profile.straightMmPerSec[movement==='loaded'?'loaded':'empty'][direction];
        vehicleTravelByTraversal[traversal][movement]={vehicleTravelDirection:direction,
          vehicleSpeedMmPerSec:limit===undefined?speed:Math.min(speed,limit),vehicleSpeedEvidence:profile.speedEvidence,
          vehicleDirectionEvidence:approach?profile.serviceApproachEvidence:profile.directionEvidence,
          ...(approach?{serviceNodeId:approach.nodeId,serviceMotionPhase:entering?'service-entry':'service-exit'}:{})};
      }
    }
    // The flat fields describe canonical from→to traversal for older consumers.
    // Routing must use the direction-specific fields in both traversal directions.
    const canonical=vehicleTravelByTraversal.forward;
    const speedMmPerSec=Object.fromEntries(movements.map(m=>[m,canonical[m].vehicleSpeedMmPerSec]));
    const vehicleTravelDirection=Object.fromEntries(movements.map(m=>[m,canonical[m].vehicleTravelDirection]));
    return {...edge,speedMmPerSec,vehicleTravelDirection,vehicleTravelByTraversal,
      vehicleServiceApproach:approach??null,vehicleSpeedEvidence:profile.speedEvidence};
  });
  return {...scenario,operationalTopology:{...scenario.operationalTopology,edges}};
}

export function vehicleStepFields(edge,movement,traversal='forward'){
  if(edge.vehicleTravelByTraversal?.[traversal]?.[movement])return {...edge.vehicleTravelByTraversal[traversal][movement]};
  const direction=edge.vehicleTravelDirection?.[movement];
  return direction?{vehicleTravelDirection:direction,vehicleSpeedMmPerSec:edge.speedMmPerSec[movement],
    vehicleSpeedEvidence:edge.vehicleSpeedEvidence}:{};
}

export const vehicleFrontHeading=(travelHeadingDeg,direction='forward')=>
  ((travelHeadingDeg+(direction==='reverse'?180:0))%360+360)%360;
export const forkHeading=frontHeadingDeg=>((frontHeadingDeg+180)%360+360)%360;
