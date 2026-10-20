import {nativePdfSupplementaryScope} from './pdfNativeSupplementaryScope.mjs';
// Only explicit arithmetic source statements are recognized here. Unknown
// prose is left unresolved; no project quantities or measurement defaults.
import {nativeCoordinatedPdfCalculations} from './pdfNativeCoordinatedQuantities.mjs';
import {nativePdfServiceOperations} from './pdfNativeServiceOperations.mjs';
export function nativePdfDocumentCalculations(pages,review,validate){
 const supplementary=nativePdfSupplementaryScope(pages);
 const calculations=[...supplementary.calculations],issues=[...supplementary.issues],readable=pages.filter(p=>p.native_text_evidence?.status==='readable');
 const coordinated=nativeCoordinatedPdfCalculations(pages);
 const services=coordinated.details.length?nativePdfServiceOperations(pages,coordinated.details):{operations:[],issues:[]};
 calculations.push(...coordinated.calculations);issues.push(...coordinated.issues);
 issues.push(...services.issues);
 const texts=readable.map(p=>({page:p.pageNumber,text:[...p.native_text_evidence.spans].sort((a,b)=>b.y-a.y||a.x-b.x).map(s=>s.text).join(' ')}));
 const cabinets=[];
 for(const p of texts.filter(p=>pages.find(x=>x.pageNumber===p.page)?.page_evidence?.kind==='specification')){
  const matches=[...p.text.matchAll(/\bbase cabinets?\s+measured\s+((?:\d+(?:\.\d+)?\s*\+\s*)+\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)\s+linear met(?:re|er)s\b/gi)];
  for(const m of matches){const lengths=m[1].split('+').map(Number);if(lengths.length>20||lengths.some(v=>!Number.isFinite(v)||v<=0)||Math.abs(lengths.reduce((a,b)=>a+b,0)-Number(m[2]))>1e-6){issues.push('Printed cabinet equation is inconsistent');continue;}
   cabinets.push({key:'kitchen_cabinet_length',scope_id:'project',evidence:`Original PDF explicit cabinet measurement equation: ${m[0]}`,terms:lengths.map((v,i)=>({id:`native-cabinet-leg:${i+1}`,operation:'add',factors:[{value:v,unit:'m',operation:'multiply',pages:[p.page],evidence:m[0],clip:null}]}))});
  }
 }
 if(cabinets.length===1)calculations.push(cabinets[0]);else if(cabinets.length>1)issues.push('Multiple cabinet statements require physical scope reconciliation');
 const convention=texts.filter(p=>/slab soffit includes beam (?:undersides|soffits)/i.test(p.text)&&/beam formwork contains ONLY two downstand sides/i.test(p.text));
 if(convention.length===1){
  const terms=[];let valid=true;
  for(const [key,label] of [['first_slab_volume','First'],['roof_slab_volume','Roof']]){
   const candidates=(review.calculations||[]).filter(c=>c.key===key),thicknesses=texts.filter(p=>/All dimensions (?:in|are) metres/i.test(p.text)).flatMap(p=>[...p.text.matchAll(new RegExp(`\\b${label} slab:\\s*(\\d*\\.\\d+|\\d+)\\s*;\\s*omit\\s+(\\d+(?:\\.\\d+)?)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s+(?:stair void|terrace)\\b`,'gi'))].map(m=>({value:Number(m[1]),omit:[Number(m[2]),Number(m[3])].sort((a,b)=>a-b),page:p.page,evidence:m[0]})));
   if(candidates.length!==1||thicknesses.length!==1||!(thicknesses[0].value>0)){valid=false;break;}
   const c=candidates[0],t=thicknesses[0];try{validate(c);}catch{valid=false;break;}
   // The supported source statement describes one gross rectangle and one
   // explicit rectangular omission. Verify operands against independent PDF
   // text instead of trusting an earlier dimensionally valid model number.
   if(c.terms.length!==2||c.terms.filter(x=>x.operation==='add').length!==1||c.terms.filter(x=>x.operation==='subtract').length!==1){valid=false;break;}
   const envelopePairs=pages.filter(p=>p.page_evidence?.kind==='floor_plan'&&c.terms.some(term=>term.factors.some(f=>f.pages.includes(p.pageNumber))))
    .flatMap(p=>(p.native_plan_text?.spans||[]).flatMap(s=>[...s.text.matchAll(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)].map(m=>[Number(m[1]),Number(m[2])].sort((a,b)=>a-b))));
   const uniqueEnvelopes=[...new Map(envelopePairs.map(pair=>[pair.join(','),pair])).values()];if(uniqueEnvelopes.length!==1){valid=false;break;}
   for(const term of c.terms){const eligible=term.factors.filter(f=>f.operation==='multiply'&&!f.clip&&['m','mm'].includes(f.unit)&&/slab thickness/i.test(f.evidence)&&Math.abs(f.value*(f.unit==='mm'?.001:1)-t.value)<1e-7&&f.pages.includes(t.page));
    if(eligible.length!==1){valid=false;break;}
    const remaining=term.factors.filter(f=>f!==eligible[0]),expected=term.operation==='add'?uniqueEnvelopes[0]:t.omit;
    const measured=remaining.map(f=>f.operation==='multiply'&&!f.clip&&['m','mm'].includes(f.unit)?f.value*(f.unit==='mm'?.001:1):NaN).sort((a,b)=>a-b);
    if(measured.length!==2||measured.some((n,i)=>!Number.isFinite(n)||Math.abs(n-expected[i])>1e-6)){valid=false;break;}
    terms.push({...term,id:`native-soffit:${key}:${term.id}`,factors:remaining.map(f=>({...f,pages:[...new Set([...f.pages,t.page,convention[0].page])],evidence:`${f.evidence}; original source ${t.evidence}; envelope ${uniqueEnvelopes[0].join(' x ')} m`}))});
   }
  }
  if(valid&&terms.length)calculations.push({key:'slab_formwork_area',scope_id:'project',terms,evidence:`Source suspended first/roof slab volume operands divided by their explicit source thickness; source page ${convention[0].page}: slab soffit includes beam undersides. Full original volume calculations and remaining area units validated; beam strips are not added again. Source operand transcription still requires review.`});
  else issues.push('Slab soffit could not be derived from complete source thickness/volume operands');
 }
 return {calculations,issues,coordinated_details:coordinated.details,
  source_operations:services.operations,
  coordinated_identities:[...coordinated.calculations,...supplementary.calculations].map(c=>[c.key,c.scope_id]),
  coordinated_complete_keys:[...supplementary.calculations.map(c=>c.key),...[...new Set(coordinated.calculations.map(c=>c.key))].filter(key=>coordinated.details.every(d=>coordinated.calculations.some(c=>c.key===key&&c.scope_id===d.scope)))]};
}
