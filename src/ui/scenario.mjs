import {warehouseLocations} from '../map/warehouse-layout.mjs';

/** All inventory, input streams and timing here are explicit, reproducible sample assumptions. */
export function createDemoScenario(preset='standard') {
  if(!['standard','charge','manual'].includes(preset))throw new Error('Unknown sample scenario');
  const warehouse=warehouseLocations();
  // Exercise all status styles with declared sample state, never a claim about actual inventory.
  warehouse.at(-1).permission=false;
  warehouse.find(slot=>slot.id==='WB1-R07-C13-T2').palletIds=['SIM-INITIAL-1'];
  const generatedDestinationIds=warehouse.filter(slot=>slot.column<=9&&slot.permission&&
    !slot.palletIds?.length).sort((a,b)=>a.column-b.column||a.tier-b.tier||a.row-b.row||
      a.blockId.localeCompare(b.blockId,'en')).map(slot=>slot.id);
  return {
    preset,durationMin:180,mode:'area_first',fallback:'any',lineCapacity:2,
    evidence:{structure:'user-confirmed',coordinates:'unreviewed',inventory:'synthetic',
      production:'synthetic-intervals',timing:'scenario-assumption',battery:'scenario-assumption'},
    lineIntervalsMin:Array(8).fill(preset==='manual'?0:41),
    lineStartOffsetsMin:Array.from({length:8},(_,i)=>Number((i*41/8).toFixed(3))),
    generatedDestinationIds,
    wrapper:{inputCapacity:1,outputCapacity:2},
    agfs:Array.from({length:4},(_,i)=>({id:'AGF'+(i+1),area:i<2?'PZ':'WH',
      batteryPct:preset==='charge'?41:100,status:'idle'})),
    chargerIds:['CHARGER1','CHARGER2'],
    battery:{reservePct:40,chargeStartPct:40,chargeTargetPct:80,consumptionPct:1.5,chargeMinPerPct:2.4},
    times:{emptyMin:2,loadedMin:3,pickupMin:.5,dropoffMin:.5,wrapMin:3.3,labelMin:.2,exitMin:.2,chargeTravelMin:2},
    warehouse,
    magazines:Array.from({length:5},(_,i)=>({id:'M'+(i+1),quantity:4,capacity:20,trigger:3,refillBatch:10,permission:true})),
    aligners:Array.from({length:5},(_,i)=>({id:'AL'+(i+1),ready:false})),
    temporaryPallets:[1,2,3].map(i=>({palletId:'SIM-TEMP-'+i,locationId:'OT'+i,
      destinationLocationId:generatedDestinationIds.at(-i)})),
    manualRequests:[],magazineUses:[],alignerReadyEvents:[]
  };
}
