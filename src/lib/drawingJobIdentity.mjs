import {createHash} from 'node:crypto';
export const DRAWING_JOB_VERSION=151;
export const LOCAL_DRAWING_RECOVERY_VERSION=156;
export const drawingJobHash=value=>createHash('sha256').update(value).digest('hex');
export function drawingJobId(actor,doc,mode={},model='gpt-5'){
 const hash=drawingJobHash(JSON.stringify([mode.localPdfRecoveryOnly===true?LOCAL_DRAWING_RECOVERY_VERSION:DRAWING_JOB_VERSION,actor,doc.project_id,doc.id,doc.file_path,doc.file_size,doc.created_at,model,mode.resumeSourceMeasurementsOnly===true,mode.localPdfRecoveryOnly===true]));
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}
export function completeDrawingResult(result){
 if(!result||typeof result!=='object')return false;
 if(!result.pdf_analysis)return true;
 if(['failed','pending','partial'].includes(result.pdf_analysis.source_measurement_status?.status))return false;
 const total=Number(result.total_pages||result.pdf_analysis.total_pages||0);
 const count=Array.isArray(result.page_results)?new Set(result.page_results.map(p=>p.pageNumber)).size:Number(result.analyzed_pages||0);
 return total>0&&count>=total&&!(result.failed_pages?.length||result.pdf_analysis.failed_pages?.length)&&!['failed','pending'].includes(result.pdf_analysis.document_review_status?.status);
}
