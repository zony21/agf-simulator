import {warehouseRowPosition} from '../map/warehouse-row-order.mjs';

const requireSetting=(ok,message,details={})=>{if(!ok)throw Object.assign(new Error('WAREHOUSE_CONFIG: '+message),details);};
export const PRODUCT_TYPES=['normal','special'];
export const LOAD_TYPES=['full','partial'];
export const productOwner=p=>p.productType==='special'?'SPECIAL':p.sourceLineId;
/** Omitted rows and explicit unassigned entries are equally unavailable for products. */
export const warehouseRowOwner=assignment=>assignment?.usage==='special'?'SPECIAL':
  assignment?.usage==='normal'?assignment.sourceLineId:'UNASSIGNED';
export function validateProduct(p,lineIds){
  requireSetting(lineIds.includes(p.sourceLineId),'搬出元系列が未設定です。');
  requireSetting(PRODUCT_TYPES.includes(p.productType)&&LOAD_TYPES.includes(p.loadType),'普通／特注・満載／端数を指定してください。');
  return p;
}

/** User-entered symbolic allocation, never an inferred physical adjacency or row priority. */
export function validateWarehousePolicy(policy,slots,{lineIds,specialEnabled=false}){
  requireSetting(Array.isArray(policy?.rowAssignments),'行割当が未設定です。');
  const rows=new Map(),owners=new Map();
  for(const s of slots){
    requireSetting(s.blockId&&Number.isInteger(s.row)&&Number.isInteger(s.column)&&[1,2].includes(s.tier)&&s.capacity===1,
      '配置ルールにはブロック・行・列・段ごとの1PLロケーションが必要です。');
    requireSetting(!(s.blockId.startsWith('EB')&&s.column===10),'EB第10列は配置対象外です。');
    rows.set(s.rowId,{blockId:s.blockId,row:s.row});
  }
  const seen=new Set();
  for(const a of policy.rowAssignments){
    requireSetting(rows.has(a.rowId)&&!seen.has(a.rowId),'不明な行、または同じ行の重複割当です。');seen.add(a.rowId);
    if(a.usage==='unassigned'){
      requireSetting(!a.sourceLineId,'未割当行には系列を指定できません。');
      continue;
    }
    requireSetting(a.usage==='normal'||a.usage==='special','行の用途を指定してください。');
    const owner=warehouseRowOwner(a);
    requireSetting(owner==='SPECIAL'||lineIds.includes(owner),'行の系列が不明です。');
    const list=owners.get(owner)??[];list.push({...rows.get(a.rowId),rowId:a.rowId});owners.set(owner,list);
  }
  for(const id of lineIds)requireSetting(owners.has(id),`${id}に最低1行を割り当ててください。`);
  requireSetting(!specialEnabled||owners.has('SPECIAL'),'特注搬出を有効にするには特注用の行が必要です。');
  for(const [owner,assigned] of owners){
    // User-confirmed: one owner may use multiple blocks. Check gaps independently
    // within each allocation region; this does not establish physical connections.
    const regions=new Map();
    for(const row of assigned){const {group,index}=warehouseRowPosition(row),indices=regions.get(group)??[];
      indices.push(index);regions.set(group,indices);}
    for(const [group,indices] of regions){
      indices.sort((a,b)=>a-b);
      requireSetting(new Set(indices).size===indices.length&&indices.at(-1)-indices[0]+1===indices.length,
        `${owner}の領域が分断されています。同じブロック内、およびWB1 → 可変置き場 → WB2の連続範囲では途中行を飛ばせません。`,
        {warehouseAllocationGroup:group});
    }
    const priority=policy.rowPriority?.[owner];
    if(priority!==undefined)requireSetting(Array.isArray(priority)&&priority.length===assigned.length&&
      new Set(priority).size===priority.length&&priority.every(id=>assigned.some(a=>a.rowId===id)),
      `${owner}の行優先順位は割当行を重複なく指定してください。`);
  }
  return owners;
}

export function canUseUpper(lower,pallets){
  return lower?.palletIds.length===1&&pallets.get(lower.palletIds[0])?.loadType==='full';
}

/** Reservations never act as physical lower-tier support. Rows are ordered only by explicit input. */
export function chooseWarehouseLocation({pallet,policy,slots,pallets,rowBusy}){
  const owner=productOwner(pallet),assigned=policy.rowAssignments.filter(a=>warehouseRowOwner(a)===owner);
  if(!assigned.length)return {location:null,reason:'NO_ASSIGNED_STORAGE'};
  const priority=assigned.length===1?[assigned[0].rowId]:policy.rowPriority?.[owner];
  if(!priority)return {location:null,reason:'ROW_PRIORITY_UNRESOLVED'};
  let busy=false,permission=false,shipping=false;
  for(const rowId of priority){
    if(rowBusy.has(rowId)){busy=true;if([...slots.values()].some(s=>s.rowId===rowId&&s.shippingJobId))shipping=true;continue;}
    const row=[...slots.values()].filter(s=>s.rowId===rowId&&s.storageEnabled!==false);
    const cols=[...new Set(row.map(s=>s.column))].sort((a,b)=>row[0].blockId.startsWith('WB')?a-b:b-a);
    for(const column of cols){
      const lower=row.find(s=>s.column===column&&s.tier===1),upper=row.find(s=>s.column===column&&s.tier===2);
      if(!lower)continue;
      const candidate=!lower.palletIds.length?lower:canUseUpper(lower,pallets)?upper:null;
      if(!candidate||candidate.palletIds.length||candidate.reserved.length)continue;
      if(candidate.permission===false){permission=true;continue;}
      return {location:candidate,reason:null};
    }
  }
  return {location:null,reason:shipping?'WAREHOUSE_SHIPPING':busy?'SAME_ROW_ACTIVE':permission?'LOCATION_PERMISSION':'ASSIGNED_STORAGE_FULL'};
}

export function validateStoredPallets(slots,pallets,policy,lineIds){
  const seen=new Set();
  for(const s of slots.values())for(const id of s.palletIds){
    requireSetting(!seen.has(id),'初期在庫のパレットIDが重複しています。');seen.add(id);
    const p=pallets.get(id);requireSetting(p,'初期在庫のパレット属性がありません。');validateProduct(p,lineIds);
    const assignment=policy.rowAssignments.find(a=>a.rowId===s.rowId);
    requireSetting(assignment&&productOwner(p)===warehouseRowOwner(assignment),'初期在庫と行用途が一致しません。');
    if(s.tier===2)requireSetting(canUseUpper([...slots.values()].find(l=>l.rowId===s.rowId&&l.column===s.column&&l.tier===1),pallets),
      '2段目の初期在庫には配置済みの満載1段目が必要です。');
  }
}

/** Future capacity range: unknown future full/partial mix cannot yield one exact capacity. */
export function warehouseAvailability(slots,pallets,policy=null){
  let occupied=0,reserved=0,blockedUpper=0,immediatelyPlaceable=0,additionalIfFull=0,additionalIfPartial=0;
  const assignedRows=policy?new Set(policy.rowAssignments.filter(a=>warehouseRowOwner(a)!=='UNASSIGNED').map(a=>a.rowId)):null;
  const enabled=[...slots.values()].filter(s=>s.storageEnabled!==false);
  const flexible=[...slots.values()].filter(s=>s.flexibleAreaId);
  const assignedCapacity=assignedRows?enabled.filter(s=>assignedRows.has(s.rowId)).length:enabled.length;
  for(const s of slots.values()){
    occupied+=s.palletIds.length;reserved+=s.reserved.length;
    if(s.tier!==1)continue;
    if(assignedRows&&!assignedRows.has(s.rowId))continue;
    const upper=[...slots.values()].find(u=>u.rowId===s.rowId&&u.column===s.column&&u.tier===2);
    const lowerFull=canUseUpper(s,pallets),lowerPartial=s.palletIds.length&&!lowerFull;
    const available=slot=>slot&&slot.storageEnabled!==false&&slot.permission!==false&&!slot.shippingJobId&&!slot.palletIds.length&&!slot.reserved.length;
    if(lowerPartial)blockedUpper++;
    if(available(s)){immediatelyPlaceable++;additionalIfFull+=1+(available(upper)?1:0);additionalIfPartial++;}
    else if(lowerFull&&available(upper)){immediatelyPlaceable++;additionalIfFull++;additionalIfPartial++;}
  }
  return {theoretical:slots.size-flexible.length,assignedCapacity,unassignedCapacity:enabled.length-assignedCapacity,
    ...(flexible.length?{flexibleFloorLocations:flexible.length,flexibleUsableLocations:flexible.filter(s=>s.storageEnabled!==false).length,
      upperTierStatus:'unresolved',modeCapacity:enabled.length}:{}),
    occupied,reserved,blockedUpper,immediatelyPlaceable,additionalIfFull,additionalIfPartial};
}
