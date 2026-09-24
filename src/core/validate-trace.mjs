/** Public-safe synthetic trace validator, not the event scheduler or a physical model. */
export function validateTrace(scenario, events) {
  const fail = (e, msg) => { throw new Error((e ? `[${e.type} @${e.timeMs}]` : '[scenario]') + ' ' + msg); };
  const must = (e, test, msg) => { if (!test) fail(e, msg); };
  const line = new Map(Object.entries(scenario.lineCapacities ?? {}).map(([id,cap])=>[id,{cap,count:0}]));
  const mags = new Map(Object.entries(scenario.magazines ?? {}).map(([id,qty])=>[id,{qty,pending:false}]));
  const agfs = new Map((scenario.agfIds ?? []).map(id=>[id,{status:'idle',task:null,charger:null}]));
  const chargers = new Map((scenario.chargerIds ?? []).map(id=>[id,null]));
  const input = [], output = []; let wrapping = null;
  const pallets = new Map();
  must(null,line.size>0 && agfs.size>0,'at least one line and AGF required');
  must(null,Number.isInteger(scenario.wrapper?.inputCapacity) && scenario.wrapper.inputCapacity>0,'wrapper input capacity required');
  must(null,Number.isInteger(scenario.wrapper?.outputCapacity) && scenario.wrapper.outputCapacity>0,'wrapper output capacity required');
  for(const l of line.values()) must(null,Number.isInteger(l.cap)&&l.cap>0,'invalid line capacity');
  for(const m of mags.values()) must(null,Number.isInteger(m.qty)&&m.qty>=0,'invalid magazine count');
  let previousTime=-1, previousSequence=-1, stored=0;
  for(const e of events){
    must(e,Number.isInteger(e.timeMs)&&e.timeMs>=0 && Number.isInteger(e.sequence)&&e.sequence>=0,'invalid event clock');
    must(e,e.timeMs>previousTime || (e.timeMs===previousTime && e.sequence>previousSequence),'events out of order');
    previousTime=e.timeMs; previousSequence=e.sequence;
    const p=pallets.get(e.palletId), a=agfs.get(e.agfId), l=line.get(e.lineId), m=mags.get(e.magazineId);
    const task=(kind,stage)=>a && a.status==='working' && a.task?.kind===kind && a.task.palletId===e.palletId && p?.stage===stage;
    switch(e.type){
      case 'PALLET_EXITED':
        must(e,l,'unknown line'); must(e,!p,'duplicate pallet ID');
        must(e,l.count<l.cap,'line buffer overflow');
        l.count++; pallets.set(e.palletId,{stage:'line',lineId:e.lineId}); break;
      case 'TASK_01_ASSIGNED':
        must(e,p?.stage==='line' && a?.status==='idle','01 requires a line pallet and idle AGF');
        a.status='working'; a.task={kind:'01',palletId:e.palletId}; p.stage='assigned_01'; break;
      case 'TASK_01_PICKED':
        must(e,task('01','assigned_01'),'01 pickup without assignment');
        line.get(p.lineId).count--; p.stage='on_agf_01'; break;
      case 'TASK_01_DROPPED':
        must(e,task('01','on_agf_01'),'01 drop without pickup');
        must(e,input.length<scenario.wrapper.inputCapacity,'wrapper input overflow');
        input.push(e.palletId); p.stage='wrapper_input'; a.status='idle'; a.task=null; break;
      case 'WRAP_STARTED':
        must(e,wrapping===null && p?.stage==='wrapper_input','wrap start invalid');
        wrapping=e.palletId; input.splice(input.indexOf(e.palletId),1); p.stage='wrapping'; break;
      case 'WRAP_COMPLETED':
        must(e,wrapping===e.palletId && p?.stage==='wrapping','wrap completion invalid');
        must(e,output.length<scenario.wrapper.outputCapacity,'wrapper output overflow');
        wrapping=null; output.push(e.palletId); p.stage='wrapped'; break;
      case 'LABEL_COMPLETED':
        must(e,p?.stage==='wrapped','label requires wrapped pallet'); p.stage='labeled'; break;
      case 'EXIT_READY':
        must(e,p?.stage==='labeled','exit requires label completion'); p.stage='exit_ready'; break;
      case 'TASK_02_ASSIGNED':
        must(e,p?.stage==='exit_ready' && a?.status==='idle','02 requires exit-ready pallet and idle AGF');
        a.status='working'; a.task={kind:'02',palletId:e.palletId}; p.stage='assigned_02'; break;
      case 'TASK_02_PICKED':
        must(e,task('02','assigned_02'),'02 pickup without assignment');
        output.splice(output.indexOf(e.palletId),1); p.stage='on_agf_02'; break;
      case 'TASK_02_STORED':
        must(e,task('02','on_agf_02'),'02 storage without pickup');
        p.stage='stored'; a.status='idle'; a.task=null; stored++; break;
      case 'CHARGE_STARTED':
        must(e,a?.status==='idle' && chargers.has(e.chargerId) && chargers.get(e.chargerId)===null,'charging slot unavailable or AGF busy');
        a.status='charging'; a.charger=e.chargerId; chargers.set(e.chargerId,e.agfId); break;
      case 'CHARGE_ENDED':
        must(e,a?.status==='charging' && a.charger===e.chargerId && chargers.get(e.chargerId)===e.agfId,'invalid charge end');
        a.status='idle'; a.charger=null; chargers.set(e.chargerId,null); break;
      case 'MAGAZINE_USED':
        must(e,m && m.qty>0,'magazine empty or unknown'); m.qty--; break;
      case 'MAGAZINE_REFILL_REQUESTED':
        must(e,m && m.qty===scenario.refillTrigger && !m.pending,'refill request must occur once at exact trigger');
        m.pending=true; break;
      case 'MAGAZINE_REFILLED':
        must(e,m?.pending && e.sourceReady===true && Number.isInteger(scenario.refillBatch) && scenario.refillBatch>0,'refill needs pending request, ready source and batch');
        m.qty+=scenario.refillBatch; m.pending=false; break;
      default: fail(e,'unsupported event');
    }
  }
  return {stored, lineCounts:Object.fromEntries([...line].map(([id,v])=>[id,v.count])),wrapper:{input:input.length,processing:wrapping,output:output.length},agfs:Object.fromEntries(agfs),chargers:Object.fromEntries(chargers),magazines:Object.fromEntries(mags)};
}
