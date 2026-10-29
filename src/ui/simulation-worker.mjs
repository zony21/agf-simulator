import {calculateSimulation} from './simulation-task.mjs';

self.onmessage=({data})=>{
  try{
    const payload=calculateSimulation(data,progress=>self.postMessage({type:'progress',progress}));
    self.postMessage({type:'result',payload});
  }catch(error){self.postMessage({type:'error',error:{name:error.name,message:error.message}});}
};
