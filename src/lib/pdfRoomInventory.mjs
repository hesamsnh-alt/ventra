// Recover complete, tagged room-area inventories already extracted by the AI.
// Never sum anonymous finish totals or assume a room's dimensions/material.
export function recoverPdfRoomInventory(page) {
  if(page.page_evidence?.kind!=='floor_plan')return {page,warnings:[]};
  const rooms=new Map(),warnings=[];
  for(const item of page.detected_items||[]){
    if(!['m2','m²'].includes(String(item.unit).toLowerCase())||!Number.isFinite(item.quantity)||item.quantity<=0)continue;
    const tag=String(item.name||'').match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
    if(!tag)continue;
    if(rooms.has(tag)){warnings.push(`Duplicate room area tag ${tag} on page ${page.pageNumber}; inventory withheld.`);return {page,warnings};}
    const name=String(item.name||''),description=String(item.description||'');
    // Explanatory text such as "hall area = envelope minus terrace and void"
    // does not turn the hall itself into a void or a terrace.
    const finish=/\bVOID\b/i.test(name)||/^VOID\b/i.test(description)?'void':/\bterrace\b|\bbalcony\b/i.test(name)||/^OUTDOOR\b/i.test(description)?'outdoor':/^WOOD\b|^parquet\b/i.test(description)?'wood':/^EPOXY\b/i.test(description)?'epoxy':/^TILE\b|^ceramic\b/i.test(description)?'tile':null;
    rooms.set(tag,{...item,tag,finish});
  }
  if(!rooms.size)return {page,warnings};
  const list=[...rooms.values()],enclosed=list.filter(r=>!['void','outdoor'].includes(r.finish)),outdoor=list.filter(r=>r.finish==='outdoor');
  const inner=enclosed.reduce((s,r)=>s+r.quantity,0),outside=outdoor.reduce((s,r)=>s+r.quantity,0),walkable=inner+outside;
  // Require closure against the independently reported floor summary. A
  // partial list of rooms cannot stand in for a complete floor takeoff.
  if(Math.abs(page.floor_area-walkable)>.01&&Math.abs(page.floor_area-inner)>.01){
    warnings.push(`Room area inventory on page ${page.pageNumber} does not reconcile to its floor summary; finish recovery withheld.`);return {page,warnings};
  }
  const values={floor_area:walkable},scope=page.page_evidence.scope_id;
  const materialKeys={wood:'wood_floor_area',tile:'ceramic_floor_area',epoxy:'epoxy_floor_area',outdoor:'terrace_floor_area'};
  for(const [finish,key] of Object.entries(materialKeys)){
    const matching=list.filter(r=>r.finish===finish);
    if(!matching.length)continue;
    // A claim supplied by the page is not silently overwritten by a different
    // result; normal conflict reconciliation still applies.
    if((page.page_evidence.quantities||[]).some(q=>q.key===key))continue;
    values[key]=matching.reduce((s,r)=>s+r.quantity,0);
  }
  const quantities=(page.page_evidence.quantities||[]).filter(q=>q.key!=='floor_area');
  for(const [key,value] of Object.entries(values))quantities.push({key,value,unit:'m2',scope_id:scope,
    evidence:`Tagged room inventory on page ${page.pageNumber} reconciles to floor summary; ${key}: `+
      list.filter(r=>key==='floor_area'?r.finish!=='void':r.finish===Object.keys(materialKeys).find(k=>materialKeys[k]===key)).map(r=>`${r.tag}=${r.quantity} m2 (${r.description})`).join(' + ')+`. AI room labels/materials require review.`});
  return {page:{...page,floor_area:walkable,page_evidence:{...page.page_evidence,quantities}},warnings};
}
