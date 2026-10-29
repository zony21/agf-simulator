/** Copy-on-write snapshots of mutable plain state. Frozen route geometry is shared.
 * Live proxies remain inside the engine; snapshot() returns plain serializable data. */
export function createSnapshotState(initial){
  const records=new WeakMap(),rawValues=new WeakMap();
  const raw=value=>rawValues.get(value)??value;
  const trackable=value=>value&&typeof value==='object'&&!Object.isFrozen(value)&&
    (Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype);
  const mark=(record,seen=new Set())=>{
    if(seen.has(record))return;seen.add(record);record.dirty=true;
    for(const parent of record.parents)mark(parent,seen);
  };
  const recordFor=(input,parent)=>{
    const target=raw(input);let record=records.get(target);
    if(!record){
      record={target,parents:new Set(),dirty:true,saved:null};records.set(target,record);
      record.proxy=new Proxy(target,{
        get(target,key,receiver){const value=Reflect.get(target,key,receiver);return trackable(raw(value))?recordFor(value,record).proxy:value;},
        set(target,key,value){value=raw(value);if(!Object.hasOwn(target,key)||!Object.is(target[key],value)){target[key]=value;mark(record);}return true;},
        deleteProperty(target,key){if(Object.hasOwn(target,key)){delete target[key];mark(record);}return true;}
      });
      rawValues.set(record.proxy,target);
    }
    if(parent)record.parents.add(parent);
    return record;
  };
  const save=record=>{
    if(!record.dirty)return record.saved;
    const next=Array.isArray(record.target)?new Array(record.target.length):{};
    record.saved=next;record.dirty=false;
    for(const key of Object.keys(record.target)){
      const value=raw(record.target[key]);
      next[key]=trackable(value)?save(recordFor(value,record)):
        value&&typeof value==='object'&&!Object.isFrozen(value)?structuredClone(value):value;
    }
    return Object.freeze(next);
  };
  const root=recordFor(initial);
  return {value:root.proxy,snapshot:()=>save(root)};
}

/** Version small serializable equipment/traffic sections with native JSON
 * fingerprints. Never rescan the large independently versioned replay tables. */
export function createSnapshotSections(){
  const cache=new Map(),versioned=new Set(['agfs','tasks','pallets','warehouse','warehouseShipping']);
  const freeze=value=>{
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      for(const child of Object.values(value))freeze(child);Object.freeze(value);
    }
    return value;
  };
  return next=>{
    for(const [key,value] of Object.entries(next)){
      if(versioned.has(key)||!value||typeof value!=='object')continue;
      const fingerprint=JSON.stringify(value),previous=cache.get(key);
      if(previous?.fingerprint===fingerprint)next[key]=previous.value;
      else cache.set(key,{fingerprint,value:freeze(value)});
    }
    return Object.freeze(next);
  };
}
