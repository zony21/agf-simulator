import {parentPort} from 'node:worker_threads';
import {calculateSimulation} from '../../src/ui/simulation-task.mjs';
parentPort.on('message',data=>{
  try{parentPort.postMessage({type:'result',payload:calculateSimulation(data)});}
  catch(error){parentPort.postMessage({type:'error',error:{message:error.message}});}
});
