import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoScenario} from '../src/ui/scenario.mjs';
import {analyzeRun} from '../src/ui/replay-model.mjs';
import {customerRunSummary,renderCustomerResults} from '../src/ui/customer-results.mjs';
import {renderAnalysis} from '../src/ui/analysis-view.mjs';
import {eventCsv} from '../src/ui/export.mjs';
import {transportResultsCsv,transportHistoryCsv} from '../src/ui/customer-export.mjs';
import {TRANSPORT_HISTORY_COLUMNS,buildTransportHistoryRows} from '../src/ui/transport-history.mjs';

// Saved synthetic events/state: P1 has a task; P2 and P3 have not been issued.
function fixture(){
  const scenario=createDemoScenario('standard');scenario.durationMin=1;
  const tasks=[{id:'SYN-T1',kind:'01',palletId:'SYN-P1',originId:'L1',destinationId:'WRAP-INPUT',
    requestedAt:0,assignedAt:null,agfId:null,status:'queued',waitReason:'PICKUP_LOCATION_OCCUPIED'}];
  const pallets=[{palletId:'SYN-P1',lineId:'L1',stage:'line',transportTaskId:'SYN-T1'},
    {palletId:'SYN-P2',lineId:'L1',stage:'line',waitReason:'PICKUP_LOCATION_RESERVED'},
    {palletId:'SYN-P3',lineId:'L2',stage:'exit_ready',waitReason:'SAME_ROW_ACTIVE'}];
  const events=[{type:'RUN_STARTED',timeMs:0,sequence:0},
    {type:'TASK_01_HELD',timeMs:1,sequence:1,palletId:'SYN-P2',lineId:'L1',originId:'L1',
      nodeId:'PZ-L1-PICKUP',reason:'PICKUP_LOCATION_RESERVED',reservedTaskId:'SYN-T1'},
    {type:'TASK_02_HELD',timeMs:2,sequence:2,palletId:'SYN-P3',reason:'SAME_ROW_ACTIVE'},
    {type:'RUN_ENDED',timeMs:60000,sequence:3}];
  const final={tasks,pallets,agfs:scenario.agfs,warehouse:{},lines:{L1:['SYN-P1','SYN-P2']}};
  return {scenario,final,events,snapshots:events.map(()=>structuredClone(final)),metrics:{stored:0}};
}

test('pre-request hold history retains the known transport pattern without inventing a task or AGF',()=>{
  const run=fixture(),rows=buildTransportHistoryRows(run);
  for(const [type,kind] of [['TASK_01_HELD','01'],['TASK_02_HELD','02']]){
    const row=rows.find(row=>row.type===type);
    assert.equal(row.kind,kind);assert.equal(row.taskId,'－');assert.equal(row.agfId,'－');
    assert.deepEqual(row.agfStates,Array(4).fill('－'));
  }
  assert.equal(TRANSPORT_HISTORY_COLUMNS.length,14);
  assert.match(transportHistoryCsv(run),/搬送保留,－,01,SYN-P2/);
});

test('developer event CSV preserves the holder task identity for a reserved pickup location',()=>{
  const csv=eventCsv(fixture(),'SYN-LOCATION-OUTPUT').slice(1).split('\r\n');
  const columns=csv[0].split(','),row=csv.find(row=>row.includes('TASK_01_HELD')).split(',');
  assert.ok(columns.includes('reservedTaskId'));
  assert.equal(row[columns.indexOf('reservedTaskId')],'SYN-T1');
});

test('analysis separates unissued line and outlet pallets from the issued task backlog',()=>{
  const run=fixture(),analysis=analyzeRun(run),data=customerRunSummary(run,analysis);
  assert.equal(analysis.requested,1);assert.equal(analysis.pending,1);
  assert.equal(analysis.preRequestHeld,2);
  assert.deepEqual(analysis.preRequestHeldByKind,{'01':1,'02':1});
  assert.equal(data.pending,1);assert.equal(data.preRequestHeld,2);
  assert.equal(data.byKind.find(row=>row.kind==='01').requested,1);
  assert.equal(data.byKind.find(row=>row.kind==='01').preRequestHeld,1);
  assert.equal(data.byKind.find(row=>row.kind==='02').requested,0);
  assert.equal(data.preRequestHolds.find(row=>row.palletId==='SYN-P2').reason,'荷受けロケーションの使用予約解放待ち');
  assert.equal(data.pendingTasks[0].reason,'荷受けロケーションのAGF退出待ち');
  const html=renderAnalysis(run,analysis);
  assert.match(html,/発行前保留/);assert.match(html,/SYN-P2/);
  assert.doesNotMatch(html,/02発行前保留 2PL/);
  const csv=transportResultsCsv(run).slice(1).split('\r\n').map(row=>row.split(','));
  assert.equal(csv[0].at(-1),'発行前保留PL数');
  assert.deepEqual(csv[1].slice(2),['1','0','1','1']);
});

test('issued completion and unissued line backlog remain distinct instead of claiming nothing is waiting',()=>{
  const run=fixture();run.final.tasks=[];run.final.pallets=run.final.pallets.filter(p=>p.palletId==='SYN-P2');
  run.snapshots=run.events.map(()=>structuredClone(run.final));
  const data=customerRunSummary(run),html=renderCustomerResults(run);
  assert.equal(data.pending,0);assert.equal(data.preRequestHeld,1);
  assert.match(html,/発行前保留/);assert.match(html,/SYN-P2/);
  assert.doesNotMatch(html,/<p class="notice">未完了搬送はありません。<\/p>/);
});

test('a completed upstream 01 never hides an unissued downstream 02 for the same pallet',()=>{
  const run=fixture(),p=run.final.pallets.find(p=>p.palletId==='SYN-P3');
  p.transportTaskId='SYN-OLD-01';
  run.final.tasks.push({id:'SYN-OLD-01',kind:'01',palletId:p.palletId,status:'completed',requestedAt:0,assignedAt:0});
  assert.equal(analyzeRun(run).preRequestHeldByKind['02'],1);
  run.final.tasks.push({id:'SYN-NEXT-02',kind:'02',palletId:p.palletId,status:'queued',requestedAt:1,assignedAt:null});
  assert.equal(analyzeRun(run).preRequestHeldByKind['02'],0);
});
