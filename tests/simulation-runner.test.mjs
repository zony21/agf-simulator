import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulationRunner} from '../src/ui/simulation-runner.mjs';

class FakeWorker{
  terminated=false;message=null;
  postMessage(message){this.message=message;}
  terminate(){this.terminated=true;}
  receive(data){this.onmessage({data});}
}
const fixture=()=>{const workers=[];return {workers,runner:createSimulationRunner({createWorker:()=>{const w=new FakeWorker();workers.push(w);return w;}})};};

test('simulation runs off-thread and resolves only a completed result',async()=>{
  const {workers,runner}=fixture(),progress=[],p=runner.run({durationMin:1440},{onProgress:p=>progress.push(p)}),worker=workers[0];
  assert.equal(runner.busy,true);assert.deepEqual(worker.message,{scenario:{durationMin:1440},kind:'run'});
  worker.receive({type:'progress',progress:{timeMs:60000,durationMs:86400000}});assert.equal(progress.length,1);
  worker.receive({type:'result',payload:{marker:'saved-result'}});
  assert.deepEqual(await p,{marker:'saved-result'});assert.equal(runner.busy,false);assert.equal(worker.terminated,true);
});
test('cancelling calculation terminates the worker and ignores late results',async()=>{
  const {workers,runner}=fixture(),p=runner.run({}),worker=workers[0];
  const rejected=assert.rejects(p,{name:'AbortError'});runner.cancel();await rejected;
  assert.equal(worker.terminated,true);assert.equal(runner.busy,false);
  worker.receive({type:'result',payload:'late'});const next=runner.run({});
  workers[1].receive({type:'result',payload:'new'});assert.equal(await next,'new');
});
test('a second calculation cannot overwrite an active one',async()=>{
  const {workers,runner}=fixture(),p=runner.run({});await assert.rejects(runner.run({}),/計算中/);
  workers[0].receive({type:'result',payload:'first'});assert.equal(await p,'first');
});
test('worker validation errors reject the candidate without providing a replacement Run',async()=>{
  const {workers,runner}=fixture(),p=runner.run({});workers[0].receive({type:'error',error:{name:'Error',message:'invalid capacity'}});
  await assert.rejects(p,/invalid capacity/);assert.equal(runner.busy,false);assert.equal(workers[0].terminated,true);
});
test('worker loading failure clears busy state and permits retry',async()=>{
  const {workers,runner}=fixture(),p=runner.run({});workers[0].onerror({message:'load failed',preventDefault(){}});
  await assert.rejects(p,/load failed/);assert.equal(runner.busy,false);
  const next=runner.run({},{kind:'compare'});assert.equal(workers[1].message.kind,'compare');
  workers[1].receive({type:'result',payload:'comparison'});assert.equal(await next,'comparison');
});
test('unsupported worker environments fail explicitly instead of blocking the page',async()=>{
  const runner=createSimulationRunner({createWorker:()=>{throw new Error('Worker利用不可');}});
  await assert.rejects(runner.run({}),/Worker利用不可/);assert.equal(runner.busy,false);
});
