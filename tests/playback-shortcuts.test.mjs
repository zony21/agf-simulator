import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlaybackShortcut} from '../src/ui/playback-shortcuts.mjs';
import {replayFrameTime} from '../src/ui/replay-model.mjs';

const sequence=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
function fixture(){
  let listener,notifications=0;
  const document={addEventListener:(name,fn)=>{assert.equal(name,'keydown');listener=fn;},
    createElement:()=>({value:'',textContent:''})};
  const speed={options:['1','2','4'].map(value=>({value})),append(option){this.options.push(option);},value:'1'};
  installPlaybackShortcut({document,speed,onUnlock:()=>notifications++});
  const press=(key,extra={})=>listener({key,target:{closest:()=>null},...extra});
  return {speed,press,notifications:()=>notifications};
}
test('Konami sequence reveals exactly one 10x option without changing the selected speed',()=>{
  const f=fixture();assert.deepEqual(f.speed.options.map(o=>o.value),['1','2','4']);
  sequence.slice(0,-1).forEach(key=>f.press(key));assert.equal(f.speed.options.length,3);
  f.press('a');assert.deepEqual(f.speed.options.map(o=>o.value),['1','2','4','10']);
  assert.equal(f.speed.options.at(-1).textContent,'10倍');assert.equal(f.speed.value,'1');
  sequence.forEach(key=>f.press(key));assert.equal(f.speed.options.length,4);assert.equal(f.notifications(),1);
});
test('typing in inputs, composition, repeat and modifier keys cannot unlock 10x',()=>{
  for(const extra of [{target:{closest:()=>({})}},{isComposing:true},{repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true}]){
    const f=fixture();sequence.forEach(key=>f.press(key,extra));assert.equal(f.speed.options.length,3);
  }
  const f=fixture();sequence.slice(0,5).forEach(key=>f.press(key));f.press('x');
  sequence.slice(5).forEach(key=>f.press(key));assert.equal(f.speed.options.length,3);
  sequence.map(key=>key.length===1?key.toUpperCase():key).forEach(key=>f.press(key));assert.equal(f.speed.options.length,4);
});
test('10x replay uses saved simulation time and clamps at the Run horizon',()=>{
  const anchor={sim:1000,wall:null,speed:10};assert.equal(replayFrameTime(anchor,100,8000),1000);
  assert.equal(replayFrameTime(anchor,600,8000),6000);assert.equal(replayFrameTime(anchor,1000,8000),8000);
});
