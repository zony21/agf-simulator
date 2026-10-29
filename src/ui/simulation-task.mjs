import {simulate} from '../core/simulate.mjs';
import {analyzeRun} from './replay-model.mjs';
import {buildTransportHistoryRows} from './transport-history.mjs';
import {renderAnalysis,renderAnalysisDetails,renderComparison} from './analysis-view.mjs';

/** Browser-independent worker task, also exercised by the Node worker adapter. */
export function calculateSimulation({scenario,kind='run',runId,executedAt},onProgress=()=>{}){
  if(kind==='compare'){
    const modes=['area_first','low_battery_first','source_area_agf_priority'],runs=[],analyses=[];
    for(let index=0;index<modes.length;index++){
      const run=simulate({...scenario,mode:modes[index]},
        {onProgress:p=>onProgress({...p,phase:'simulate',runIndex:index,runCount:modes.length})});
      analyses.push(analyzeRun(run));
      // Keep conditions/events/achievements, release each mode's replay frames
      // before calculating the next mode. The complete comparison is retained.
      runs.push({...run,snapshots:[]});
    }
    onProgress({phase:'results'});
    // The comparison screen needs the saved report, not three full replay graphs.
    return {html:renderComparison(runs,analyses),count:runs.length};
  }
  if(kind!=='run')throw new Error('未対応の計算種別です。');
  const run=simulate(scenario,{onProgress:p=>onProgress({...p,phase:'simulate',runIndex:0,runCount:1})});
  if(runId!==undefined)run.runId=runId;
  if(executedAt!==undefined)run.executedAt=executedAt;
  onProgress({phase:'results'});
  const analysis=analyzeRun(run),transportHistory=buildTransportHistoryRows(run),analysisHtml=renderAnalysis(run,analysis,{deferDetails:true});
  return {run,analysis,transportHistory,analysisHtml,analysisDetailsHtml:renderAnalysisDetails(run,analysis)};
}
