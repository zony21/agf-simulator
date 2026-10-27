import {WAREHOUSE_BLOCKS,FLEXIBLE_WAREHOUSE_AREA} from './warehouse-layout.mjs';

// User-confirmed allocation order only. This does not establish drivable
// connections, coordinates, storage tiers or adjacency across other blocks.
const wb1Rows=WAREHOUSE_BLOCKS.find(block=>block.id==='WB1').rows;
const bridgeRows=FLEXIBLE_WAREHOUSE_AREA.rows;
const displayBlocks=['WB1',FLEXIBLE_WAREHOUSE_AREA.id,'WB2','WB3','EB1','EB2'];

export function warehouseRowPosition({blockId,row}){
  const westOffset=({WB1:0,[FLEXIBLE_WAREHOUSE_AREA.id]:wb1Rows,WB2:wb1Rows+bridgeRows})[blockId];
  return {group:westOffset===undefined?blockId:'WB1-FLEX-WB2',index:(westOffset??0)+row-1};
}
export function warehouseRowFromId(rowId){
  const match=/^(.*)-R(\d+)$/.exec(rowId);
  return match?{blockId:match[1],row:Number(match[2])}:null;
}
export function orderedWarehouseRowIds(slots){
  const rows=new Map(slots.filter(slot=>typeof slot.rowId==='string').map(slot=>[slot.rowId,slot]));
  const rank=block=>{const i=displayBlocks.indexOf(block);return i<0?displayBlocks.length:i;};
  return [...rows].sort(([idA,a],[idB,b])=>rank(a.blockId)-rank(b.blockId)||
    (a.blockId===b.blockId?(a.row??0)-(b.row??0):String(a.blockId).localeCompare(String(b.blockId),'en'))||idA.localeCompare(idB,'en')).map(([id])=>id);
}
