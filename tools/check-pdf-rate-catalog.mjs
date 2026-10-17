// Read-only, offline exercise of the actual server BOQ path. No dependencies,
// database connection, model, browser state, or catalog updates are used.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {planPdfCatalogRules,resolvePdfCatalogRate,retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
import {annotatePdfBoqCompletion} from '../src/lib/pdfBoqCompletion.mjs';
import {requireBoqReview} from '../src/lib/boqEvidence.mjs';
import {classifyEstimateItem} from '../src/lib/estimateClassification.mjs';

export {parseCsv,rateCatalogFromCsv} from '../src/lib/boqRateCsv.mjs';
import {parseCsv,rateCatalogFromCsv} from '../src/lib/boqRateCsv.mjs';

export async function runOfflinePdfCatalogCheck(takeoff,rateCsv){
  return runOfflinePdfCatalog(takeoff,rateCatalogFromCsv(rateCsv));
}
export async function runOfflinePdfCatalog(takeoff,prices,{rules=[],sections=[]}={}){
  if(!takeoff?.pdf_analysis?.quantity_evidence)throw Error('A PDF report with source quantity evidence is required.');
  const tables={price_items:structuredClone(prices),boq_rules:structuredClone(rules),boq_sections:structuredClone(sections)};
  let reads=0,modelAttempts=0,databaseWrites=0;
  const forbidden=()=>{throw Error('Offline check forbids model calls and database writes.');};
  const forbiddenModel=()=>{modelAttempts++;return forbidden();},forbiddenWrite=()=>{databaseWrites++;return forbidden();};
  const db={from(name){
    if(!Object.hasOwn(tables,name))throw Error(`Unexpected database access: ${name}`);reads++;
    const q={select(){return q;},eq(){return q;},order(){return q;},
      range(a,b){return Promise.resolve({data:tables[name].slice(a,b+1),error:null});},
      then(ok,fail){return Promise.resolve({data:tables[name],error:null}).then(ok,fail);},insert:forbiddenWrite,update:forbiddenWrite,upsert:forbiddenWrite,delete:forbiddenWrite};return q;
  }};
  const context=vm.createContext({planPdfCatalogRules,resolvePdfCatalogRate,retainUnboundPdfQuantities,annotatePdfBoqCompletion,mergePdfEvidence,requireBoqReview,classifyEstimateItem,
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',SUPABASE_SECRET_KEY:'offline-placeholder',VENTRA_DISABLE_BOQ_AI:'true'}},
    createClient:()=>db,NextResponse:{json:Response.json},console:{log(){},warn(){},error(){}},
    getSemanticRooms:()=>[],hydrateSemanticRoomQuantities:()=>({rooms:[],source:'offline empty inventory'}),
    getDrawingEvidence:()=>null,applyDwgScheduleToBoq:items=>({items,warnings:[]}),
    buildLocalBoq:forbidden,inferConstructionScopes:forbiddenModel,shortlistPriceCatalog:forbiddenModel,matchScopesToCatalog:forbiddenModel,resolveAiQuantity:forbiddenModel});
  const source=readFileSync(new URL('../src/lib/serverBoqAnalysis.js',import.meta.url),'utf8');
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/export /g,'')+'\nthis.handle=handleCommercialRequest;',context);
  const response=await context.handle({json:async()=>({takeoff:structuredClone(takeoff),priceLevel:'standard',vatPercentage:0})});
  const result=await response.json();
  if(response.status!==200||!result.success)throw Error(result.error||'Offline server BOQ failed.');
  if(modelAttempts||databaseWrites)throw Error('Offline-only invariant failed: model/write path was attempted.');
  return {mode:'offline_supplied_rate_catalog_only',productionCatalogChanged:false,modelCalls:0,databaseWrites,mockedTableReads:reads,
    rateRows:prices.length,boq:result.boq};
}

export function compareExpectedRows(result,expectedCsv){
  // The oracle is used only AFTER generating the BOQ. It never supplies a
  // quantity, material, mapping, rate, or missing opening classification.
  const expected=parseCsv(expectedCsv),items=result.boq.items||[];
  const comparisons=expected.map(ref=>{
    const row=items.find(i=>i.itemCode===ref.code&&i.quantity>0);
    if(!row)return {code:ref.code,description:ref.description_en,status:'unbound',expectedQuantity:Number(ref.quantity),expectedUnit:ref.unit};
    const quantityDelta=Number(row.quantity)-Number(ref.quantity),amountDelta=Number(row.amount)-Number(ref.amount_aed);
    const quantityMatches=Math.abs(quantityDelta)<=.001,rateMatches=Math.abs(Number(row.rate)-Number(ref.rate_aed))<=.01,unitMatches=row.unit===ref.unit;
    return {code:ref.code,description:ref.description_en,quantity:row.quantity,unit:row.unit,rate:row.rate,amount:row.amount,
      quantityMatches,rateMatches,unitMatches,quantityDelta,amountDelta,
      status:quantityMatches&&rateMatches&&unitMatches&&Math.abs(amountDelta)<=.01?'pass':'difference',metricKey:row.pdfEvidence?.metricKey};
  });
  return {expectedRows:expected.length,matchedQuantityRows:comparisons.filter(r=>r.quantityMatches&&r.unitMatches).length,
    passedRows:comparisons.filter(r=>r.status==='pass').length,differenceRows:comparisons.filter(r=>r.status==='difference').length,
    unboundRows:comparisons.filter(r=>r.status==='unbound').length,comparisons};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [reportPath,ratesPath,expectedPath,outputPath]=process.argv.slice(2);
  if(!reportPath||!ratesPath)throw Error('Usage: node tools/check-pdf-rate-catalog.mjs report.json rates.csv [expected-boq.csv] [output.json]');
  const reportText=readFileSync(reportPath,'utf8');if(reportText.length>20*1024*1024)throw Error('Report exceeds 20 MiB.');
  const result=await runOfflinePdfCatalogCheck(JSON.parse(reportText),readFileSync(ratesPath,'utf8'));
  if(expectedPath)result.comparison=compareExpectedRows(result,readFileSync(expectedPath,'utf8'));
  const text=JSON.stringify(result,null,2)+'\n';if(outputPath)writeFileSync(outputPath,text);else process.stdout.write(text);
}
