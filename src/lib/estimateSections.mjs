// Eight planning headings, independent of any example drawing.
export const ESTIMATE_SECTIONS = Object.freeze([
 {id:'site',name:'Site preparation and earthworks',share:5},
 {id:'structure',name:'Structure and concrete',share:30},
 {id:'envelope',name:'Walls, roof, doors and windows',share:15},
 {id:'finishes',name:'Internal finishes and joinery',share:20},
 {id:'electrical',name:'Electrical and fire protection',share:10},
 {id:'plumbing',name:'Plumbing and drainage',share:7},
 {id:'mechanical',name:'HVAC and mechanical work',share:8},
 {id:'other',name:'External works and other scope',share:5},
]);
export const defaultEstimateShares=()=>Object.fromEntries(ESTIMATE_SECTIONS.map(s=>[s.id,s.share]));
export function estimateSection(row={}){
 const text=[row.section,row.category,row.item_code,row.code,row.description].filter(Boolean).join(' ').toLowerCase();
 if(/electr|lighting|socket|switch|\bele[- ]|fire|\bfir[- ]/.test(text))return 'electrical';
 if(/plumb|drain|sanitary|\bplb[- ]/.test(text))return 'plumbing';
 if(/hvac|mechanical|air.condition|\bhvc[- ]/.test(text))return 'mechanical';
 if(/landscap|external|\bext[- ]|\blan[- ]/.test(text))return 'other';
 if(/earth|excavat|site prep|demolit|preliminar|backfill|enabling/.test(text))return 'site';
 if(/structur|concrete|reinforce|formwork|foundation|\bcon[- ]/.test(text))return 'structure';
 if(/masonry|blockwork|\bmas[- ]|wall|roof|door|window|waterproof/.test(text)&&!/paint|plaster|finish|cladd/.test(text))return 'envelope';
 if(/finish|tiling|tile|floor|paint|joinery|carpentry|plaster|ceiling|screed/.test(text))return 'finishes';
 return 'other';
}
export function eightSectionEstimate(calculation,shares=defaultEstimateShares()){
 const rows=ESTIMATE_SECTIONS.map(s=>({...s,share:Number(shares[s.id]),verified:0,provisional:0,pending:0,count:0}));
 for(const [kind,items] of Object.entries(calculation.groups))for(const item of items){
  const row=rows.find(s=>s.id===estimateSection(item));row.count++;
  if(kind==='pending')row.pending++;
  else row[kind]+=Number(item.quantity)*Number(item.rate);
 }
 const valid=rows.every(r=>Number.isFinite(r.share)&&r.share>=0&&r.share<=100)&&Math.abs(rows.reduce((sum,r)=>sum+r.share,0)-100)<1e-8;
 const totalCents=Math.round(calculation.expectedDirectCost*100);
 const cents=valid?rows.map(row=>Math.floor(totalCents*row.share/100)):[];
 if(valid&&calculation.basis==='benchmark'){
  const ranked=rows.map((row,index)=>({index,fraction:totalCents*row.share/100-cents[index]})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  const remainder=totalCents-cents.reduce((sum,value)=>sum+value,0);
  for(let index=0;index<remainder;index++)cents[ranked[index%ranked.length].index]++;
 }
 rows.forEach((row,index)=>{
  if(calculation.basis==='benchmark'){
   row.cost=valid?cents[index]/100:null;
  }else row.cost=row.verified+(calculation.includedProvisionalCost>0?row.provisional:0);
 });
 return {rows,allocationValid:valid};
}
