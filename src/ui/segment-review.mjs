import {
  createSegmentChecklist,validateSegmentChecklist,importSegmentChecklist,setSegmentReview,setNodeReview,
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
  let draft=null,checklist=null,sourceSignature=null,selectedKey='',selectedNodeId='';
  const state=$('segment-review-state');
  const message=value=>{state.textContent=value;};
  const select=$('review-segment');
  const nodeSelect=$('review-node');
  const fields=['review-direction','review-lanes','review-passing','review-gate'];
  function syncEnabled() {
    const allowed=Boolean(selectedKey)&&$('review-access').value==='allowed';
    for(const id of fields)$(id).disabled=!allowed;
    const controlled=allowed&&$('review-gate').value==='controlled';
    $('review-gate-id').disabled=!controlled;
    const direction=$('review-direction').value;
    $('review-forward-wait').disabled=!controlled||!['forward','both'].includes(direction);
    $('review-reverse-wait').disabled=!controlled||!['reverse','both'].includes(direction);
  }
  function nodeRoutes() {
    return draft?.routes.filter(route=>route.nodeIds.includes(selectedNodeId))??[];
  }
  function syncNodeEnabled() {
    const shared=nodeRoutes().length>1;
    const confirmed=$('review-node-state').value==='operator-confirmed';
    const connection=$('review-node-connection');
    connection.disabled=!selectedNodeId||!shared||!confirmed;
    if(!shared)connection.value='not-applicable';
    else if(!confirmed||connection.value==='not-applicable')connection.value='unresolved';
    for(const option of connection.options)option.disabled=shared
      ?option.value==='not-applicable':option.value!=='not-applicable';
  }
  function showNode() {
    const entry=checklist?.nodes.find(node=>node.nodeId===selectedNodeId);
    $('review-node-save').disabled=!entry;
    $('review-node-state').disabled=!entry;
    $('review-node-state').value=entry?.reviewState??'unresolved';
    $('review-node-connection').value=entry?.sharedConnection??'not-applicable';
    const routes=nodeRoutes();
    $('review-node-routes').textContent=routes.length?'この点を使う経路：'+
      routes.map(route=>route.id+'（'+(route.taskType==='guide'?'未割当':route.taskType+' / '+
        ({empty:'空走',loaded:'積載',charge:'充電'}[route.phase]))+'）').join('、'):
      'この点を使う経路はありません。';
    syncNodeEnabled();
  }
  function render(note='') {
    if(!draft) {
      $('segment-review-editor').hidden=true;
      message('CADプレビューを読み込むと区間の確認を開始できます。');
      return;
    }
    $('segment-review-editor').hidden=false;
    nodeSelect.replaceChildren();
    for(const node of draft.nodes) {
      const label=[...$('annotation-point-type').options].find(option=>option.value===node.type)?.text??node.type;
      nodeSelect.add(new Option(node.id+' / '+label,node.id));
    }
    if(!draft.nodes.some(node=>node.id===selectedNodeId))selectedNodeId=draft.nodes[0]?.id??'';
    nodeSelect.value=selectedNodeId;showNode();
    select.replaceChildren();
    for(const item of checklist.segments) {
      const route=draft.routes.find(r=>r.id===item.routeId);
      select.add(new Option(item.routeId+' 区間'+(item.segmentIndex+1)+
        '：'+item.fromId+' → '+item.toId+
        (route?.taskType==='guide'?'（未割当）':''),keyOf(item)));
    }
    if(!checklist.segments.some(x=>keyOf(x)===selectedKey))
      selectedKey=checklist.segments[0]?keyOf(checklist.segments[0]):'';
    select.value=selectedKey;
    showSelected();
    const allowed=checklist.segments.filter(x=>x.access==='allowed').length;
    const forbidden=checklist.segments.filter(x=>x.access==='forbidden').length;
    const pending=checklist.segments.length-allowed-forbidden;
    const points=checklist.nodes.filter(node=>node.reviewState==='operator-confirmed').length;
    const shared=checklist.nodes.filter(node=>node.sharedConnection==='unresolved').length;
    const graph=buildReviewedTopology(draft,checklist);
    const status='点確認 '+points+'／'+checklist.nodes.length+'、共有接続の未確認 '+shared+'。区間確認：通行可の申告 '+allowed+
      '／通行不可の申告 '+forbidden+'／未確認 '+pending+'。'+
      ' グラフ出力対象 '+graph.nodes.length+'点・'+graph.edges.length+'区間。'+
      ' 申告は走行安全の認証ではなく、距離・ETA・交通制御には未接続。';
    message(status+(note?' '+note:''));
  }
  function showSelected() {
    const entry=checklist?.segments.find(s=>keyOf(s)===selectedKey);
    $('review-save').disabled=!entry;
    $('review-access').disabled=!entry;
    for(const [field,endpoint] of [['review-forward-wait','fromId'],['review-reverse-wait','toId']]) {
      $(field).replaceChildren(new Option('進入側のシャッター手前停止点を選択',''));
      const node=draft?.nodes.find(node=>node.id===entry?.[endpoint]&&node.type==='shutter_wait');
      if(node)$(field).add(new Option(node.id,node.id));
    }
    if(!entry){syncEnabled();return;}
    $('review-access').value=entry.access;
    $('review-direction').value=entry.direction;
    $('review-lanes').value=entry.laneCount===null?'':String(entry.laneCount);
    $('review-passing').value=entry.simultaneousPassing;
    $('review-gate').value=entry.gate;
    $('review-gate-id').value=entry.gateId??'';
    $('review-forward-wait').value=entry.forwardWaitNodeId??'';
    $('review-reverse-wait').value=entry.reverseWaitNodeId??'';
    syncEnabled();
  }
  select.addEventListener('change',()=>{
    selectedKey=select.value;showSelected();
  });
  $('review-access').addEventListener('change',syncEnabled);
  $('review-gate').addEventListener('change',syncEnabled);
  $('review-direction').addEventListener('change',syncEnabled);
  nodeSelect.addEventListener('change',()=>{selectedNodeId=nodeSelect.value;showNode();});
  $('review-node-state').addEventListener('change',syncNodeEnabled);
  $('review-node-save').addEventListener('click',()=>{
    if(!draft||!selectedNodeId)return;
    try {
      checklist=setNodeReview(draft,checklist,{nodeId:selectedNodeId,
        reviewState:$('review-node-state').value,sharedConnection:$('review-node-connection').value});
      render('選択点の位置・役割と共有接続の確認を登録しました。');
    }catch(error){message('点の確認を登録できません：'+error.message);}
  });
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
        forwardWaitNodeId:controlled&&!$('review-forward-wait').disabled?$('review-forward-wait').value||null:null,
        reverseWaitNodeId:controlled&&!$('review-reverse-wait').disabled?$('review-reverse-wait').value||null:null
      });
      render('選択区間の確認結果を端末内の下書きに登録しました。');
    }catch(error){message(error.message.includes('entry endpoint')
      ?'通行方向ごとに進入側のシャッター手前停止点を指定してください。点種別と区間の分割も確認してください。'
      :'区間の確認を登録できません：'+error.message);}
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
      const imported=importSegmentChecklist(draft,parsed);
      if([...checklist.nodes,...checklist.segments].some(s=>s.reviewState==='operator-confirmed')&&
        !confirm('現在の点・区間確認結果を、読込台帳の内容で置き換えますか？'))return;
      checklist=imported.checklist;
      render(imported.migrated?'旧台帳を移行しました。点・共有接続は未確認です。方向別停止点の再確認が必要な区間：'+
        (imported.resetSegmentIds.join('、')||'なし')+'。':
        '同じCAD・同じ点・同じ区間の確認台帳を読み込みました。');
    }catch(error){message(error.message);}
    finally{$('review-import').value='';}
  });
  $('review-export-topology').addEventListener('click',()=>{
    if(!draft)return;
    try {
      const graph=buildReviewedTopology(draft,checklist);
      if(graph.edges.length===0)throw new Error(
        '対象の通行候補がありません。点の位置・役割、共有接続、搬送区分、区間の通行条件を確認してください。');
      downloadJson('private-reviewed-topology.json',graph);
      render('レビュー済みの位相グラフを端末に保存しました。実走行許可・ETAには使用できません。');
    }catch(error){message(error.message);}
  });
  return {
    setDraft(next) {
      if(!next) {
        draft=null;checklist=null;sourceSignature=null;selectedKey='';selectedNodeId='';
        render();return;
      }
      const source=createSegmentChecklist(next);
      const signature=JSON.stringify([source.backgroundSha256,source.cadViewBox,source.sourceSnapshot]);
      let note='';
      if(signature!==sourceSignature) {
        if(checklist&&[...checklist.nodes,...checklist.segments].some(entry=>entry.reviewState==='operator-confirmed'))
          note='点・経路の編集により以前の確認は失効しました。再確認してください。';
        checklist=source;sourceSignature=signature;selectedKey='';selectedNodeId='';
      }
      draft=next;
      render(note);
    }
  };
}
