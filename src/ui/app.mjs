import { simulate } from '../core/simulate.mjs';
import { initRouteEditor } from './route-editor.mjs';

const $ = id => document.getElementById(id);
const timeFields = [
  ['emptyMin','空走'],['loadedMin','積載走行'],['pickupMin','荷受け'],
  ['dropoffMin','荷下ろし'],['wrapMin','包装'],['labelMin','ラベル'],
  ['exitMin','出口移送'],['chargeTravelMin','充電場所移動']
];
const batteryFields = [
  ['reservePct','選定残量下限 %'],['chargeStartPct','充電要求 %'],
  ['chargeTargetPct','復帰 %'],['consumptionPct','1タスク消費 %（仮定）'],
  ['chargeMinPerPct','1%充電（分）']
];
const batteryDefaults = [40,40,80,1.5,2.4];
const timeDefaults = [2,3,0.5,0.5,3.3,0.2,0.2,2];
const warehouse = Array.from({length:6},(_,i)=>({
  id:'SYN-W'+(i+1),rowId:'SYN-ROW'+(i+1),capacity:50,permission:true
}));
const initialTemporary = [1,2,3].map(i=>({
  palletId:'SIM-TEMP-'+i,locationId:'OT'+i,destinationLocationId:warehouse[i-1].id
}));
let manualRequests=[],magazineUses=[],alignerReadyEvents=[],result=null,playing=null;
let currentIndex=0;
const numeric = id => Number($(id).value);
const createNumeric = (parent,id,name,value,step='0.1') => {
  const label=document.createElement('label');
  label.textContent=name;
  const input=document.createElement('input');input.id=id;input.type='number';
  input.min='0';input.step=step;input.value=String(value);
  label.append(input);parent.append(label);
};
for(let i=1;i<=8;i++) {
  createNumeric($('line-fields'),'line-'+i,'系列'+i+' 間隔',41,'0.1');
  createNumeric($('line-fields'),'offset-'+i,'初回ずらし（仮）',Number(((i-1)*41/8).toFixed(3)),'0.001');
}
timeFields.forEach(([id,name],i)=>createNumeric($('time-fields'),id,name,timeDefaults[i]));
batteryFields.forEach(([id,name],i)=>createNumeric($('battery-fields'),id,name,batteryDefaults[i]));
for(let i=1;i<=5;i++) {
  $('mag-select').add(new Option('マガジン'+i,'M'+i));
  $('align-select').add(new Option('整列機'+i,'AL'+i));
}
warehouse.forEach(w=>$('manual-slot').add(new Option(w.id+'（合成）',w.id)));
initialTemporary.forEach(p=>$('temp-pallet').add(new Option(p.palletId,p.palletId)));

function scenario(mode=$('mode').value) {
  return {
    durationMin:numeric('duration'), mode, fallback:$('fallback').value,
    lineCapacity:2,lineIntervalsMin:Array.from({length:8},(_,i)=>numeric('line-'+(i+1))),
    lineStartOffsetsMin:Array.from({length:8},(_,i)=>numeric('offset-'+(i+1))),
    generatedDestinationIds:warehouse.map(s=>s.id),
    wrapper:{inputCapacity:1,outputCapacity:2},
    agfs:['AGF1','AGF2','AGF3','AGF4'].map((id,i)=>({
      id,area:i<2?'PZ':'WH',batteryPct:100,status:'idle'
    })),
    chargerIds:['CHARGER1','CHARGER2'],
    battery:Object.fromEntries(batteryFields.map(([id])=>[id,numeric(id)])),
    times:Object.fromEntries(timeFields.map(([id])=>[id,numeric(id)])),
    warehouse:structuredClone(warehouse),
    magazines:Array.from({length:5},(_,i)=>({
      id:'M'+(i+1),quantity:4,capacity:20,trigger:3,refillBatch:10,permission:true
    })),
    aligners:Array.from({length:5},(_,i)=>({id:'AL'+(i+1),ready:false})),
    temporaryPallets:structuredClone(initialTemporary),
    manualRequests:structuredClone(manualRequests),
    magazineUses:structuredClone(magazineUses),
    alignerReadyEvents:structuredClone(alignerReadyEvents)
  };
}
const prettyTime = ms => {
  const sec=Math.floor(ms/1000);
  return [Math.floor(sec/3600),Math.floor(sec%3600/60),sec%60]
    .map(n=>String(n).padStart(2,'0')).join(':');
};
const describe = e => [
  prettyTime(e.timeMs),e.type,
  e.kind??'',e.taskId??'',e.agfId??'',e.palletId??'',
  e.lineId??'',e.magazineId??'',e.reason??''
].filter(Boolean).join(' | ');
const showError = err => { $('error').hidden=false;$('error').textContent=err.message??String(err); };
const clearError = () => { $('error').hidden=true;$('error').textContent=''; };
function stop() {if(playing!==null)clearInterval(playing);playing=null;$('play').textContent='▶ 再生';}
function execute() {
  stop();clearError();
  try {
    result=simulate(scenario());
    $('seek').max=String(result.events.length-1);currentIndex=0;
    $('seek').value='0';$('comparison').hidden=true;render();
  } catch(err) {result=null;showError(err);}
}
function currentTime() {return result?.events[currentIndex]?.timeMs??0;}
function at(index) {
  if(!result)return;
  currentIndex=Math.max(0,Math.min(result.events.length-1,index));
  $('seek').value=String(currentIndex);render();
}
function render() {
  if(!result)return;
  const e=result.events[currentIndex],snap=result.snapshots[currentIndex],metrics=result.metrics;
  $('clock').textContent=prettyTime(e.timeMs);
  $('metrics').innerHTML=[
    ['搬出発生',metrics.created],['搬送完了',metrics.completed],
    ['入庫完了',metrics.stored],['未完了タスク',metrics.pendingTasks]
  ].map(([name,value])=>'<div class="metric">'+name+'<b>'+value+'</b></div>').join('');
  const colors=['#70dfc7','#ffbc77','#87a8ff','#e8a4dc'];
  $('agf-markers').innerHTML=snap.agfs.map((a,i)=>{
    const x=92+i*155,y=a.area==='PZ'?199:427;
    return '<circle cx="'+x+'" cy="'+y+'" r="16" fill="'+colors[i]+'" stroke="#122638" stroke-width="2"/>'+
      '<text x="'+x+'" y="'+(y+5)+'" text-anchor="middle" fill="#102436" style="fill:#102436;font-weight:700;font-size:13px">'+(i+1)+'</text>';
  }).join('');
  $('agf-list').innerHTML=snap.agfs.map((a,i)=>
    '<div class="entry"><strong style="color:'+colors[i]+'">'+a.id+'</strong> <span class="tag">'+a.status+'</span>'+
    '<div class="status">エリア: '+a.area+' ／ 残量: '+a.batteryPct+'%<br>タスク: '+(a.taskId??'なし')+
    ' ／ 積載: '+(a.carriedPalletId??'なし')+'</div></div>').join('');
  $('line-list').innerHTML=Object.entries(snap.lines).map(([id,items])=>
    '<div class="entry">'+id+'　'+items.length+'/2 PL</div>').join('');
  $('equipment-list').innerHTML='<div class="entry">投入 '+snap.wrapper.input.length+'/1 ／ 回収 '+
    snap.wrapper.output.length+'/2</div><div class="entry">包装処理 '+(snap.wrapper.processing??'なし')+
    '</div><div class="entry">入庫 '+Object.values(snap.warehouse).reduce((n,s)=>n+s.palletIds.length,0)+' PL（合成ロケーション）</div>'+
    Object.values(snap.magazines).map(m=>'<div class="entry">'+m.id+' 残 '+m.quantity+
      '枚'+(m.pending?' ／ 補充要求中':'')+'</div>').join('');
  $('charger-list').innerHTML=Object.entries(snap.chargers).map(([id,a])=>
    '<div class="entry">'+id+'　'+(a??'空き')+'</div>').join('');
  $('log').textContent=result.events.slice(0,currentIndex+1).slice(-80).map(describe).join('\n');
  $('log').scrollTop=$('log').scrollHeight;
  const current= snap.temporaryPallets;
  const selected=$('temp-pallet').value;
  $('temp-pallet').replaceChildren(...current.map(p=>new Option(p.palletId,p.palletId)));
  if(current.some(p=>p.palletId===selected))$('temp-pallet').value=selected;
  const p=current.find(p=>p.palletId===$('temp-pallet').value);
  if(p)$('temp-location').value=p.locationId;
}
function reserve(kind) {
  if(!result)return;
  clearError();
  const palletId=$('temp-pallet').value;
  if(!palletId) {showError(new Error('仮置きパレットがありません'));return;}
  if(!$('permission').checked) {showError(new Error('明示的な許可を入力してください'));return;}
  const req={timeMs:currentTime(),kind,palletId,locationId:$('temp-location').value,
    requestedBy:'simulator-ui'};
  if(kind==='04')req.reentryPermission=true;
  else {req.destinationLocationId=$('manual-slot').value;req.storagePermission=true;}
  manualRequests.push(req);
  execute();
  if(!result)manualRequests.pop();
}
function registerInput(kind) {
  if(!result)return;
  const target=kind==='magazine'?'mag-select':'align-select';
  const list=kind==='magazine'?magazineUses:alignerReadyEvents;
  list.push({timeMs:currentTime(),[kind==='magazine'?'magazineId':'alignerId']:$(target).value});
  execute();
  if(!result)list.pop();
}
const cell = v => {
  const s=String(v??'');
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
};
function downloadCsv() {
  if(!result)return;
  const columns=['runId','mode','timeMs','sequence','type','kind','taskId','palletId',
    'agfId','lineId','magazineId','locationId','reason','inputKind','timingStatus','scenarioJson'];
  const runId='SIM-'+Date.now(),config=JSON.stringify(result.scenario);
  const rows=[columns.join(',')];
  result.events.forEach((e,i)=>rows.push(columns.map(k=>cell({
    ...e,runId,mode:result.scenario.mode,timingStatus:'scenario-assumption',
    scenarioJson:i===0?config:''
  }[k])).join(',')));
  const blob=new Blob(['\ufeff',rows.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=runId+'-events.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('run').addEventListener('click',execute);
$('compare').addEventListener('click',()=>{
  clearError();
  try {
    const left=simulate(scenario('area_first')),right=simulate(scenario('low_battery_first'));
    $('comparison').hidden=false;
    $('comparison-body').innerHTML=[['目的地エリア優先',left],['低残量優先',right]].map(([name,r])=>
      '<div class="metric"><strong>'+name+'</strong><b>入庫 '+r.metrics.stored+'</b>'+
      '<div>搬送完了 '+r.metrics.completed+' ／ 未完了 '+r.metrics.pendingTasks+'</div>'+
      '<div>充電開始 '+r.metrics.chargingStarts+'</div></div>').join('');
  } catch(err) {showError(err);}
});
$('play').addEventListener('click',()=>{
  if(playing!==null) {stop();return;}
  if(!result)return;
  $('play').textContent='■ 停止';
  playing=setInterval(()=>{
    if(currentIndex>=result.events.length-1) {stop();return;}
    at(currentIndex+numeric('speed'));
  },350);
});
$('reset').addEventListener('click',()=>{stop();at(0);});
$('seek').addEventListener('input',()=>{stop();at(Number($('seek').value));});
$('csv').addEventListener('click',downloadCsv);
$('manual04').addEventListener('click',()=>reserve('04'));
$('manual05').addEventListener('click',()=>reserve('05'));
$('mag-use').addEventListener('click',()=>registerInput('magazine'));
$('align-ready').addEventListener('click',()=>registerInput('aligner'));
$('temp-pallet').addEventListener('change',()=>{
  const p=initialTemporary.find(p=>p.palletId===$('temp-pallet').value);
  if(p)$('temp-location').value=p.locationId;
});
const routeEditor=initRouteEditor();
let cadBlobUrl=null;
$('private-cad-file').addEventListener('change',async()=>{
  const file=$('private-cad-file').files?.[0];
  if(!file)return;
  clearError();
  let url=null;
  try {
    if(!$('cad-agf-excluded').checked)throw new Error('AGF図形を除外済みのプレビューであることを確認してください。');
    if(file.size>80_000_000)throw new Error('プレビューの上限は80MBです。レイヤーを絞って再出力してください。');
    const svg=/\.svg$/i.test(file.name),png=/\.png$/i.test(file.name);
    if(!svg&&!png)throw new Error('ローカルのSVGまたはPNGプレビューを指定してください。');
    if(routeEditor.hasChanges() &&
      !confirm('現在の図上点・経路の下書きが消えます。切り替えますか？')){
      $('private-cad-file').value='';return;
    }
    let viewBox=null;
    if(svg) {
      const head=await file.slice(0,4096).text();
      if(!head.includes('<svg')||!head.includes('PRIVATE-CAD-PREVIEW-V1'))
        throw new Error('対応する非公開DXFプレビューではありません。private_cad_preview.pyで生成してください。');
      const match=head.match(/<svg\b[^>]*\bviewBox="([^"]+)"/);
      const numbers=match?.[1]?.trim().split(/[\s,]+/).map(Number);
      if(!numbers||numbers.length!==4||numbers.some(n=>!Number.isFinite(n))||
         numbers[2]<=0||numbers[3]<=0)
        throw new Error('SVGの図面座標（viewBox）を読み取れません。');
      viewBox=numbers;
    } else {
      const b=new Uint8Array(await file.slice(0,8).arrayBuffer());
      if(b.join(',')!=='137,80,78,71,13,10,26,10')throw new Error('PNG形式を確認できません。');
    }
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
    const hash=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
    url=URL.createObjectURL(file);
    const image=$('cad-image');
    image.onload=()=>{
      try {
        routeEditor.setBackground(hash,viewBox);
        if(cadBlobUrl)URL.revokeObjectURL(cadBlobUrl);
        cadBlobUrl=url;
        $('map').hidden=true;
        $('cad-viewport').hidden=false;
        $('cad-state').textContent='AGF除外を利用者が確認した非公開CADプレビュー表示中。1 CAD単位＝1 mm（指定値）。経路・点は手動下書きで、AGF実位置・所要時間は未確定です。';
      }catch(error){URL.revokeObjectURL(url);showError(error);}
    };
    image.onerror=()=>{
      URL.revokeObjectURL(url);showError(new Error('画像を読み込めませんでした。'));
    };
    image.src=url;
  }catch(err) {
    if(url)URL.revokeObjectURL(url);
    showError(err);
  }
});
$('show-schematic').addEventListener('click',()=>{
  if(routeEditor.hasChanges() &&
    !confirm('図上点・経路の下書きが消えます。保存済みJSONを確認してから切り替えてください。続けますか？'))return;
  const image=$('cad-image');
  image.onload=null;image.onerror=null;image.removeAttribute('src');
  $('cad-viewport').hidden=true;
  $('map').hidden=false;
  $('private-cad-file').value='';
  $('cad-agf-excluded').checked=false;
  if(cadBlobUrl)URL.revokeObjectURL(cadBlobUrl);
  cadBlobUrl=null;
  routeEditor.clearBackground();
  $('cad-state').textContent='CAD未読み込み：概念図を表示しています。';
});
execute();
