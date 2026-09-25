import {initRouteEditor} from './route-editor.mjs';
const $=id=>document.getElementById(id);
export function initCadPanel({showError,clearError}) {
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

        $('cad-viewport').hidden=false;
        $('cad-state').textContent='AGF除外を利用者が確認した非公開CADプレビュー表示中。単位はプレビュー生成時の指定に依存します。縮尺・原点は未照合。経路・点は手動下書きで、AGF実位置・所要時間は未確定です。';
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

  $('private-cad-file').value='';
  $('cad-agf-excluded').checked=false;
  if(cadBlobUrl)URL.revokeObjectURL(cadBlobUrl);
  cadBlobUrl=null;
  routeEditor.clearBackground();
  $('cad-state').textContent='CAD未読み込み：ローカルプレビューを選択してください。';
});

}
