import {escapeHtml as esc} from './format.mjs';
import {validateVehicleTravelProfile} from '../core/vehicle-travel.mjs';

const speedFields=[['empty.forward','空車・前進速度（m/s）'],['loaded.forward','積載・前進速度（m/s）'],
  ['empty.reverse','空車・後進速度（m/s）'],['loaded.reverse','積載・後進速度（m/s）']];
const directionFields=[['empty','空走時の車体走行方向'],['loaded','積載時の車体走行方向'],
  ['charge','充電移動時の車体走行方向'],['wait','待機復帰時の車体走行方向']];

export function renderVehicleTravelSettings(scenario){
  const p=scenario.vehicleTravelProfile;if(!p)return '';
  return `<h3>車体前後・直進速度</h3><p class="notice">車体前方はフォークと反対側です。前進ではフォークが後ろ、後進ではフォークが先頭になります。VNP20(VL)-66のメーカー公開カタログ上限を初期値に使用します。指定型式VNP20-66(CE)の個体仕様・現場速度との一致は未確認です。通常移動の前進設定は変更可能なモデル条件です。実際の停止位置・進入距離は未確認です。</p>
    ${p.serviceApproachPolicy==='fork-leading-entry'?'<p class="notice">設備の荷役点・保管行の既存アクセス区間は、進入時に後進（フォーク先頭）、退出時に前進へ自動切替します。下の方向設定は通路移動に適用し、荷役点での進入・退出を一律に上書きしません。差し込みのフォーク処理時間は既存の荷役設定を維持します。</p>':''}
    <div class="fields">${speedFields.map(([key,label])=>{const [load,direction]=key.split('.');return `<label>${label}<input type="number" min="0.001" step="0.001" data-vehicle-speed="${key}" aria-label="${label}" value="${esc(p.straightMmPerSec[load][direction]/1000)}" required></label>`;}).join('')}
    ${directionFields.map(([movement,label])=>`<label>${label}<select data-vehicle-direction="${movement}" aria-label="${label}"><option value="forward" ${p.defaultDirection[movement]==='forward'?'selected':''}>前進 · フォークが後ろ</option><option value="reverse" ${p.defaultDirection[movement]==='reverse'?'selected':''}>後進 · フォークが先頭</option></select></label>`).join('')}</div>
    <p class="muted">直進速度の参照：<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">VisionNav公式モデル比較</a>。カタログの旋回走行速度を停止旋回の角速度へ置き換えません。明示された区間速度制限がある場合は、その低い値を使用します。</p>`;
}

/** Form values are m/s; the saved profile and event engine use mm/s. */
export function vehicleTravelProfileFromSettings(previous,values){
  const p=structuredClone(previous);let speedChanged=false,directionChanged=false;
  for(const [key] of speedFields){
    if(!Object.hasOwn(values,key))continue;
    const value=values[key]===''?NaN:Number(values[key])*1000,[load,direction]=key.split('.');
    if(!Number.isFinite(value)||value<=0)throw new Error('VEHICLE_TRAVEL_CONFIG: 直進速度は正のm/s値を入力してください。');
    speedChanged||=p.straightMmPerSec[load][direction]!==value;p.straightMmPerSec[load][direction]=value;
  }
  for(const [movement] of directionFields){
    if(!Object.hasOwn(values,movement))continue;
    directionChanged||=p.defaultDirection[movement]!==values[movement];p.defaultDirection[movement]=values[movement];
  }
  if(speedChanged)p.speedEvidence='explicit-scenario-setting';
  if(directionChanged)p.directionEvidence='explicit-scenario-setting';
  validateVehicleTravelProfile(p);return p;
}
