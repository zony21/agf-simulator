import {WAREHOUSE_BLOCKS,warehouseLocations,slotStatus,WAREHOUSE_SERVICE} from '../map/warehouse-layout.mjs';
import {escapeHtml as esc,states,locationName} from './format.mjs';

const slots=warehouseLocations();
const palette={empty:'#e2e8f0',occupied:'#10b981',reserved:'#f59e0b',unavailable:'#64748b',unknown:'#cbd5e1'};
const statusNames={empty:'空き',occupied:'使用中',reserved:'予約済み',unavailable:'使用不可',unknown:'未取得'};
// These are drawing coordinates of a schematic, with no relationship to CAD coordinates.
const blockBoxes={WB1:[56,452,362,135],WB2:[56,603,362,91],WB3:[56,710,362,205],EB1:[664,452,365,135],EB2:[664,610,365,135]};
const text=(x,y,label,cls='')=>`<text x="${x}" y="${y}" class="${cls}">${esc(label)}</text>`;
const rect=(x,y,w,h,cls='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="${cls}"/>`;

export function initMap({svg,onSelectAgf,onSelectBlock}) {
  let box=[0,0,1100,970],drag=null,snapshot=null,selected='AGF1';
  const updateView=()=>svg.setAttribute('viewBox',box.join(' '));
  const fit=()=>{box=[0,0,1100,970];updateView();};
  const zoom=factor=>{const w=Math.max(300,Math.min(1800,box[2]*factor)),h=w*box[3]/box[2];
    box=[box[0]+(box[2]-w)/2,box[1]+(box[3]-h)/2,w,h];updateView();};
  svg.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY>0?1.12:1/1.12);},{passive:false});
  svg.addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-agf],[data-block]')||event.button!==0)return;
    const matrix=svg.getScreenCTM();if(!matrix)return;
    drag={x:event.clientX,y:event.clientY,box:[...box],scale:matrix.a};svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove',event=>{if(!drag)return;
    box=[drag.box[0]-(event.clientX-drag.x)/drag.scale,drag.box[1]-(event.clientY-drag.y)/drag.scale,...drag.box.slice(2)];updateView();});
  const endDrag=()=>{drag=null;};svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);
  const activate=target=>{const agf=target.closest('[data-agf]'),block=target.closest('[data-block]');
    if(agf)onSelectAgf(agf.dataset.agf);if(block)onSelectBlock(block.dataset.block);};
  svg.addEventListener('click',event=>activate(event.target));
  svg.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(event.target);}});

  function render(next,selectedId) {
    snapshot=next;selected=selectedId;
    const selectedTask=snapshot.tasks.find(t=>t.id===snapshot.agfs.find(a=>a.id===selected)?.taskId);
    const targeted=id=>[selectedTask?.originId,selectedTask?.destinationId].includes(id)?' target-equipment':'';
    function equipment(id,label,x,y,w,h,detail='') {
      return `<g class="equipment${targeted(id)}">${rect(x,y,w,h,'equipment-body')}${text(x+12,y+24,label)}${detail?text(x+12,y+43,detail,'map-small'):''}</g>`;
    }
    const lines=Array.from({length:8},(_,i)=>equipment('L'+(i+1),'系列'+(i+1),55+i*83,72,73,61,
      `${snapshot.lines['L'+(i+1)].length} PL`)).join('');
    const mags=Object.values(snapshot.magazines).map((m,i)=>equipment(m.id,'M'+(i+1),56+i*102,169,91,57,`${m.quantity}枚${m.pending?' · 補充':''}`)).join('');
    const temps=[1,2,3].map((n,i)=>equipment('OT'+n,'仮置き '+n,682+i*119,169,108,57,
      `${snapshot.temporaryPallets.filter(p=>p.locationId==='OT'+n).length} PL`)).join('');
    const blocks=WAREHOUSE_BLOCKS.map(block=>{
      const [x,y,w,h]=blockBoxes[block.id],bw=(w-32)/block.columns,bh=(h-50)/block.rows;
      const blockSlots=slots.filter(s=>s.blockId===block.id);
      const used=blockSlots.filter(s=>slotStatus(snapshot.warehouse[s.id])==='occupied').length;
      const count=blockSlots.length;
      const active=[selectedTask?.originId,selectedTask?.destinationId].some(id=>id?.startsWith(block.id+'-'));
      let cells='';
      for(let r=1;r<=block.rows;r++)for(let c=1;c<=block.columns;c++) {
        if(block.emptyColumns.includes(c)){cells+=`<rect x="${x+16+(c-1)*bw}" y="${y+40+(r-1)*bh}" width="${bw-2}" height="${bh-2}" fill="url(#gap)"/>`;continue;}
        const pair=blockSlots.filter(s=>s.row===r&&s.column===c).map(s=>slotStatus(snapshot.warehouse[s.id]));
        const state=['unavailable','reserved','occupied','empty'].find(s=>pair.includes(s))??'unknown';
        cells+=`<rect x="${x+16+(c-1)*bw}" y="${y+40+(r-1)*bh}" width="${bw-2}" height="${bh-2}" rx="2" fill="${palette[state]}"/>`;
      }
      return `<g data-block="${block.id}" role="button" tabindex="0" aria-label="${block.id} ${block.label} ${count}保管位置の行列段を表示" class="warehouse-block${active?' target-equipment':''}">
        ${rect(x,y,w,h,'block-body')}${text(x+15,y+25,block.id+'  '+block.rows+'行 × '+block.columns+'列 × 2段')}
        ${text(x+w-15,y+25,used+'/'+count+' PL','map-small align-end')}${cells}</g>`;
    }).join('');
    const agfs=snapshot.agfs.map((a,i)=>{
      const x=210+i*160,y=a.area==='PZ'?319:405,active=a.id===selected;
      const status=snapshot.tasks.find(t=>t.id===a.taskId)?.status==='wait_drop'?'wait_drop':a.status;
      return `<g data-agf="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.id+' '+(states[status]??status)+' 所属エリアの仮位置、向き未確定')}" class="agf-marker${active?' selected':''}" transform="translate(${x},${y})">
        <title>${esc(a.id)}：実位置・進行方向は未確定</title><rect class="agf-halo" x="-33" y="-25" width="104" height="50" rx="15"/>
        <rect x="-23" y="-18" width="46" height="36" rx="9" class="agf-body"/><text x="0" y="6" text-anchor="middle" class="agf-number">${i+1}</text>
        <text x="35" y="-4" class="map-small" data-battery-text="${a.id}">${a.batteryPct.toFixed(1)}%</text><text x="35" y="13" class="map-small">${a.carriedPalletId?'▣ 積載':'□ 空車'}</text></g>`;
    }).join('');
    svg.innerHTML=`<defs><pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#cbd5e1"/></pattern>
      <pattern id="gap" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6 L6 0" stroke="#94a3b8" stroke-width="1"/></pattern></defs>
      <rect x="-2000" y="-2000" width="6000" height="6000" fill="#f1f5f9"/><rect x="10" y="10" width="1080" height="950" fill="url(#map-grid)"/>
      ${rect(25,22,1050,330,'zone')}${text(48,51,'01 / パレタイズエリア','zone-heading')}${text(1050,51,'設備の位置は概念配置','map-small align-end')}
      ${lines}${equipment('WRAP-INPUT','包装機 · 投入',756,72,147,61,`${snapshot.wrapper.input.length} PL`)}${equipment('WRAP-OUTPUT','回収',913,72,129,61,`${snapshot.wrapper.output.length} PL`)}
      ${text(56,158,'マガジン 5台','map-small')}${mags}${temps}
      <path d="M55 254 H1042 M55 283 H1042 M55 254 V283 M1042 254 V283" class="provisional-path"/>
      ${text(550,276,'通路1・2 ／ 各1車線・2本の組合せ（位置未照合）','path-label')}
      ${text(55,324,'AGF 所属エリア','map-small')}${text(1050,378,'エリア間の実経路は未承認','map-small align-end')}
      ${rect(25,375,1050,567,'zone')}${text(48,410,'02 / 製品倉庫','zone-heading')}
      ${text(1036,432,'概念保管位置 802 PL ／ 在庫はサンプル','map-small align-end')}
      <path d="M448 465 V914 M487 465 V914 M597 465 V914 M636 465 V914" class="provisional-path"/>
      ${[448,487,597,636].map((x,i)=>text(x,447,(i<2?'西':'東')+(i%2+1),'aisle-label')).join('')}
      <path d="M544 454 V529 M544 568 V744 M544 783 V913" class="center-wall"/>
      <rect x="525" y="529" width="38" height="39" rx="3" class="fire-gate"/><rect x="525" y="744" width="38" height="39" rx="3" class="fire-gate"/>
      ${text(544,554,'SH1','shutter-label')}${text(544,770,'SH2','shutter-label')}
      <text x="552" y="638" class="map-small" transform="rotate(90 552 638)">中央壁 · 自由横断不可</text>
      ${blocks}${text(685,762,'EB第10列：パレットなし・通行可否未確定','map-small')}${text(804,780,'整列機5台（搬送03荷受け）','map-small')}
      ${WAREHOUSE_SERVICE.waitingPlaces.map((p,i)=>equipment(p.id,'待機場所 '+(i+1),664,787+i*34,127,30)).join('')}
      ${WAREHOUSE_SERVICE.chargePlaces.map((p,i)=>equipment(p.id,'充電場所 '+(i+1),664,857+i*34,127,30)).join('')}
      ${Object.values(snapshot.aligners).map((a,i)=>equipment(a.id,'AL'+(i+1),803+i*46,787,43,48,a.ready?'OK':'待機')).join('')}
      <g aria-label="空パレ置き場、AGF進入禁止、有人供給元"><rect x="803" y="850" width="228" height="71" rx="7" fill="url(#gap)" stroke="#b45353" stroke-width="1.5"/>
      ${text(817,875,'空パレ置き場（有人供給）','map-small')}${text(817,902,'× AGF進入禁止','forbidden-label')}</g>
      ${text(664,938,'東側主通路からアクセス ／ 分岐・停止点は未確定','map-small')}${agfs}`;
    updateView();
  }
  return {render,fit,zoom,warehouse:()=>{box=[10,365,1080,585];updateView();},
    getSnapshot:()=>snapshot};
}

export function renderWarehouseBlock(blockId,tier,snapshot) {
  const block=WAREHOUSE_BLOCKS.find(b=>b.id===blockId);
  if(!block)return '';
  const own=slots.filter(s=>s.blockId===blockId);
  const counts=Object.fromEntries(Object.keys(palette).map(state=>[state,own.filter(s=>slotStatus(snapshot.warehouse[s.id])===state).length]));
  const cell=(row,column)=>{
    if(block.emptyColumns.includes(column))return '<div class="slot-gap" title="空列：配置対象外・通行可否未確定">／</div>';
    const slot=own.find(s=>s.row===row&&s.column===column&&s.tier===tier),state=slotStatus(snapshot.warehouse[slot.id]);
    return `<button class="slot slot-${state}" data-slot="${slot.id}" aria-label="${slot.id} ${statusNames[state]}" title="${slot.id} · ${statusNames[state]}"><span>${row}-${column}</span><b>${state==='occupied'?'●':state==='reserved'?'◷':state==='unavailable'?'×':'·'}</b></button>`;
  };
  return `<div class="block-summary"><div><span class="eyebrow">WAREHOUSE / ${block.id}</span><h2>${block.label} · ${block.id}</h2><p>${block.rows}行 × ${block.columns}列 × 2段 ${block.emptyColumns.length?'（第10列は配置対象外）':''}</p></div><strong>${own.length}<small>保管位置</small></strong></div>
    <div class="slot-counts">${Object.entries(counts).filter(([s])=>s!=='unknown').map(([s,n])=>`<span><i class="legend-dot slot-${s}"></i>${statusNames[s]} <b>${n}</b></span>`).join('')}</div>
    <div class="notice">概念図・サンプル在庫 ／ 各行は双方向1車線、横並び通行不可。個別停止位置・主通路への接続は未確認です。</div>
    <div class="warehouse-scroll"><div class="slot-grid" style="--cols:${block.columns}"><span></span>${Array.from({length:block.columns},(_,i)=>`<span class="col-number">${i+1}列</span>`).join('')}
      ${Array.from({length:block.rows},(_,i)=>`<span class="row-number">${i+1}行<br><small>↔ 1車線</small></span>${Array.from({length:block.columns},(_,c)=>cell(i+1,c+1)).join('')}`).join('')}</div></div>
    <p class="muted">${tier}段を表示中。集計は2段合計。${block.emptyColumns.length?'斜線の空列は道路を意味しません。':''}位置を選ぶとパレット・予約を確認できます。</p>`;
}

export function describeSlot(id,snapshot) {
  const slot=snapshot.warehouse[id];
  return `${locationName(id)} ｜ ${statusNames[slotStatus(slot)]} ｜ パレット：${slot?.palletIds?.join(', ')||'なし'} ｜ 予約：${slot?.reserved?.join(', ')||'なし'}`;
}
