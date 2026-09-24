import {
  createAnnotation,addNode,addRoute,moveNode,insertRoutePoint,
  removeRoutePoint,deleteRoute,classifyRoute,validateAnnotation
} from '../map/route-annotations.mjs';

const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const colors={'01':'#7ad6e8','02':'#e9ad64','03':'#b2a1ff','04':'#8dd6a0','05':'#e88b8b',charge:'#f4e68a',guide:'#f5f5f5'};
const clamp=value=>Math.max(0,Math.min(1,value));

export function initRouteEditor() {
  let draft=null,pending=[],proposalStart=null,selectedRoute=null,selectedNode=null,drag=null;
  let history=[],future=[],zoom=1;
  const stage=$('cad-stage'),state=$('annotation-state'),overlay=$('cad-overlay');
  const message=text=>{state.textContent=text;};
  const byId=()=>new Map(draft.nodes.map(node=>[node.id,node]));
  const location=event=>{
    const rect=$('cad-image').getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)throw new Error('図面の表示サイズを取得できません');
    return {u:clamp((event.clientX-rect.left)/rect.width),
      v:clamp((event.clientY-rect.top)/rect.height)};
  };
  const newId=(base,used)=>{let n=1,id;do {id=base+String(n++).padStart(4,'0');}while(used.has(id));used.add(id);return id;};
  function apply(next,note='') {
    history.push(draft);if(history.length>100)history.shift();
    future=[];draft=next;render(note);
  }
  const pointLabel=node=>node.id+' / '+node.type+
    (node.xCadMm===undefined?'':' / CAD(mm) '+node.xCadMm+', '+node.yCadMm);
  const number=(u,v)=>[(u*1000).toFixed(3),(v*1000).toFixed(3)];
  function segment(a,b,color,routeId,index,emphasized=false) {
    const el=document.createElementNS(NS,'line');
    const [x1,y1]=number(a.u,a.v),[x2,y2]=number(b.u,b.v);
    for(const [key,value] of Object.entries({x1,y1,x2,y2}))
      el.setAttribute(key,value);
    el.setAttribute('stroke',color);
    el.setAttribute('stroke-width',emphasized?'5':'3');
    el.setAttribute('stroke-dasharray','12 8');
    el.setAttribute('stroke-linecap','round');
    el.style.opacity=emphasized?'1':'.65';
    if(routeId) {
      el.dataset.a=a.id;el.dataset.b=b.id;
      el.style.pointerEvents='stroke';
      el.classList.add('cad-segment');
      el.addEventListener('click',event=>{
        event.stopPropagation();
        if($('annotation-mode').value!=='edit')return;
        if(selectedRoute!==routeId) {
          selectedRoute=routeId;selectedNode=null;
          render('経路を選択しました。線をもう一度押すと点を追加します。');return;
        }
        try {
          const {u,v}=location(event),id=newId('P',new Set(draft.nodes.map(n=>n.id)));
          apply(insertRoutePoint(draft,{routeId,segmentIndex:index,id,u,v}),
            '線の途中に'+id+'を追加しました。ドラッグして曲がり角を調整できます。');
          selectedNode=id;
          render();
        }catch(error){message(error.message);}
      });
    }
    overlay.append(el);
  }
  function refreshDrag(nodeId,u,v) {
    const b=[...$('cad-node-layer').children].find(el=>el.dataset.nodeId===nodeId);
    if(b){b.style.left=(u*100)+'%';b.style.top=(v*100)+'%';}
    overlay.querySelectorAll('.cad-segment').forEach(el=>{
      if(el.dataset.a===nodeId) {
        const [x,y]=number(u,v);el.setAttribute('x1',x);el.setAttribute('y1',y);
      }
      if(el.dataset.b===nodeId) {
        const [x,y]=number(u,v);el.setAttribute('x2',x);el.setAttribute('y2',y);
      }
    });
  }
  function nodeButton(node,index) {
    const b=document.createElement('button');
    b.type='button';b.className='cad-node '+node.type+(selectedNode===node.id?' selected':'');
    b.dataset.nodeId=node.id;b.style.left=(node.u*100)+'%';b.style.top=(node.v*100)+'%';
    b.title=pointLabel(node)+' / 編集でドラッグ可能';
    b.textContent=String(index+1);b.setAttribute('aria-label',b.title);
    b.addEventListener('click',()=>{
      if(drag?.moved)return;
      const mode=$('annotation-mode').value;
      if(mode==='route') {
        if(pending.length>=200){message('経路に指定できる点は200点までです。');return;}
        if(pending.at(-1)===node.id){message('同じ点を続けて指定できません。');return;}
        pending.push(node.id);render('経路の選択点：'+pending.join(' → '));
      } else {
        selectedNode=node.id;
        render('選択点：'+pointLabel(node));
      }
    });
    b.addEventListener('pointerdown',event=>{
      if($('annotation-mode').value!=='edit'||event.button!==0)return;
      if(selectedRoute&&!draft.routes.find(r=>r.id===selectedRoute)?.nodeIds.includes(node.id))return;
      selectedNode=node.id;
      drag={id:node.id,startX:event.clientX,startY:event.clientY,
        u:node.u,v:node.v,moved:false};
      b.setPointerCapture(event.pointerId);
      event.stopPropagation();
    });
    b.addEventListener('pointermove',event=>{
      if(!drag||drag.id!==node.id)return;
      if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<3&&!drag.moved)return;
      drag.moved=true;
      const {u,v}=location(event);drag.u=u;drag.v=v;
      refreshDrag(node.id,u,v);
    });
    b.addEventListener('pointerup',event=>{
      if(!drag||drag.id!==node.id)return;
      const current=drag;drag=null;
      if(current.moved) {
        const involved=draft.routes.filter(r=>r.nodeIds.includes(node.id));
        if(involved.length>1&&!confirm('この点は複数経路で共有しています。全経路の点を移動しますか？')) {
          render('共有点の移動を取り消しました。');return;
        }
        try {apply(moveNode(draft,node.id,current.u,current.v),
          '点'+node.id+'を移動しました。未承認の仮経路です。');}
        catch(error){render(error.message);}
      } else render('選択点：'+pointLabel(node));
      event.stopPropagation();
    });
    b.addEventListener('pointercancel',()=>{drag=null;render('移動を取り消しました。');});
    return b;
  }
  function render(note='') {
    overlay.replaceChildren();$('cad-node-layer').replaceChildren();$('annotation-list').replaceChildren();
    $('annotation-selected').replaceChildren(new Option('経路を選択',''));
    if(!draft) {
      $('cad-editor').hidden=true;message('CADプレビューを読み込むと図上編集を開始できます。');return;
    }
    $('cad-editor').hidden=false;
    const nodes=byId();
    for(const route of draft.routes) {
      $('annotation-selected').add(new Option(route.id+' / '+(route.taskType==='guide'?'未割当参考':route.taskType+' / '+route.phase),route.id));
      const active=selectedRoute===route.id;
      for(let i=0;i<route.nodeIds.length-1;i++)
        segment(nodes.get(route.nodeIds[i]),nodes.get(route.nodeIds[i+1]),
          colors[route.taskType],route.id,i,active);
      const b=document.createElement('button');b.type='button';
      b.className='entry cad-route-choice'+(active?' selected':'');
      b.textContent=route.id+' / '+(route.taskType==='guide'?'未割当の参考ライン':route.taskType+' / '+route.phase)+
        ' / 仮：'+route.nodeIds.join(' → ');
      b.addEventListener('click',()=>{
        selectedRoute=route.id;selectedNode=null;$('annotation-mode').value='edit';
        render('経路'+route.id+'を選択しました。点をドラッグ、線をクリックして経由点追加できます。');
      });
      $('annotation-list').append(b);
    }
    if(selectedRoute&&!draft.routes.some(r=>r.id===selectedRoute))selectedRoute=null;
    $('annotation-selected').value=selectedRoute??'';
    for(let i=0;i<pending.length-1;i++)
      segment(nodes.get(pending[i]),nodes.get(pending[i+1]),'#ffffff',null,i,true);
    if(proposalStart) {
      const circle=document.createElementNS(NS,'circle');
      const [cx,cy]=number(proposalStart.u,proposalStart.v);
      circle.setAttribute('cx',cx);circle.setAttribute('cy',cy);
      circle.setAttribute('r','8');circle.setAttribute('fill','#f5e48e');
      circle.style.pointerEvents='none';overlay.append(circle);
    }
    draft.nodes.forEach((node,i)=>$('cad-node-layer').append(nodeButton(node,i)));
    $('annotation-undo-edit').disabled=!history.length;
    $('annotation-redo-edit').disabled=!future.length;
    const status='下書き：点 '+draft.nodes.length+'／線 '+draft.routes.length+
      '（未割当ガイド '+draft.routes.filter(r=>r.taskType==='guide').length+'）。'+
      (draft.cadViewBox?'SVG図面座標をmm仮定で換算。':'PNGは正規化座標のみ。')+
      ' 経路の通行可否・距離・所要時間は未検証。';
    message(status+(note?' '+note:''));
  }
  function startProposal(a,b) {
    let next=draft;
    const used=new Set(next.nodes.map(n=>n.id));
    const points=[a],bend=$('annotation-bend').value;
    if(a.u!==b.u&&a.v!==b.v&&bend!=='direct') {
      points.push(bend==='horizontal'?{u:b.u,v:a.v}:{u:a.u,v:b.v});
    }
    points.push(b);
    const ids=[];
    for(const point of points) {
      const id=newId('P',used);ids.push(id);
      next=addNode(next,{id,type:'waypoint',u:point.u,v:point.v});
    }
    const routeId=$('annotation-route-id').value.trim();
    next=addRoute(next,{id:routeId,taskType:$('annotation-task').value,
      phase:$('annotation-phase').value,nodeIds:ids});
    apply(next,'始点と終点から仮線を生成しました。CAD障害物は判定していません。線と点を動かして修正してください。');
    selectedRoute=routeId;selectedNode=null;$('annotation-mode').value='edit';
    let n=draft.routes.length+1;
    while(draft.routes.some(r=>r.id==='R'+String(n).padStart(2,'0')))n++;
    $('annotation-route-id').value='R'+String(n).padStart(2,'0');
    render('仮線'+routeId+'を選択中。曲がり角をドラッグして修正してください。');
  }
  stage.addEventListener('click',event=>{
    if(!draft||event.target.closest('.cad-node')||event.target.closest('.cad-segment'))return;
    const mode=$('annotation-mode').value;
    if(mode!=='point'&&mode!=='proposal')return;
    try {
      const {u,v}=location(event);
      if(mode==='proposal') {
        if(!proposalStart) {proposalStart={u,v};render('始点を指定しました。次に終点をクリックしてください。');}
        else {const start=proposalStart;proposalStart=null;startProposal(start,{u,v});}
      } else {
        const id=$('annotation-point-id').value.trim();
        apply(addNode(draft,{id,type:$('annotation-point-type').value,u,v}),'点'+id+'を登録しました。');
        $('annotation-point-id').value=newId('P',new Set(draft.nodes.map(n=>n.id)));
      }
    }catch(error){proposalStart=null;render(error.message);}
  });
  $('annotation-mode').addEventListener('change',()=>{proposalStart=null;pending=[];render();});
  $('annotation-task').addEventListener('change',()=>{
    if($('annotation-task').value==='charge')$('annotation-phase').value='charge';
    else if($('annotation-task').value==='guide')$('annotation-phase').value='guide';
    else if(['charge','guide'].includes($('annotation-phase').value))
      $('annotation-phase').value='loaded';
  });
  $('annotation-selected').addEventListener('change',()=>{
    selectedRoute=$('annotation-selected').value||null;selectedNode=null;
    $('annotation-mode').value='edit';render('編集対象経路を切り替えました。');
  });
  $('annotation-classify').addEventListener('click',()=>{
    if(!draft||!selectedRoute){message('割当対象のガイドまたは経路を選択してください。');return;}
    try {
      const taskType=$('annotation-task').value,phase=$('annotation-phase').value;
      apply(classifyRoute(draft,{routeId:selectedRoute,taskType,phase}),
        '区分を下書きに設定しました。荷役・通行許可・実走行経路の承認ではありません。');
    }catch(error){message(error.message);}
  });
  $('annotation-undo').addEventListener('click',()=>{
    if(proposalStart)proposalStart=null;else pending.pop();
    render('未確定の点選択を取り消しました。');
  });
  $('annotation-save-route').addEventListener('click',()=>{
    if(!draft)return;
    try {
      const id=$('annotation-route-id').value.trim();
      apply(addRoute(draft,{id,taskType:$('annotation-task').value,
        phase:$('annotation-phase').value,nodeIds:pending}),
      '経路'+id+'を下書き保存しました。走行可能とは判定していません。');
      selectedRoute=id;pending=[];$('annotation-mode').value='edit';render();
    }catch(error){message(error.message);}
  });
  $('annotation-remove-point').addEventListener('click',()=>{
    if(!selectedRoute||!selectedNode){message('経路と削除対象の点を選択してください。');return;}
    const route=draft.routes.find(r=>r.id===selectedRoute);
    const nodeIndex=route?.nodeIds.indexOf(selectedNode)??-1;
    try {
      apply(removeRoutePoint(draft,{routeId:selectedRoute,nodeIndex}),
        '経路から点を外しました。点自体は他の経路で再利用できます。');
      selectedNode=null;
    }catch(error){message(error.message);}
  });
  $('annotation-delete-route').addEventListener('click',()=>{
    if(!selectedRoute)return;
    if(!confirm('経路'+selectedRoute+'を削除しますか？図上点は残ります。'))return;
    apply(deleteRoute(draft,selectedRoute),'経路を削除しました。');
    selectedRoute=null;selectedNode=null;render();
  });
  $('annotation-undo-edit').addEventListener('click',()=>{
    if(!history.length)return;
    future.push(draft);draft=history.pop();selectedNode=null;render('編集を取り消しました。');
  });
  $('annotation-redo-edit').addEventListener('click',()=>{
    if(!future.length)return;
    history.push(draft);draft=future.pop();selectedNode=null;render('編集をやり直しました。');
  });
  $('annotation-zoom-in').addEventListener('click',()=>setZoom(zoom*1.5));
  $('annotation-zoom-out').addEventListener('click',()=>setZoom(zoom/1.5));
  $('annotation-zoom-reset').addEventListener('click',()=>setZoom(1));
  function setZoom(next) {
    zoom=Math.max(1,Math.min(12,next));
    stage.style.width=(zoom*100)+'%';
    $('annotation-zoom').textContent=Math.round(zoom*100)+'%';
  }
  $('annotation-export').addEventListener('click',()=>{
    if(!draft)return;
    const file=new Blob([JSON.stringify(draft,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(file),a=document.createElement('a');
    a.href=url;a.download='private-route-draft.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    render('下書きJSONを端末に保存しました。公開Gitへ追加しないでください。');
  });
  $('annotation-import').addEventListener('change',async()=>{
    const file=$('annotation-import').files?.[0];
    if(!file||!draft)return;
    try {
      if(file.size>2_000_000)throw new Error('JSONは2MB以下にしてください。');
      const parsed=JSON.parse(await file.text());
      const imported=validateAnnotation(parsed,draft.backgroundSha256,draft.cadViewBox);
      if((draft.nodes.length||draft.routes.length)&&
        !confirm('現在の点・経路を、読込JSONの内容で置き換えますか？'))return;
      apply(imported,'同じCADプレビューの下書きを読み込みました。');
      selectedRoute=null;selectedNode=null;pending=[];proposalStart=null;render();
    }catch(error){message(error.message);}
    finally{$('annotation-import').value='';}
  });
  render();
  return {
    hasChanges:()=>Boolean(draft&&(draft.nodes.length||draft.routes.length)),
    setBackground:(sha,viewBox)=>{
      draft=createAnnotation(sha,viewBox);pending=[];proposalStart=null;
      selectedRoute=null;selectedNode=null;history=[];future=[];setZoom(1);render();
    },
    clearBackground:()=>{
      draft=null;pending=[];proposalStart=null;
      selectedRoute=null;selectedNode=null;history=[];future=[];setZoom(1);render();
    }
  };
}
