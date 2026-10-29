/** Version flat task/pallet records on mutation, not on every motion event.
 * Nested fields follow the existing entity contract: replace them as a whole;
 * immutable routes may be shared by the supplied save function. */
export function createSnapshotEntities(entries=[],{save=value=>Object.freeze(structuredClone({...value}))}={}){
  const entities=new Map(),dirty=new Set(),saved=new Map();let list=Object.freeze([]),changed=false;
  const set=entities.set.bind(entities),remove=entities.delete.bind(entities),clear=entities.clear.bind(entities);
  entities.set=(id,value)=>{
    const tracked=new Proxy(value,{
      set(target,key,next){if(!Object.hasOwn(target,key)||!Object.is(target[key],next)){target[key]=next;dirty.add(id);}return true;},
      deleteProperty(target,key){if(Object.hasOwn(target,key)){delete target[key];dirty.add(id);}return true;}
    });
    set(id,tracked);dirty.add(id);changed=true;return entities;
  };
  entities.delete=id=>{if(!remove(id))return false;dirty.delete(id);saved.delete(id);changed=true;return true;};
  entities.clear=()=>{if(entities.size){clear();dirty.clear();saved.clear();changed=true;}};
  for(const [id,value] of entries)entities.set(id,value);
  return {entities,snapshot(){
    if(dirty.size||changed){
      for(const id of dirty)saved.set(id,save(entities.get(id)));
      list=Object.freeze([...entities.keys()].map(id=>saved.get(id)));dirty.clear();changed=false;
    }
    return list;
  }};
}
