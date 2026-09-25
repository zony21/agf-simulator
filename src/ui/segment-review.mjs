import {
  createSegmentChecklist,validateSegmentChecklist,setSegmentReview,
  buildReviewedTopology
} from '../map/reviewed-topology.mjs';

const $=id=>document.getElementById(id);
const keyOf=entry=>entry.routeId+':'+entry.segmentIndex;
function downloadJson(name,data) {
  const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/**
 * Independent, local-only review overlay. Editing the draft invalidates the
 * whole checklist, including undo/redo; a changed line is not auto-approved.
 */
export function initSegmentReview() {
  let draft=null,checklist=null,sourceSignature=null,selectedKey='';
  const state=$('segment-review-state');
  const message=value=>{state.textContent=value;};
  const select=$('review-segment');
  const fields=['review-direction','review-lanes','review-passing','review-gate'];
  function syncEnabled() {
    const allowed=$('review-access').value==='allowed';
    for(const id of fields)$(id).disabled=!allowed;
    const controlled=allowed&&$('review-gate').value==='controlled';
    $('review-gate-id').disabled=!controlled;
    $('review-wait-point').disabled=!controlled;
  }
  function render(note='') {
    if(!draft) {
      $('segment-review-editor').hidden=true;
      message('CADプレビューを読み込むと区間の確認を開始できます。');
      return;
    }
    $('segment-review-editor').hidden=false;
    select.replaceChildren();
    for(const item of checklist.segments) {
      const route=draft.routes.find(r=>r.id===item.routeId);
      select.add(new Option(item.routeId+' 区間'+(item.segmentIndex+1)+
        '：'+item.fromId+' → '+item.toId+
        (route?.taskType==='guide'?'（未割当）':''),keyOf(item)));
    }
    $('review-wait-point').replaceChildren(new Option('シャッター前停止点を選択',''));
    for(const node of draft.nodes.filter(n=>n.type==='shutter_wait'))
      $('review-wait-point').add(new Option(node.id,node.id));
    if(!checklist.segments.some(x=>keyOf(x)===selectedKey))
      selectedKey=checklist.segments[0]?keyOf(checklist.segments[0]):'';
    select.value=selectedKey;
    showSelected();
    const allowed=checklist.segments.filter(x=>x.access==='allowed').length;
    const forbidden=checklist.segments.filter(x=>x.access==='forbidden').length;
    const pending=checklist.segments.length-allowed-forbidden;
    const status='区間確認：通行可の申告 '+allowed+
      '／通行不可の申告 '+forbidden+'／未確認 '+pending+'。'+
      ' 申告は走行安全の認証ではなく、距離・ETA・交通制御には未接続。';
    message(status+(note?' '+note:''));
  }
  function showSelected() {
    const entry=checklist?.segments.find(s=>keyOf(s)===selectedKey);
    $('review-save').disabled=!entry;
    if(!entry)return;
    $('review-access').value=entry.access;
    $('review-direction').value=entry.direction;
    $('review-lanes').value=entry.laneCount===null?'':String(entry.laneCount);
    $('review-passing').value=entry.simultaneousPassing;
    $('review-gate').value=entry.gate;
    $('review-gate-id').value=entry.gateId??'';
    $('review-wait-point').value=entry.waitNodeId??'';
    syncEnabled();
  }
  select.addEventListener('change',()=>{
    selectedKey=select.value;showSelected();
  });
  $('review-access').addEventListener('change',syncEnabled);
  $('review-gate').addEventListener('change',syncEnabled);
  $('review-save').addEventListener('click',()=>{
    if(!draft||!selectedKey)return;
    const entry=checklist.segments.find(s=>keyOf(s)===selectedKey);
    const access=$('review-access').value,allowed=access==='allowed';
    const controlled=allowed&&$('review-gate').value==='controlled';
    try {
      checklist=setSegmentReview(draft,checklist,{
        routeId:entry.routeId,segmentIndex:entry.segmentIndex,
        reviewState:access==='unresolved'?'unresolved':'operator-confirmed',
        access,direction:allowed?$('review-direction').value:'unresolved',
        laneCount:allowed&&$('review-lanes').value!==''?Number($('review-lanes').value):null,
        simultaneousPassing:allowed?$('review-passing').value:'unresolved',
        gate:allowed?$('review-gate').value:'unresolved',
        gateId:controlled?$('review-gate-id').value.trim()||null:null,
        waitNodeId:controlled?$('review-wait-point').value||null:null
      });
      render('選択区間の確認結果を端末内の下書きに登録しました。');
    }catch(error){message(error.message);}
  });
  $('review-export').addEventListener('click',()=>{
    if(!draft)return;
    try {
      const result=validateSegmentChecklist(draft,checklist);
      downloadJson('private-segment-review.json',result);
      render('確認台帳を端末に保存しました。公開Gitへ追加しないでください。');
    }catch(error){message(error.message);}
  });
  $('review-import').addEventListener('change',async()=>{
    const file=$('review-import').files?.[0];
    if(!file||!draft)return;
    try {
      if(file.size>2_000_000)throw new Error('確認台帳は2MB以下にしてください。');
      const parsed=JSON.parse(await file.text());
      const imported=validateSegmentChecklist(draft,parsed);
      if(checklist.segments.some(s=>s.reviewState==='operator-confirmed')&&
        !confirm('現在の区間確認結果を、読込台帳の内容で置き換えますか？'))return;
      checklist=imported;
      render('同じCAD・同じ点・同じ区間の確認台帳を読み込みました。');
    }catch(error){message(error.message);}
    finally{$('review-import').value='';}
  });
  $('review-export-topology').addEventListener('click',()=>{
    if(!draft)return;
    try {
      const graph=buildReviewedTopology(draft,checklist);
      if(graph.edges.length===0)throw new Error(
        '対象の通行候補がありません。未割当ガイドは区分を明示してから、区間を再確認してください。');
      downloadJson('private-reviewed-topology.json',graph);
      render('レビュー済みの位相グラフを端末に保存しました。実走行許可・ETAには使用できません。');
    }catch(error){message(error.message);}
  });
  return {
    setDraft(next) {
      if(!next) {
        draft=null;checklist=null;sourceSignature=null;selectedKey='';
        render();return;
      }
      const source=createSegmentChecklist(next);
      const signature=JSON.stringify([source.backgroundSha256,source.cadViewBox,source.sourceSnapshot]);
      if(signature!==sourceSignature) {
        checklist=source;sourceSignature=signature;selectedKey='';
      }
      draft=next;
      render();
    }
  };
}
