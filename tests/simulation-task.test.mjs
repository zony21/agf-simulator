import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {simulate} from '../src/core/simulate.mjs';
import {createLegacyScenario} from '../src/ui/scenario.mjs';
import {calculateSimulation} from '../src/ui/simulation-task.mjs';
import {analyzeRun} from '../src/ui/replay-model.mjs';
import {buildTransportHistoryRows} from '../src/ui/transport-history.mjs';
import {renderAnalysis,renderAnalysisDetails,renderComparison} from '../src/ui/analysis-view.mjs';
import {scenarioWithRunInput} from '../src/ui/run-input.mjs';

const scenario=()=>{const s=createLegacyScenario();s.durationMin=12;return s;};

test('progress reporting changes no event, saved state, analysis or transport history',()=>{
  const s=scenario(),expected=simulate(s),saved=structuredClone(s),progress=[];
  const payload=calculateSimulation({scenario:s,runId:'SYN-PERF',executedAt:'2026-10-29T00:00:00Z'},p=>progress.push(p));
  assert.deepEqual(s,saved);assert.deepEqual(payload.run.events,expected.events);assert.deepEqual(payload.run.snapshots,expected.snapshots);
  assert.deepEqual(payload.run.final,expected.final);assert.deepEqual(payload.analysis,analyzeRun(expected));
  assert.deepEqual(payload.transportHistory,buildTransportHistoryRows(expected));
  assert.equal(payload.run.runId,'SYN-PERF');assert.match(payload.analysisDetailsHtml,/SYN-PERF/);
  assert.ok(progress.some(p=>p.timeMs===0));assert.ok(progress.some(p=>p.timeMs===720000));assert.equal(progress.at(-1).phase,'results');
  assert.ok(!payload.analysisHtml.includes('id="run-conditions-title"'));
  assert.equal(payload.analysisDetailsHtml,renderAnalysisDetails(payload.run,payload.analysis));
  assert.match(payload.analysisDetailsHtml,/run-conditions-title/);
  assert.ok(payload.analysisHtml.length<renderAnalysis(payload.run,payload.analysis).length);
});
test('comparison calculates the same three modes and returns the complete report without three replay copies',()=>{
  const s=scenario(),payload=calculateSimulation({scenario:s,kind:'compare'});
  const runs=['area_first','low_battery_first','source_area_agf_priority'].map(mode=>simulate({...s,mode}));
  assert.equal(payload.count,3);assert.equal(payload.html,renderComparison(runs));assert.equal(payload.run,undefined);
});
test('manual-input preparation preserves the previous Run on validation failure',()=>{
  const previous=simulate(scenario()),saved=structuredClone(previous.scenario);
  const candidate=scenarioWithRunInput(previous,'manualRequests',{timeMs:0,kind:'05',palletId:'MISSING'});
  assert.throws(()=>calculateSimulation({scenario:candidate}));assert.deepEqual(previous.scenario,saved);
  assert.throws(()=>scenarioWithRunInput({previewOnly:true},'manualRequests',{}),/先に/);
});
test('real worker delivers serializable results identical to direct engine computation',async()=>{
  const s=scenario(),expected=simulate(s);
  const worker=new Worker(new URL('./fixtures/simulation-worker-node.mjs',import.meta.url));
  try{
    const payload=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',message=>{
      if(message.type==='result')resolve(message.payload);else if(message.type==='error')reject(new Error(message.error.message));
    });worker.postMessage({scenario:s});});
    assert.deepEqual(payload.run.events,expected.events);assert.deepEqual(payload.run.snapshots,expected.snapshots);
    assert.deepEqual(payload.run.final,expected.final);
  }finally{await worker.terminate();}
});
