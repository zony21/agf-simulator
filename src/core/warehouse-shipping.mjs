import {canUseUpper} from './warehouse-policy.mjs';

const requireSetting=(ok,message)=>{if(!ok)throw new Error('SHIPPING_CONFIG: '+message);};
/** User-confirmed row shipment / two-tier load; times and fleet size are explicit assumptions. */
export const DEFAULT_WAREHOUSE_SHIPPING=Object.freeze({enabled:true,cycleMin:2,forkliftCount:1,loadCapacityPL:2,
  policyEvidence:'user-confirmed-full-row-two-tier-shipment',timeEvidence:'provisional-round-trip-assumption',
  resourceEvidence:'provisional-one-manned-forklift'});

export function validateWarehouseShipping(config,{warehousePolicy}={}){
  if(config===undefined)return;
  requireSetting(config&&typeof config.enabled==='boolean','出荷の有効／無効を指定してください。');
  if(!config.enabled)return;
  requireSetting(warehousePolicy,'出荷には倉庫の系列行割当が必要です。');
  requireSetting(Number.isFinite(config.cycleMin)&&Math.round(config.cycleMin*60000)>0,
    '有人フォークの1往復時間は正の分で指定してください。');
  requireSetting(Number.isInteger(config.forkliftCount)&&config.forkliftCount>0,'有人フォーク台数は正整数で指定してください。');
  requireSetting(config.loadCapacityPL===2,'1回の出荷は同じ列の上下最大2PLです。');
}

/** No forklift paths or physical interference are inferred. Only the target row is locked. */
export function createWarehouseShipping({config,policy,slots,pallets,rowBusy,now,record,schedule,dirtySlots}){
  if(!config?.enabled)return null;
  const rows=new Map(),jobs=[],byLine={},forklifts=Array.from({length:config.forkliftCount},(_,i)=>({id:'MANNED-FORK'+(i+1),job:null}));
  for(const slot of slots.values())if(slot.storageEnabled!==false){
    const own=rows.get(slot.rowId)??[];own.push(slot);rows.set(slot.rowId,own);
  }
  const assigned=new Set(policy.rowAssignments.filter(a=>a.usage!=='unassigned').map(a=>a.rowId));
  const active=new Map();let shippedPL=0,nextId=0,savedSnapshot=null;
  const snapshot=()=>savedSnapshot??=Object.freeze({shippedPL,byLine:Object.freeze({...byLine}),jobs:Object.freeze(jobs.map(j=>Object.freeze({...j,
    palletIds:Object.freeze([...j.palletIds]),batches:Object.freeze(j.batches.map(b=>Object.freeze({slotIds:Object.freeze([...b.slotIds]),
      palletIds:Object.freeze([...b.palletIds])})))})))});
  const event=(type,job,fields={})=>{
    savedSnapshot=null;
    record(type,{shipmentId:job.id,rowId:job.rowId,forkliftId:job.forkliftId,
      cycleMin:config.cycleMin,timeEvidence:config.timeEvidence??'explicit-scenario-assumption',...fields});
  };
  const startAvailable=()=>{
    for(const forklift of forklifts){
      if(forklift.job)continue;
      const job=jobs.find(j=>j.status==='queued');if(!job)break;
      forklift.job=job.id;job.forkliftId=forklift.id;job.status='shipping';job.startedAt=now();
      event('WAREHOUSE_SHIPMENT_STARTED',job,{palletIds:[...job.palletIds],quantity:job.palletIds.length,
        trips:job.batches.length,plannedEndMs:now()+job.batches.length*Math.round(config.cycleMin*60000)});
      schedule(now()+Math.round(config.cycleMin*60000),'WAREHOUSE_SHIPMENT_TRIP',{shipmentId:job.id,batchIndex:0});
    }
  };
  const refresh=()=>{
    for(const [rowId,own] of rows){
      if(!assigned.has(rowId)||active.has(rowId)||rowBusy.has(rowId)||own.some(s=>s.reserved.length))continue;
      const lowers=own.filter(s=>s.tier===1).sort((a,b)=>a.blockId.startsWith('EB')?b.column-a.column:a.column-b.column);
      if(!lowers.length)continue;
      const batches=[];let full=true;
      for(const lower of lowers){
        const upper=own.find(s=>s.column===lower.column&&s.tier===2);
        if(!lower.palletIds.length||(upper&&!upper.palletIds.length&&canUseUpper(lower,pallets))){full=false;break;}
        const stack=[lower,...(upper?.palletIds.length?[upper]:[])];
        batches.push({slotIds:stack.map(s=>s.id),palletIds:stack.flatMap(s=>s.palletIds)});
      }
      if(!full)continue;
      const job={id:'SHIP'+String(++nextId).padStart(5,'0'),rowId,status:'queued',requestedAt:now(),startedAt:null,
        completedAt:null,forkliftId:null,batches,palletIds:batches.flatMap(b=>b.palletIds),nextBatch:0,shippedPL:0};
      jobs.push(job);active.set(rowId,job.id);rowBusy.add(rowId);
      for(const slot of own){slot.shippingJobId=job.id;dirtySlots.add(slot.id);}
      event('WAREHOUSE_SHIPMENT_QUEUED',job,{quantity:job.palletIds.length,trips:batches.length});
    }
    startAvailable();
  };
  const handle=e=>{
    const job=jobs.find(j=>j.id===e.shipmentId);
    requireSetting(job?.status==='shipping'&&job.nextBatch===e.batchIndex,'出荷イベントの順序または重複が不正です。');
    const batch=job.batches[job.nextBatch],sourceLineCounts={};
    for(const id of batch.palletIds){
      const p=pallets.get(id),slot=batch.slotIds.map(id=>slots.get(id)).find(s=>s.palletIds.includes(id));
      requireSetting(p?.stage==='stored'&&slot&&slot.reserved.length===0&&slot.shippingJobId===job.id,'出荷対象の在庫または行排他が不正です。');
      slot.palletIds.splice(slot.palletIds.indexOf(id),1);dirtySlots.add(slot.id);
      p.stage='shipped';p.shippedAt=now();p.shipmentId=job.id;
      const line=p.sourceLineId??p.lineId;
      requireSetting(!!line,'出荷実績には搬出元系列が必要です。');
      sourceLineCounts[line]=(sourceLineCounts[line]??0)+1;byLine[line]=(byLine[line]??0)+1;
    }
    job.nextBatch++;job.shippedPL+=batch.palletIds.length;shippedPL+=batch.palletIds.length;
    event('WAREHOUSE_SHIPMENT_PICKED',job,{palletIds:[...batch.palletIds],locationIds:[...batch.slotIds],
      sourceLineCounts,...(Object.keys(sourceLineCounts).length===1?{sourceLineId:Object.keys(sourceLineCounts)[0]}:{}),
      quantity:batch.palletIds.length,batchIndex:e.batchIndex});
    if(job.nextBatch<job.batches.length){
      schedule(now()+Math.round(config.cycleMin*60000),'WAREHOUSE_SHIPMENT_TRIP',{shipmentId:job.id,batchIndex:job.nextBatch});
    }else{
      job.status='completed';job.completedAt=now();active.delete(job.rowId);rowBusy.delete(job.rowId);
      for(const slot of rows.get(job.rowId)){delete slot.shippingJobId;dirtySlots.add(slot.id);}
      forklifts.find(f=>f.id===job.forkliftId).job=null;
      event('WAREHOUSE_SHIPMENT_COMPLETED',job,{quantity:job.shippedPL,trips:job.batches.length});
      startAvailable();
    }
  };
  return {refresh,handle,snapshot};
}
