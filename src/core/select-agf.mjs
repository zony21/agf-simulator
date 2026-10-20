/** Deterministic selector. Existing destination-area and low-battery rules are retained. */
export function selectAgf(agfs, task, options) {
  return selectAgfWithReason(agfs,task,options).agf;
}

/** Record the decision from the same candidate set used by the selector.
 * Battery and areas are copied before assignment mutates the live vehicles. */
export function selectAgfWithReason(agfs, task, {mode,reservePct,taskStartPct,agfPriorities,fallback='wait'}) {
  const modes=['area_first','low_battery_first','source_area_agf_priority'];
  if(!modes.includes(mode))throw new Error('Unknown mode');
  if(!Number.isFinite(reservePct))throw new Error('reservePct must be specified');
  if(taskStartPct!==undefined&&(!Number.isFinite(taskStartPct)||taskStartPct<0||taskStartPct>100))
    throw new Error('taskStartPct must be between 0 and 100');
  if(!task||typeof task.destinationArea!=='string'||!task.destinationArea)throw new Error('destinationArea required');
  if(mode==='source_area_agf_priority'&& (typeof task.originArea!=='string'||!task.originArea))
    throw new Error('originArea required for source-area AGF-priority mode');
  if(!['wait','any'].includes(fallback))throw new Error('Unknown fallback');
  if(mode==='source_area_agf_priority'){
    if(!agfPriorities||typeof agfPriorities!=='object'||
      agfs.some(a=>!Number.isInteger(agfPriorities[a.id])||agfPriorities[a.id]<1||agfPriorities[a.id]>99))
      throw new Error('agfPriorities must assign every AGF a positive integer');
  }
  const evaluations=agfs.map(a=>({agfId:a.id,area:a.area,batteryPct:a.batteryPct,status:a.status,blocked:!!a.blocked,
    eligible:false,vehicleEligible:false,exclusionReason:null,selected:false,evaluationStatus:'evaluated'}));
  const eligible=agfs.filter((a,index)=>{
    const evaluation=evaluations[index];
    if(a.status!=='idle')evaluation.exclusionReason='STATUS_NOT_AVAILABLE';
    else if(a.blocked)evaluation.exclusionReason='BLOCKED';
    else if(!Number.isFinite(a.batteryPct))evaluation.exclusionReason='BATTERY_INVALID';
    else if(taskStartPct!==undefined&&a.batteryPct<taskStartPct)evaluation.exclusionReason='BATTERY_TASK_START';
    else if(a.batteryPct<=reservePct)evaluation.exclusionReason='BATTERY_RESERVE';
    else evaluation.eligible=evaluation.vehicleEligible=true;
    return evaluation.eligible;
  });
  const ids=values=>values.map(a=>a.id).sort((a,b)=>String(a).localeCompare(String(b),'en'));
  evaluations.sort((a,b)=>String(a.agfId).localeCompare(String(b.agfId),'en'));
  const stages=[{stage:'vehicle_eligibility',eligibleAgfIds:ids(eligible),
    excluded:evaluations.filter(e=>!e.eligible).map(e=>({agfId:e.agfId,exclusionReason:e.exclusionReason}))}];
  let candidates=eligible,basis='all_areas',areaValue=null;
  if(mode==='area_first'){
    areaValue=task.destinationArea;
    const local=eligible.filter(a=>a.area===areaValue);
    if(local.length){candidates=local;basis='destination_area';}
    else if(fallback==='wait'){candidates=[];basis='destination_area_wait';}
    else basis='cross_area_fallback';
  }else if(mode==='source_area_agf_priority'){
    areaValue=task.originArea;
    const local=eligible.filter(a=>a.area===areaValue);
    if(local.length){candidates=local;basis='source_area';}
    else if(fallback==='wait'){candidates=[];basis='source_area_wait';}
    else basis='cross_area_fallback';
  }
  const candidateIds=new Set(candidates.map(a=>a.id));
  for(const evaluation of evaluations)if(evaluation.eligible&&!candidateIds.has(evaluation.agfId)){
    evaluation.eligible=false;
    evaluation.exclusionReason=basis.endsWith('_wait')?'AREA_FALLBACK_DISABLED':'AREA_NOT_PRIORITIZED';
  }
  stages.push({stage:'area',basis,area:areaValue,eligibleAgfIds:ids(candidates),
    excluded:evaluations.filter(e=>e.vehicleEligible&&!e.eligible).map(e=>({agfId:e.agfId,exclusionReason:e.exclusionReason}))});
  if(mode==='source_area_agf_priority'){
    candidates.sort((a,b)=>agfPriorities[a.id]-agfPriorities[b.id]||
      String(a.id).localeCompare(String(b.id),'en'));
  }else candidates.sort((a,b)=>a.batteryPct-b.batteryPct||String(a.id).localeCompare(String(b.id),'en'));
  const agf=candidates[0]??null;
  const rank=mode==='source_area_agf_priority'?agfPriorities[agf?.id]:null;
  const tied=agf?candidates.filter(candidate=>mode==='source_area_agf_priority'?
    agfPriorities[candidate.id]===rank:candidate.batteryPct===agf.batteryPct):[];
  if(agf)evaluations.find(e=>e.agfId===agf.id).selected=true;
  const rankingStage=mode==='source_area_agf_priority'?
    {stage:'agf_priority',rankedAgfIds:candidates.map(a=>a.id),priorities:Object.fromEntries(candidates.map(a=>[a.id,agfPriorities[a.id]])),
      selectedAgfId:agf?.id??null}:
    {stage:'battery',eligibleAgfIds:tied.map(a=>a.id),rankedAgfIds:candidates.map(a=>a.id)};
  stages.push(rankingStage,{stage:'id_tie_break',eligibleAgfIds:tied.map(a=>a.id),selectedAgfId:agf?.id??null,
    evidence:tied.length>1?'synthetic-model-tiebreak':null});
  return {agf:agf??null,selection:{mode,destinationArea:task.destinationArea,
    ...(mode==='source_area_agf_priority'?{sourceArea:task.originArea,agfPriorities:{...agfPriorities},
      selectedAgfPriority:rank??null}:{}),selectedArea:agf?.area??null,
    selectedAgfId:agf?.id??null,selectedBatteryPct:agf?.batteryPct??null,reservePct,
    ...(taskStartPct!==undefined?{taskStartPct}:{}),fallback,basis,
    eligibleAgfIds:eligible.map(candidate=>candidate.id).sort((a,b)=>String(a).localeCompare(String(b),'en')),
    candidates:candidates.map(candidate=>({agfId:candidate.id,area:candidate.area,batteryPct:candidate.batteryPct,
      ...(mode==='source_area_agf_priority'?{priority:agfPriorities[candidate.id]}:{})})),
    tieBreak:tied.length>1?'agf_id':'none',tieBreakEvidence:tied.length>1?'synthetic-model-tiebreak':null,
    evaluations,stages}};
}
