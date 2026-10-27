import {escapeHtml as esc,locationName} from './format.mjs';
import {warehouseRouteName} from '../map/warehouse-routing.mjs';

export const LINE_LABELS=['GWI','GWII','GWIII','GWIV','GWV','GWVI','GWVII','GWVIII'];
export const selectionLabel=mode=>({area_first:'搬送先エリア優先',low_battery_first:'バッテリー残量優先',
  source_area_agf_priority:'荷受け元エリア優先・AGF順位'}[mode]??'選定方式未設定');
export const evidenceLabel=evidence=>({
  'provisional-derived':'暫定値・カタログから導出（停止旋回の実測値ではありません）',
  'provisional-simulation':'暫定シミュレーション値',
  'provisional-round-trip-assumption':'有人フォーク1往復の暫定仮定・実測値ではありません',
  'provisional-one-manned-forklift':'有人フォーク台数の暫定仮定',
  'user-confirmed-full-row-two-tier-shipment':'ユーザー確認済み・満載行を最大上下2PLで出荷',
  'explicit-scenario-assumption':'この実行で指定した仮定',
  'synthetic-assumption':'合成モデルの仮定','synthetic':'合成条件',
  'private-dxf-proportions-provisional':'非公開図面の相対寸法に基づく暫定モデル・実測距離未確認',
  'unresolved':'未確定','unconfigured':'未設定','user-confirmed':'確認済み',
  'user-confirmed-neutral-start':'確認済みの初期条件',
  'user-confirmed-all-empty-auto':'ユーザー確認済み・全機が空の時に自動装填',
  'provisional-same-timestamp-event':'同一時刻の暫定モデル・実測装填時間ではありません',
  'supplier-assumption-user-relayed':'供給元の想定・ユーザー共有',
  'theoretical-pallet-discharge-100pct':'設備能力100%の理論タクト',
  'explicit-scenario-setting':'この実行の明示条件',
  'simulation-default-task-priorities':'シミュレーション初期設定（変更可能）',
  'user-requested-example-default':'ユーザー指定の初期行割当・既存例と同じ値',
  'user-confirmed-fixed-magazine-mapping':'ユーザー確認済み・固定対応',
  'user-confirmed-task-start-threshold':'ユーザー確認済み・新規タスク開始60%',
  'user-confirmed-charge-recovery-target':'ユーザー確認済み・充電後60%で搬送復帰',
  'user-confirmed-initial-ranking':'ユーザー確認済み・AGF優先順位の初期値',
  'user-confirmed-initial-logical-direction-policy':'確認済みのシミュレーション初期通行方針'
})[evidence]??(String(evidence??'').includes('legacy')?'旧回帰モデルの条件':'この実行の設定・仮定');

export function customerLocationName(id){
  if(!id)return '未設定';
  if(/^L[1-8]$/.test(id))return LINE_LABELS[Number(id.slice(1))-1]+' パレタイザ';
  const flex=/^WB1-WB2-FLEX-R(\d+)-C(\d+)-T1$/.exec(id);
  if(flex)return `WB1・WB2間可変領域 ${Number(flex[1])}行 ${Number(flex[2])}列（平面位置）`;
  const pgw=/^PZ-L([1-8])-PICKUP$/.exec(id);if(pgw)return 'PGW'+pgw[1]+'前';
  const slot=/^(WB[1-3]|EB[12])-R(\d+)-C(\d+)-T([12])$/.exec(id);
  if(slot)return ({WB1:'西側1',WB2:'西側2',WB3:'西側3',EB1:'東側1',EB2:'東側2'})[slot[1]]+` ${Number(slot[2])}行 ${Number(slot[3])}列 ${slot[4]}段`;
  const known=locationName(id);return known!==id||['HP1','HP2'].includes(id)?known:'位置未確定';
}
const productLabel=(type,load)=>(type==='special'?'特注':'普通銘柄')+'・'+(load==='partial'?'端数':'満載');
const rowValue=row=>row.value===null?'未設定':typeof row.value==='boolean'?(row.value?'あり':'なし'):String(row.value);

/** Customer-facing projection reads only the stored scenario, never settings controls. */
export function customerConditionRows(run){
  const s=run.scenario,rows=[];
  if(!s)throw new Error('Saved scenario required');
  const add=(key,category,label,value,unit='',target='',source='explicit-scenario-setting')=>
    rows.push({key,category,label,target,value:value??null,unit,evidence:evidenceLabel(source)});
  add('duration','基本条件','シミュレーション時間',s.durationMin,'分');
  add('agf.count','基本条件','AGF台数',s.agfs?.length??0,'台');
  add('charger.count','基本条件','充電器台数',s.chargerIds?.length??0,'台');
  add('warehouse.capacity','基本条件','既存保管ブロックの理論容量',(s.warehouse??[]).filter(slot=>!slot.flexibleAreaId).reduce((n,slot)=>n+(slot.capacity??1),0),'PL');
  if(s.warehouseRouteMode){
    add('warehouse.routeMode','基本条件','倉庫走行モード',warehouseRouteName(s.warehouseRouteMode));
    add('warehouse.shutter','交通条件','使用するWH外周シャッター',s.warehouseRouteMode==='detour'?'WH西SH':'WH東SH');
    add('warehouse.pzRoles','交通条件','PZの進入／退出',s.warehouseRouteMode==='detour'?'PZ出口SHから進入／PZ入口SHから退出':'PZ入口SHから進入／PZ出口SHから退出');
    add('warehouse.flexible','倉庫条件','WB1・WB2間',s.warehouseRouteMode==='detour'?'1車線通路・26平面位置は保管禁止':'2行×13列・26平面ロケーション（上段未確定）');
    add('warehouse.westLanes','交通条件','WB1西側通路','2車線・各レーン方向と実停止位置は未確定');
    add('warehouse.portalCapacity','交通条件','WH外周SH通過','2台並列可・対向同時通過は未確定（合成モデルは対向待機）');
  }
  add('warehouse.initialStock','基本条件','初期製品在庫',(s.warehouse??[]).reduce((n,slot)=>n+(slot.palletIds?.length??0),0),'PL');
  if(s.warehouseShipping){
    const c=s.warehouseShipping;
    add('shipping.enabled','有人フォーク出荷','満載行の自動出荷',c.enabled,'','','user-confirmed-full-row-two-tier-shipment');
    add('shipping.cycleMin','有人フォーク出荷','荷受け・運搬・荷下ろし・戻りの1往復',c.cycleMin,'分','',c.timeEvidence);
    add('shipping.forkliftCount','有人フォーク出荷','有人フォーク台数',c.forkliftCount,'台','',c.resourceEvidence);
    add('shipping.loadCapacityPL','有人フォーク出荷','同じ列の上下をまとめて運ぶ上限',c.loadCapacityPL,'PL','','user-confirmed-full-row-two-tier-shipment');
    add('shipping.lock','有人フォーク出荷','出荷中の入庫','行全体の出荷完了まで予約・入庫不可','','','user-confirmed-full-row-two-tier-shipment');
  }
  add('mode','基本条件','AGF選定方式',selectionLabel(s.mode));
  add('agfPriority.applied','AGF選定条件','AGF個別順位を選定に適用',s.mode==='source_area_agf_priority');
  for(const agf of s.agfs??[])if(s.agfPriorities?.[agf.id]!==undefined)
    add('agfPriority.'+agf.id,'AGF選定条件','個別優先順位（新方式で使用）',s.agfPriorities[agf.id],'',agf.id,s.evidence?.agfPriorities);
  if(s.taskPriorities===undefined){
    add('taskPriorities.policy','搬送タスク優先度','自動搬送の割当順','旧シナリオ互換（要求順・legacy FIFO）','','','legacy-model');
  }else{
    const source=s.evidence?.taskPriorities??'explicit-scenario-setting';
    add('taskPriorities.wrapperOutput','搬送タスク優先度','優先度',s.taskPriorities?.wrapperOutput,'','包装機出口',source);
    for(let i=1;i<=5;i++)add('taskPriorities.magazines.M'+i,'搬送タスク優先度','優先度',s.taskPriorities?.magazines?.['M'+i],'','M'+i,source);
    for(let i=1;i<=8;i++)add('taskPriorities.lines.L'+i,'搬送タスク優先度','優先度',s.taskPriorities?.lines?.['L'+i],'','L'+i,source);
  }
  if(s.taskPriorities!==undefined||s.taskDispatchPolicy!==undefined){
    add('taskDispatchPolicy','搬送タスク割当ルール','優先タスクの実行待ち',s.taskDispatchPolicy==='strict_priority_head'?
      '先頭タスクが実行できない場合は後続タスクも割当保留。同優先度の搬送01同士は現在の系列バッファ在荷数が多い順、同数は要求時刻・処理順。その他の同優先度は要求時刻・処理順。':
      '割当待機ルールの保存記録なし','','','saved-run');
  }
  const graph=s.motionModel==='synthetic_graph';
  if(graph&&s.operationalTopology?.metricLayoutProfile){
    const profile=s.operationalTopology.metricLayoutProfile;
    add('map.unit','AGF走行条件','座標・区間距離の単位','mm','','',profile.evidence);
    add('map.profile','AGF走行条件','縮尺モデル',profile.sourceKind==='private-dxf-proportions'?'非公開図面の相対寸法を反映':'架空mmモデル','','',profile.evidence);
    add('map.scaleVerified','AGF走行条件','実寸・停止位置の照合','未確認','','',profile.evidence);
  }
  add('motion.model','基本条件','走行時間の根拠',graph?'合成経路の距離・速度から計算':'設定した固定移動時間');
  if(s.lineMagazineMapPolicy)add('line.magazinePolicy','系列の搬出条件','系列・マガジン対応',s.lineMagazineMapPolicy==='fixed'?'固定対応':'検証シナリオの明示対応','','',s.evidence?.lineMagazineMap);
  for(let i=0;i<8;i++){
    const lineId='L'+(i+1),target=LINE_LABELS[i],streams=s.productStreams?.filter(stream=>stream.sourceLineId===lineId&&stream.enabled);
    add('line.'+lineId+'.magazine','系列の搬出条件','使用マガジン',s.lineMagazineMap?.[lineId]?customerLocationName(s.lineMagazineMap[lineId]):null,'',target,s.evidence?.lineMagazineMap);
    if(streams){
      if(!streams.length){add('line.'+lineId+'.disabled','系列の搬出条件','搬出対象','停止','',target);continue;}
      for(const stream of streams){
        const label=productLabel(stream.productType,stream.loadType),key='line.'+lineId+'.'+stream.productType+'.'+stream.loadType;
        add(key+'.interval','系列の搬出条件',label+' 搬出間隔',stream.intervalMin,'分/PL',target,s.evidence?.production);
        add(key+'.hourly','系列の搬出条件',label+' 1時間換算',stream.intervalMin>0?Number((60/stream.intervalMin).toFixed(2)):null,'PL/h',target,s.evidence?.production);
        add(key+'.offset','系列の搬出条件',label+' 初回ずらし',stream.startOffsetMin,'分',target,s.evidence?.productionOffsets);
      }
    }else{
      const interval=s.lineIntervalsMin?.[i];
      add('line.'+lineId+'.interval','系列の搬出条件','搬出間隔',s.productionEvents?'時刻指定入力':interval>0?interval:'停止',s.productionEvents||!(interval>0)?'':'分/PL',target,s.evidence?.production);
      add('line.'+lineId+'.hourly','系列の搬出条件','1時間換算',!s.productionEvents&&interval>0?Number((60/interval).toFixed(2)):null,'PL/h',target,s.evidence?.production);
      add('line.'+lineId+'.type','系列の搬出条件','搬出対象',interval>0?'普通銘柄・満載':'停止','',target,s.evidence?.production);
      add('line.'+lineId+'.offset','系列の搬出条件','初回ずらし',s.lineStartOffsetsMin?.[i],'分',target,s.evidence?.productionOffsets);
    }
  }
  for(const [movement,label] of [['empty','空荷走行速度'],['loaded','積載走行速度'],['charge','充電場所への走行速度'],['wait','待機場所への復帰速度']]){
    if(graph){
      const speeds=[...new Set((s.operationalTopology?.edges??[]).map(edge=>edge.speedMmPerSec?.[movement]).filter(Number.isFinite))].sort((a,b)=>a-b).map(value=>value/1000);
      add('speed.'+movement,'AGF走行条件',label,speeds.length===1?speeds[0]:speeds.length?speeds.join(' / '):null,'m/s','','synthetic-assumption');
    }else if(movement!=='wait')add('travel.'+movement,'AGF走行条件',label.replace('速度','固定移動時間'),s.times?.[{empty:'emptyMin',loaded:'loadedMin',charge:'chargeTravelMin'}[movement]],'分');
  }
  const control=s.motionControl??{};
  if(graph){
    for(const [key,label,unit] of [['turnRateDegPerSec','等価旋回角速度','deg/s'],['pickupPositioningMin','荷受け姿勢への移行','分'],
      ['pickupForkInsertedMin','フォーク挿入後の荷受け','分'],['dropoffPositioningMin','荷下ろし姿勢への移行','分'],['dropoffForkInsertedMin','フォーク挿入後の荷下ろし','分']])
      add('motion.'+key,'旋回・荷役条件',label,control[key],unit,'',key==='turnRateDegPerSec'?control.turnRateEvidence:control.handlingEvidence);
  }else for(const [key,label] of [['pickupMin','荷受け時間'],['dropoffMin','荷下ろし時間']])add('motion.'+key,'旋回・荷役条件',label,s.times?.[key],'分');
  for(const [key,label] of [['wrapMin','包装処理時間'],['labelMin','ラベル処理時間'],['exitMin','排出準備時間']])add('wrapper.'+key,'包装機・工程条件',label,s.times?.[key],'分');
  if(graph)for(const [id,label,key] of [['WRAP-INPUT','入口の荷下ろし停止点数','input'],['WRAP-OUTPUT','出口の荷受け停止点数','output']])
    add('wrapper.'+key+'StopCount','包装機・工程条件',label,(s.operationalTopology?.nodes??[]).filter(node=>node.interfaceId===id).length,'か所','','synthetic-assumption');
  for(const [key,label] of [['inputCapacity','投入容量'],['outputCapacity','排出側保持容量']])add('wrapper.'+key,'包装機・工程条件',label,s.wrapper?.[key],'PL');
  if(s.wrapper?.conveyorCapacity!==undefined)add('wrapper.conveyorCapacity','包装機・工程条件','内部コンベア保持容量（処理中を含む）',s.wrapper.conveyorCapacity,'PL','','user-confirmed');
  for(const a of s.agfs??[]){
    add('agf.'+a.id+'.position','初期配置・バッテリー','初期位置',customerLocationName(a.currentNodeId),'',a.id);
    add('agf.'+a.id+'.battery','初期配置・バッテリー','初期バッテリー',a.batteryPct,'%',a.id);
  }
  for(const [key,label,unit] of [['chargeStartPct','充電開始閾値','%'],['chargeTargetPct','充電後の搬送復帰閾値','%'],['chargeMinPerPct','1ポイントの充電時間','分']])
    if(s.battery?.[key]!==undefined)add('battery.'+key,'バッテリー・充電条件',label,s.battery?.[key],unit,'',key==='chargeTargetPct'?s.evidence?.chargeTargetPct:undefined);
  const battery=s.battery??{};
  add('battery.basis','バッテリー・充電条件','消費基準',battery.consumptionModel==='active_time'?`${battery.activeReferenceMin}分の走行・荷役で${battery.activeReferenceConsumptionPct}ポイント`:`1搬送あたり${battery.consumptionPct}ポイント`,'','',s.evidence?.batteryConsumption);
  add('battery.turning','バッテリー・充電条件','旋回中の電池消費',control.turningConsumesBattery,'','',control.turningBatteryEvidence);
  for(const m of s.magazines??[])add('magazine.'+m.id,'設備初期状態','空パレット',m.quantity,'枚',customerLocationName(m.id),s.evidence?.inventory);
  for(const a of s.aligners??[])add('aligner.'+a.id,'設備初期状態','装填枚数',a.quantity??(a.ready?10:0),'枚',customerLocationName(a.id),s.evidence?.inventory);
  const autoRefill=s.alignerRefillPolicy==='all_empty_auto';
  add('aligner.refillPolicy','空パレット補充条件','整列機の装填ルール',
    autoRefill?'全5台が0枚になった時に全機10枚へ自動装填':'手動補充','','',
    s.alignerRefillPolicy===undefined?'legacy-model':s.evidence?.alignerRefillPolicy??'explicit-scenario-setting');
  if(autoRefill)add('aligner.refillTiming','空パレット補充条件','自動装填時間の扱い',
    '装填時間未確定・モデル上は同一時刻','','',s.evidence?.alignerRefillTiming??'provisional-same-timestamp-event');
  const traffic=s.operationalTopology?.trafficPolicy;
  const direction=value=>({west_to_east:'西→東',east_to_west:'東→西',north_to_south:'上→下',south_to_north:'下→上',both:'双方向'})[value]??'未設定';
  if(traffic){
    add('traffic.pz','交通条件','パレタイズのレーン方向',`南側：${direction(traffic.pz?.south)} / 北側：${direction(traffic.pz?.north)}`,'','',traffic.evidence);
    add('traffic.pz.space','交通条件','パレタイズの走行空間',traffic.pz?.physicalSeparation===false?'同一走行空間を2レーンとして制御':traffic.pz?.physicalSeparation===true?'物理的に分離':'未設定','','',traffic.evidence);
    add('traffic.warehouse','交通条件','倉庫主通路の方向',`保管ブロック側：${direction(traffic.warehouse?.blockSide)} / 中央壁側：${direction(traffic.warehouse?.wallSide)}`,'','',traffic.evidence);
    add('traffic.row','交通条件','倉庫の保管行',`${direction(traffic.rowDirection)} / ${traffic.rowLaneCount??'未設定'}車線`,'','',traffic.evidence);
    add('traffic.noOvertaking','交通条件','同方向の追い越し',traffic.sameDirectionOvertaking==='forbidden'?'通常禁止・包装機入口待ちの明示例外のみ':'保存した区間の通過条件を使用','','',traffic.evidence);
    add('traffic.conflict','交通条件','通路競合時',traffic.defaultConflictResolution==='stop-before-entry'?'占有中のAGFを優先・後続は手前停止':'保存した通行予約条件を使用','','',traffic.evidence);
  }else{
    const edges=s.operationalTopology?.edges??[],pz=edges.filter(edge=>String(edge.noOvertakingGroupId??'').startsWith('PZ-'));
    add('traffic.pz','交通条件','パレタイズのレーン方向',pz.some(edge=>edge.lanes?.some(lane=>lane.direction==='both'))?'保存された双方向の回帰条件':'保存された区間の方向条件','','','synthetic-assumption');
    add('traffic.noOvertaking','交通条件','同方向の追い越し',edges.some(edge=>edge.noOvertakingGroupId)?'保存した追い越し禁止区間に適用':'未設定','','','synthetic-assumption');
    add('traffic.conflict','交通条件','通路競合時','保存した通行予約条件を使用','','','synthetic-assumption');
  }
  return rows;
}

export function renderCustomerConditions(run){
  const rows=customerConditionRows(run),categories=[...new Set(rows.map(row=>row.category))];
  return `<section class="panel customer-conditions"><div class="panel-heading"><div><h2>シミュレーション条件</h2><span class="muted">この結果の計算に使用した保存済み条件</span></div><span class="badge sample">概念図・暫定値を含みます</span></div>
    <p class="method-note">速度・旋回・荷役はこの実行の設定値です。合成距離と暫定値は実測性能・確定所要時間を表しません。充電場所への初期停止は充電中を意味しません。</p>
    ${categories.map((category,i)=>`<details class="customer-condition-group" ${i===0?'open':''}><summary>${esc(category)}</summary><div class="table-scroll"><table><thead><tr><th>対象</th><th>項目</th><th>計算に使用した値</th><th>根拠</th></tr></thead><tbody>${rows.filter(row=>row.category===category).map(row=>`<tr><td>${esc(row.target||'共通')}</td><th scope="row">${esc(row.label)}</th><td>${esc(rowValue(row))}${row.value!==null&&row.unit?' '+esc(row.unit):''}</td><td>${esc(row.evidence)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</section>`;
}
export function customerConditionDifferences(runs){
  const values=runs.map(run=>new Map(customerConditionRows(run).map(row=>[row.key,row])));
  const keys=[...new Set(values.flatMap(rows=>[...rows.keys()]))];
  return keys.filter(key=>new Set(values.map(rows=>JSON.stringify(rows.get(key)?.value))).size>1).map(key=>{
    const row=values.map(rows=>rows.get(key)).find(Boolean);
    const cells=values.map(rows=>rows.has(key)?rowValue(rows.get(key)):'未設定');
    return {label:row.label,target:row.target,unit:row.unit,values:cells,left:cells[0],right:cells[1]};
  });
}
