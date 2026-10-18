import {mergePdfEvidence} from '@/lib/pdfTakeoffEvidence.mjs';
import { extractPdfPage, extractPdfPagePacket, loadPdf } from "@/services/pdfService";
import { runPageQueue } from "@/services/queueService";
import { reviewPdfDocumentMeasurements } from "@/services/pdfDocumentReviewService";
import {buildTakeoffPrompt} from '@/services/promptBuilder';
import {takeoffSchema} from '@/services/takeoffSchema';
import {buildPdfDocumentReviewPrompt,pdfDocumentReviewSchema} from '@/services/pdfDocumentReviewService';
import {pdfAnalysisCacheKey,readPdfAnalysisCache,writePdfAnalysisCache,coalescePdfAnalysis} from '@/services/pdfAnalysisCache.mjs';
import {needsPdfSourceMeasurements,reviewPdfSourceMeasurements} from '@/services/pdfSourceMeasurementService';
import {extractNativePdfText} from '@/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '@/services/pdfNativeGraphicsService.mjs';
import {buildNativePdfSourceBasis} from '@/lib/pdfNativeSourceBasis.mjs';
import {normalizePdfScope} from '@/lib/pdfTakeoffEvidence.mjs';
import {extractNativePdfPages} from '@/lib/pdfNativePageExtraction.mjs';

const DEFAULT_CONCURRENCY = 2;

async function downloadPdf(fileUrl) {
  const response = await fetch(fileUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Could not download the PDF for analysis (${response.status}).`
    );
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("pdf")) {
    throw new Error("The secure file URL did not return a PDF document.");
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function analyzeLargePdf({
  fileUrl,
  fileName,
  projectName = "",
  discipline = "",
  concurrency = DEFAULT_CONCURRENCY,
  resumeSourceMeasurementsOnly = false,
  localPdfRecoveryOnly = false,
  noAutomaticRetries = false,
}) {
  const fileBytes = await downloadPdf(fileUrl);
  // Signed URL tokens rotate; actual file bytes, stable source identity, model
  // and extraction contracts determine reuse. No client-supplied quantities.
  const sourceUrl = new URL(fileUrl);
  const cacheKey = pdfAnalysisCacheKey(fileBytes, {
    version:111,source:sourceUrl.origin+sourceUrl.pathname,fileName,projectName,discipline,
    model:process.env.OPENAI_DRAWING_MODEL || 'gpt-5',apiKey:process.env.OPENAI_API_KEY || '',
    pagePrompt:buildTakeoffPrompt({projectName,discipline}),takeoffSchema,
    reviewPrompt:buildPdfDocumentReviewPrompt.toString(),pdfDocumentReviewSchema,
  });
  return coalescePdfAnalysis(cacheKey,async()=>{
  const { pdf, totalPages } = await loadPdf(fileBytes);
  const cached = await readPdfAnalysisCache(cacheKey);
  const reusable = cached?.totalPages === totalPages ? cached.pages.filter(p=>Number.isInteger(p?.pageNumber)&&p.pageNumber>=1&&p.pageNumber<=totalPages) : [];
  const collected = new Map(reusable.map(p=>[p.pageNumber,p]));
  if((resumeSourceMeasurementsOnly||localPdfRecoveryOnly) && (collected.size!==totalPages||cached?.review?.status!=='completed')){
    throw Object.assign(new Error('Saved PDF page/base-review cache is unavailable. Source-only continuation stopped before model calls; full analysis was not started.'),{status:409,code:'pdf_resume_cache_required'});
  }
  // Read every original page before scheduling any paid page request. This
  // pass is independent of model success and never turns readable text into
  // an assumed measurement. Existing cache identity/contracts stay unchanged.
  const nativeReadings = [];
  if(typeof extractNativePdfText==='function')for(let i=0;i<totalPages;i++){
    nativeReadings.push({pageNumber:i+1,native_text_evidence:extractNativePdfText(pdf,i,{allowRotated:true})});
  }
  const nativeByPage = new Map(nativeReadings.map(p=>[p.pageNumber,p.native_text_evidence]));
  const nativeExtraction = typeof extractNativePdfPages==='function' ? extractNativePdfPages(nativeReadings,normalizePdfScope) : {pages:[],audits:[]};
  const addedNative=[];
  for(const page of nativeExtraction.pages)if(!collected.has(page.pageNumber)){
    collected.set(page.pageNumber,page);addedNative.push(page.pageNumber);
  }
  if(addedNative.length)await writePdfAnalysisCache(cacheKey,{totalPages,pages:[...collected.values()].sort((a,b)=>a.pageNumber-b.pageNumber),review:null,
    review_groups:cached?.review_groups||{},source_basis:cached?.source_basis||null});
  const pages = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (!collected.has(pageIndex+1)) pages.push({
      pageNumber: pageIndex + 1,
      bytes: await extractPdfPage(pdf, pageIndex),
    });
  }

  console.log('[PDF analysis cache] Reuse', {total_pages:totalPages,reused_pages:collected.size,pages_to_analyze:pages.length});
  let cacheWrite = Promise.resolve();

  const queueResults = await runPageQueue({
    pages,
    concurrency,
    context: {
      sourceFileName: fileName,
      noAutomaticRetries,
      projectName,
      discipline,
    },
    onProgress:({result})=>{
      if (!result?.success) return;
      collected.set(result.pageNumber,result.result);
      const snapshot = [...collected.values()].sort((a,b)=>a.pageNumber-b.pageNumber);
      cacheWrite = cacheWrite.then(()=>writePdfAnalysisCache(cacheKey,{totalPages,pages:snapshot,review:null}));
      return cacheWrite;
    },
  });

  await cacheWrite;

  for(const entry of queueResults)if(entry.success){
    const pageNumber=entry.pageNumber??entry.result?.pageNumber;
    if(Number.isInteger(pageNumber)&&pageNumber>=1&&pageNumber<=totalPages)collected.set(pageNumber,entry.result);
  }
  const successfulPages = [...collected.values()].sort((a,b)=>a.pageNumber-b.pageNumber);

  const failedPages = queueResults
    .filter((entry) => !entry.success)
    .map((entry) => ({
      pageNumber: entry.pageNumber,
      error: entry.error,
      status: entry.status || null,
      code: entry.code || null,
      type: entry.type || null,
      creditUnavailable: !!entry.creditUnavailable,
      skipped: !!entry.skipped,
    }));

  const creditFailure = failedPages.find(page=>page.creditUnavailable);

  // Local, bounded text extraction uses the already downloaded original PDF.
  // No SDK/API call; unsupported encodings remain on the existing evidence path.
  if(typeof extractNativePdfText==='function')for(let i=0;i<successfulPages.length;i++){
    const p=successfulPages[i];if(['opening_schedule','specification','quantity_schedule','structural_plan'].includes(p.page_evidence?.kind)){
      successfulPages[i]={...p,native_text_evidence:nativeByPage.get(p.pageNumber)||extractNativePdfText(pdf,p.pageNumber-1,{allowRotated:['quantity_schedule','structural_plan'].includes(p.page_evidence.kind)})};
      collected.set(p.pageNumber,successfulPages[i]);
    }
    if(p.page_evidence?.kind==='floor_plan'&&typeof extractNativePdfGraphics==='function'){
      successfulPages[i]={...successfulPages[i],native_plan_text:nativeByPage.get(p.pageNumber)||extractNativePdfText(pdf,p.pageNumber-1,{allowRotated:true}),native_graphics:extractNativePdfGraphics(pdf,p.pageNumber-1)};
      collected.set(p.pageNumber,successfulPages[i]);
    }
  }

  if (successfulPages.length === 0) {
    const failure = creditFailure || failedPages[0];
    throw Object.assign(new Error(failure?.error || "No PDF pages could be analyzed."), {
      status:failure?.status || 500,code:failure?.code || null,type:failure?.type || null,
    });
  }
  successfulPages[0]={...successfulPages[0],native_first_read:{version:1,total_pages:totalPages,
    readable_text_pages:nativeReadings.filter(p=>p.native_text_evidence.status==='readable').length,
    reused_pages:reusable.length,locally_extracted_pages:addedNative,model_page_requests:pages.map(p=>p.pageNumber),
    page_audits:nativeExtraction.audits,requires_source_review:true}};

  const initial = mergePdfEvidence(successfulPages, failedPages, totalPages);
  const review = creditFailure
    ? {status:'failed',reason:creditFailure.error}
    : failedPages.length
    ? {status:'pending',reason:'Complete the missing page extractions before cross-page measurement review.'}
    : !pages.length && ['completed','not_required'].includes(cached?.review?.status)
      ? cached.review
      : await reviewPdfDocumentMeasurements({pdf,pages:successfulPages,
        audit:initial.pdf_analysis,extractPagePacket:extractPdfPagePacket,
        cachedGroups:!pages.length?cached?.review_groups||{}:{},
        onGroupComplete:groups=>{
          cacheWrite=cacheWrite.then(()=>writePdfAnalysisCache(cacheKey,{totalPages,pages:successfulPages,review:null,review_groups:groups,source_basis:!pages.length?cached?.source_basis:null}));
          return cacheWrite;
        }});
  await cacheWrite;
  await writePdfAnalysisCache(cacheKey,{totalPages,pages:successfulPages,review:['completed','not_required'].includes(review.status)?review:null,review_groups:review.groups||cached?.review_groups||{},source_basis:!pages.length?cached?.source_basis:null});
  // Existing page-results persistence holds this metadata. No database change.
  successfulPages[0] = {...successfulPages[0],document_review_status:{status:review.status,reason:review.reason || null,source_pages:review.source_pages || [],passes:review.passes||[]},
    ...(review.review ? {document_measurement_review:review.review} : {})};
  let preliminary=mergePdfEvidence(successfulPages,failedPages,totalPages);
  if(typeof buildNativePdfSourceBasis==='function'&&successfulPages.some(p=>p.native_graphics?.status==='readable')){
    const native=buildNativePdfSourceBasis(preliminary.page_results,normalizePdfScope);
    successfulPages[0]={...successfulPages[0],native_measurement_basis:native.basis,native_source_status:{source_pages:native.source_pages,geometry:native.geometry}};
    preliminary=mergePdfEvidence(successfulPages,failedPages,totalPages);
    await writePdfAnalysisCache(cacheKey,{totalPages,pages:[...collected.values()].sort((a,b)=>a.pageNumber-b.pageNumber),review,review_groups:review.groups||cached?.review_groups||{},source_basis:!pages.length?cached?.source_basis:null});
  }
  // A complete response that explicitly omitted wall/finish measurements gets
  // one focused source-fact request. Never repeat page or successful base work.
  if(review.status==='completed'&&needsPdfSourceMeasurements(preliminary.pdf_analysis)){
    const sourceBasis=localPdfRecoveryOnly ? cached?.source_basis||{status:'pending',reason:'Local PDF recovery only: model calls disabled',source_pages:[]} : await reviewPdfSourceMeasurements({pdf,pages:preliminary.page_results,report:preliminary.pdf_analysis,extractPagePacket:extractPdfPagePacket,
      cached:!pages.length?cached?.source_basis:null,partitioned:true,
      onCheckpoint:source_basis=>writePdfAnalysisCache(cacheKey,{totalPages,pages:[...collected.values()].sort((a,b)=>a.pageNumber-b.pageNumber),review,review_groups:review.groups||cached?.review_groups||{},source_basis})});
    await writePdfAnalysisCache(cacheKey,{totalPages,pages:[...collected.values()].sort((a,b)=>a.pageNumber-b.pageNumber),review,review_groups:review.groups||cached?.review_groups||{},source_basis:sourceBasis});
    successfulPages[0]={...successfulPages[0],source_measurement_status:{status:sourceBasis.status,source_pages:sourceBasis.source_pages||[],reason:sourceBasis.reason||null,
      retry_suppressed:sourceBasis.retry_suppressed===true,incomplete_reason:sourceBasis.incomplete_reason||null,usage:sourceBasis.usage||null,parts:sourceBasis.parts||[]},
      document_measurement_review:{...(review.review||{}),...(['completed','partial'].includes(sourceBasis.status)&&sourceBasis.basis?{measurement_basis:sourceBasis.basis}:{})}};
  }
  if(localPdfRecoveryOnly)successfulPages[0]={...successfulPages[0],local_pdf_recovery:{model_calls_disabled:true,base_cache_verified:true}};
  return mergePdfEvidence(successfulPages, failedPages, totalPages);
  });
}
