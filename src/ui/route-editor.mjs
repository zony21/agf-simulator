import {createAnnotation,addNode,addRoute,validateAnnotation} from '../map/route-annotations.mjs';

const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const colors={'01':'#7ad6e8','02':'#e9ad64','03':'#b2a1ff','04':'#8dd6a0','05':'#e88b8b',charge:'#f4e68a'};

export function initRouteEditor() {
  let draft=null,pending=[];
  const stage=$('cad-stage'),state=$('annotation-state');
  const message=text=>{state.textContent=text;};
  function drawLine(nodes,color) {
    if(nodes.length<2)return;
    const line=document.createElementNS(NS,'polyline');
    line.setAttribute('points',nodes.map(n=>(n.u*1000)+','+(n.v*1000)).join(' '));
    line.setAttribute('fill','none');
    line.setAttribute('stroke',color);
    line.setAttribute('stroke-width','4');
    line.setAttribute('stroke-linejoin','round');
    line.setAttribute('stroke-dasharray','12 8');
    $('cad-overlay').append(line);
  }
  function render(note='') {
    $('cad-overlay').replaceChildren();
    $('cad-node-layer').replaceChildren();
    $('annotation-list').replaceChildren();
    if(!draft) {
      $('cad-editor').hidden=true;
      message('CADプレビューを読み込むと図上編集を開始できます。');
      return;
    }
    $('cad-editor').hidden=false;
    const byId=new Map(draft.nodes.map(n=>[n.id,n]));
    draft.routes.forEach(route=>drawLine(route.nodeIds.map(id=>byId.get(id)),colors[route.taskType]));
    drawLine(pending.map(id=>byId.get(id)),'#ffffff');
    draft.nodes.forEach((node,index)=>{
      const b=document.createElement('button');
      b.type='button';b.className='cad-node '+node.type;
      b.style.left=(node.u*100)+'%';b.style.top=(node.v*100)+'%';
      b.title=node.id+' / '+node.type+(node.xCadMm===undefined?'':' / CAD(mm) '+node.xCadMm+', '+node.yCadMm);
      b.textContent=String(index+1);b.setAttribute('aria-label',b.title);
      b.addEventListener('click',()=>{
        if($('annotation-mode').value==='route') {
          if(pending.length>=200){message('経路に指定できる点は200点までです。');return;}
          if(pending.at(-1)===node.id){message('同じ点を続けて指定できません。');return;}
          pending.push(node.id);
          render('経路の選択点：'+pending.join(' → '));
        } else render(node.id+'：'+node.type+(node.xCadMm===undefined?'':' ／ CAD(mm) ('+node.xCadMm+', '+node.yCadMm+')'));
      });
      $('cad-node-layer').append(b);
    });
    draft.routes.forEach(route=>{
      const d=document.createElement('div');d.className='entry';
      d.textContent=route.id+' / '+route.taskType+' / '+route.phase+' / 下書き：'+route.nodeIds.join(' → ');
      $('annotation-list').append(d);
    });
    const status='下書き：点 '+draft.nodes.length+'／経路 '+draft.routes.length+'。'+
      (draft.cadViewBox?'SVG図面座標をmmとして表示。':'PNGのため正規化座標のみ。')+
      ' 実際の走行経路や所要時間は未検証。';
    message(note?status+' '+note:status);
  }
  stage.addEventListener('click',event=>{
    if(!draft||$('annotation-mode').value!=='point'||event.target.closest('.cad-node'))return;
    const rect=$('cad-image').getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return;
    const u=(event.clientX-rect.left)/rect.width,v=(event.clientY-rect.top)/rect.height;
    try {
      draft=addNode(draft,{id:$('annotation-point-id').value.trim(),
        type:$('annotation-point-type').value,u,v});
      $('annotation-point-id').value='P'+String(draft.nodes.length+1).padStart(2,'0');
      render('点を登録しました。');
    }catch(error){message(error.message);}
  });
  $('annotation-mode').addEventListener('change',()=>render());
  $('annotation-task').addEventListener('change',()=>{
    if($('annotation-task').value==='charge')$('annotation-phase').value='charge';
    else if($('annotation-phase').value==='charge')$('annotation-phase').value='loaded';
  });
  $('annotation-undo').addEventListener('click',()=>{
    pending.pop();render('現在選択中の経路末尾を取り消しました。');
  });
  $('annotation-save-route').addEventListener('click',()=>{
    if(!draft)return;
    try {
      draft=addRoute(draft,{id:$('annotation-route-id').value.trim(),
        taskType:$('annotation-task').value,phase:$('annotation-phase').value,nodeIds:pending});
      pending=[];$('annotation-route-id').value='R'+String(draft.routes.length+1).padStart(2,'0');
      render('経路を下書き保存しました。走行可能とは判定していません。');
    }catch(error){message(error.message);}
  });
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
      const result=validateAnnotation(parsed,draft.backgroundSha256,draft.cadViewBox);
      if((draft.nodes.length||draft.routes.length)&&
        !confirm('現在の未保存の点・経路を、読込JSONの内容で置き換えますか？'))return;
      draft=result;pending=[];render('同じCADプレビューに紐づく下書きJSONを読み込みました。');
    }catch(error){message(error.message);}
    finally{$('annotation-import').value='';}
  });
  render();
  return {
    hasChanges:()=>Boolean(draft&&(draft.nodes.length||draft.routes.length)),
    setBackground:(sha,viewBox)=>{draft=createAnnotation(sha,viewBox);pending=[];render();},
    clearBackground:()=>{draft=null;pending=[];render();}
  };
}
