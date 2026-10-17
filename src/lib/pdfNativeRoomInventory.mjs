const tagOf=value=>String(value||'').trim().match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
const finishOf=value=>{
 const text=String(value||'').toUpperCase(),values=new Set([...text.matchAll(/(?:^|\||\/|M(?:2|²)\s+)\s*(WOOD|TILE|EPOXY|OUTDOOR|VOID)\b/g)].map(m=>m[1].toLowerCase()));
 if(/\bVOID\s*$/.test(text))values.add('void');
 return values.size===1?[...values][0]:null;
};
const printedArea=value=>String(value||'').match(/(?:^|\s|\|)(\d+(?:\.\d+)?)\s*m(?:2|²)(?=\s|$|\|)/i);

// Repair an omitted room inventory from positioned source labels. This never
// constructs a polygon, infers a missing area, or uses an expected BOQ value.
// Unmeasured labels remain subject to the existing full-envelope audit.
export function recoverNativeRoomInventory(page,validatedSpaces){
 const original=page.detected_items||[],native=page.native_plan_text;
 if(native?.status!=='readable'||!Array.isArray(native.spans)||native.spans.length>3000)return {items:original,recovered:[]};
 const shapes=new Map(validatedSpaces.map(s=>[tagOf(s.tag),s])),captions=new Map(),recovered=[];
 for(const span of native.spans){
  const tag=tagOf(span.text);
  if(!tag||!/^\S+\s+\S/.test(span.text))continue;
  const list=captions.get(tag)||[];list.push(span);captions.set(tag,list);
 }
 const items=[...original];
 for(const [tag,rows] of captions){
  if(rows.length!==1||original.some(i=>tagOf(i.name)===tag&&['m2','m²'].includes(String(i.unit).toLowerCase())))continue;
  const caption=rows[0],shape=shapes.get(tag),inline=printedArea(caption.text);
  const neighbours=native.spans.filter(s=>Math.abs(caption.angle||0)<.001&&s!==caption&&Math.abs(s.angle||0)<.001&&s.y<caption.y&&caption.y-s.y<=2.5*caption.height&&
   Math.abs(s.x-caption.x)<=Math.max(20,4*caption.height)&&printedArea(s.text)&&finishOf(s.text));
  if(!inline&&neighbours.length>1)continue;
  const areaLine=inline?caption:neighbours.length===1?neighbours[0]:null;
  const finish=finishOf(caption.text)||finishOf(areaLine?.text);
  if(!finish)continue;
  if(finishOf(caption.text)&&finishOf(areaLine?.text)&&finishOf(caption.text)!==finishOf(areaLine.text))continue;
  const match=areaLine&&printedArea(areaLine.text),labelArea=match?Number(match[1]):null;
  const quantity=labelArea??shape?.quantity;
  if(!Number.isFinite(quantity)||quantity<=0||quantity>1e6)continue;
  if(shape&&(finish==='void'?shape.kind!=='void':finish==='outdoor'?shape.kind!=='outdoor':shape.kind!=='enclosed')||shape&&finish!=='void'&&shape.finish!==finish)continue;
  const evidence=labelArea!==null?`printed source label: ${caption.text}; ${areaLine.text}`:
   `independently dimensioned polygon for source label ${caption.text}; ${shape.evidence}`;
  const name=caption.text.trim().replace(/\s*\|.*$/,'').replace(/\s*\/\s*(?:WOOD|TILE|EPOXY|OUTDOOR|VOID)\s*$/i,'');
  items.push({name,unit:'m2',quantity,description:`${finish.toUpperCase()} | ${evidence}`});
  recovered.push({tag,page:page.pageNumber,basis:labelArea!==null?'native_printed_area':'existing_validated_polygon',source_label:caption.text});
 }
 return {items,recovered};
}
