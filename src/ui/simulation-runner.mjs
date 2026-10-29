/** One disposable worker per calculation. Failed/cancelled candidates never replace a saved Run. */
export function createSimulationRunner({createWorker=()=>new Worker(new URL('./simulation-worker.mjs',import.meta.url),{type:'module'})}={}){
  let active=null;
  return {
    get busy(){return active!==null;},
    run(scenario,{kind='run',onProgress=()=>{},runId,executedAt}={}){
      if(active)return Promise.reject(new Error('現在計算中です。完了を待つか中止してください。'));
      return new Promise((resolve,reject)=>{
        let worker;
        const job={reject,finish(error,payload){
          if(active!==job)return;
          active=null;worker?.terminate();error?reject(error):resolve(payload);
        }};
        active=job;
        try{
          worker=createWorker();
          worker.onmessage=({data})=>{
            if(active!==job)return;
            if(data.type==='progress')onProgress(data.progress);
            else if(data.type==='result')job.finish(null,data.payload);
            else if(data.type==='error')job.finish(Object.assign(new Error(data.error.message),{name:data.error.name??'Error'}));
          };
          worker.onerror=event=>{event.preventDefault?.();job.finish(new Error(event.message||'計算用Workerを起動できませんでした。HTTPで画面を開き直してください。'));};
          worker.onmessageerror=()=>job.finish(new Error('計算結果を読み込めませんでした。以前の結果を保持します。'));
          worker.postMessage({scenario,kind,...(runId!==undefined?{runId}:{}),...(executedAt!==undefined?{executedAt}:{})});
        }catch(error){job.finish(error);}
      });
    },
    cancel(){if(active){const error=new Error('計算を中止しました。');error.name='AbortError';active.finish(error);}}
  };
}
