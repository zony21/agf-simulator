import {escapeHtml as esc} from './format.mjs';

/** Count only actual timed removals, including partial shipments at the horizon. */
export function warehouseShippingSummary(run){
  const byLine=Object.fromEntries(Array.from({length:8},(_,i)=>['L'+(i+1),0])),seen=new Set();
  for(const event of run.events??[])if(event.type==='WAREHOUSE_SHIPMENT_PICKED'){
    for(const id of event.palletIds){if(seen.has(id))throw new Error('出荷実績のパレットID重複');seen.add(id);}
    for(const [id,count] of Object.entries(event.sourceLineCounts))byLine[id]=(byLine[id]??0)+count;
  }
  const jobs=run.final.warehouseShipping?.jobs??[],active=jobs.filter(j=>j.status!=='completed');
  const pallets=new Map((run.final.pallets??[]).map(p=>[p.palletId,p])),inventory=new Map();
  for(const slot of Object.values(run.final.warehouse??{}))for(const id of slot.palletIds)inventory.set(id,pallets.get(id));
  return {enabled:run.scenario.warehouseShipping?.enabled??false,shippedPL:seen.size,
    completedRows:jobs.filter(j=>j.status==='completed').length,shippingRows:active.filter(j=>j.status==='shipping').length,
    queuedRows:active.filter(j=>j.status==='queued').length,
    byLine:Object.entries(byLine).map(([sourceLineId,shippedPL])=>({sourceLineId,shippedPL,
      storedPL:[...inventory.values()].filter(p=>p?.sourceLineId===sourceLineId).length,
      shippingPL:active.flatMap(j=>j.palletIds).filter(id=>inventory.get(id)?.sourceLineId===sourceLineId).length}))};
}
export function renderWarehouseShippingResults(run){
  if(!run.scenario.warehouseShipping)return '';
  const s=warehouseShippingSummary(run);
  return `<section class="panel section warehouse-shipping-results"><div class="panel-heading"><h2>系列別出荷実績</h2><span class="badge">出荷 ${s.shippedPL} PL</span></div>
    <p class="notice">有人フォークによる出荷。出荷完了行 ${s.completedRows}行 / 作業中 ${s.shippingRows}行 / フォーク待ち ${s.queuedRows}行。${s.enabled?'満載行の自動出荷は有効です。':'自動出荷は無効です。'}</p>
    <div class="table-scroll"><table><thead><tr><th>系列</th><th>出荷済み（PL）</th><th>現在庫（PL）</th><th>うち出荷待ち・作業中（PL）</th></tr></thead><tbody>${s.byLine.map(r=>`<tr><th>${esc(r.sourceLineId)}</th><td>${r.shippedPL}</td><td>${r.storedPL}</td><td>${r.shippingPL}</td></tr>`).join('')}</tbody></table></div>
    <p class="method-note">各往復で実際に運び出したPLだけを実績に計上します。出荷開始だけでは加算しません。作業途中でRunが終了した分も、運び出し済みと残りを区別します。時間・台数は保存されたRunの仮定条件です。</p></section>`;
}
