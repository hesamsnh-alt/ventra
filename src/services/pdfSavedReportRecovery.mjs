import {PDFDocument} from 'pdf-lib';
import {extractNativePdfText} from './pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from './pdfNativeGraphicsService.mjs';
import {mergePdfEvidence} from '../lib/pdfTakeoffEvidence.mjs';

const fail=message=>{throw Object.assign(new Error(message),{code:'PDF_SAVED_REPORT_REQUIRED'});};
// Browser-only recovery of an existing report. No analysis endpoint, model,
// server cache, client-supplied server checkpoint, or API key is involved.
export async function recoverSavedPdfReport({saved,document,projectId,fileUrl,fetchFile=fetch}){
 if(!saved||!document?.id||saved.document_id!==document.id||saved.project_id!==projectId||document.project_id&&document.project_id!==projectId)
  fail('The complete saved report for this project and PDF is required. No AI requests were made.');
 if(!/\.pdf$/i.test(document.file_name||'')||saved.document_name!==document.file_name)
  fail('The selected PDF does not match the saved report. No AI requests were made.');
 const total=Number(saved.total_pages||saved.pdf_analysis?.total_pages),pages=saved.page_results;
 if(!Number.isInteger(total)||total<1||total>150||!Array.isArray(pages)||pages.length!==total||
  new Set(pages.map(p=>p.pageNumber)).size!==total||pages.some(p=>!Number.isInteger(p.pageNumber)||p.pageNumber<1||p.pageNumber>total||!p.page_evidence)||
  saved.failed_pages?.length||saved.pdf_analysis?.failed_pages?.length||saved.pdf_analysis?.document_review_status?.status!=='completed')
  fail('Full saved PDF pages and a completed base review are required. Temporary server cache is not needed, but a summary-only report cannot be recovered. No AI requests were made.');
 const host=pages.find(p=>p.document_measurement_review);
 if(!host?.document_measurement_review||host.document_review_status?.status!=='completed')
  fail('The saved page-level base review is missing. No AI requests were made.');
 // Validate the report before even downloading. The signed source URL is
 // obtained by the existing authorized document download flow.
 const response=await fetchFile(fileUrl,{cache:'no-store'});
 if(!response.ok)fail(`Could not read the original PDF (${response.status}). Saved report unchanged.`);
 if(Number(response.headers.get('content-length'))>100*1024*1024)fail('PDF exceeds the 100 MB recovery limit.');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.byteLength>100*1024*1024)fail('PDF exceeds the 100 MB recovery limit.');
 const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
 if(pdf.getPageCount()!==total)fail('Original PDF page count differs from the saved report. Saved report unchanged.');
 const fresh=structuredClone(pages).sort((a,b)=>a.pageNumber-b.pageNumber).map(p=>{
  const native=extractNativePdfText(pdf,p.pageNumber-1,{allowRotated:true});
  // If a readable native reading was saved, do not silently apply its model
  // review to different source text at the same document ID.
  const old=p.native_text_evidence;
  if(old?.status==='readable'&&native.status==='readable'&&
   JSON.stringify(old.spans.map(s=>s.text))!==JSON.stringify(native.spans.map(s=>s.text)))
   fail(`Original PDF text differs from the saved report on page ${p.pageNumber}. Saved report unchanged.`);
  return {...p,native_text_evidence:native,...(p.page_evidence.kind==='floor_plan'?{
   native_plan_text:native,native_graphics:extractNativePdfGraphics(pdf,p.pageNumber-1)}:{})};
 });
 const result=mergePdfEvidence(fresh,[],total);
 if(result.pdf_analysis?.document_review_status?.status!=='completed'||
  ['failed','partial','pending'].includes(result.pdf_analysis?.source_measurement_status?.status))
  fail('Saved source detail review is incomplete. No new BOQ was published and no AI requests were made.');
 result.pdf_analysis.local_pdf_recovery={model_calls_disabled:true,base_cache_verified:false,saved_report_verified:true,transport:'browser-native-v157'};
 result.analysis_source={document_id:document.id,file_name:document.file_name,transport:'browser-native-v157'};
 return result;
}
