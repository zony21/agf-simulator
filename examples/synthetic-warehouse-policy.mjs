/** Original synthetic allocation retained for explicit historical regression fixtures.
 * defaultWarehousePolicy() supplies the current editable UI default. */
export function syntheticWarehousePolicy(){
  const groups=[['WB1',1,3,'L1'],['WB1',4,7,'L2'],['WB2',1,3,'L3'],
    ['WB3',1,4,'L4'],['WB3',5,8,'L5'],['WB3',9,13,'L6'],['EB1',1,3,'L7'],
    ['EB2',1,1,'L8'],['EB2',2,3,'SPECIAL']];
  const rowAssignments=[],rowPriority={};
  for(const [block,first,last,owner] of groups){
    rowPriority[owner]=[];
    for(let row=first;row<=last;row++){
      const rowId=`${block}-R${String(row).padStart(2,'0')}`;
      rowAssignments.push({rowId,usage:owner==='SPECIAL'?'special':'normal',sourceLineId:owner==='SPECIAL'?null:owner});
      rowPriority[owner].push(rowId);
    }
  }
  return {evidence:'synthetic-explicit-example',rowAssignments,rowPriority};
}

/** User-requested editable default: each of L1–L8 has at least two rows.
 * Preserve the other example groups; SPECIAL retains one row. No CAD approval. */
export function defaultWarehousePolicy(){
  const policy=syntheticWarehousePolicy();
  Object.assign(policy.rowAssignments.find(a=>a.rowId==='EB2-R02'),{usage:'normal',sourceLineId:'L8'});
  policy.rowPriority.L8=['EB2-R01','EB2-R02'];
  policy.rowPriority.SPECIAL=['EB2-R03'];
  policy.evidence='user-confirmed-min-two-row-default';
  return policy;
}
