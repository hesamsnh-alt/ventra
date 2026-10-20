import {centrelinePlanFloor} from '../lib/pdfCentrelineScene.mjs';
import {PDFDocument} from 'pdf-lib';
import {extractNativePdfText} from './pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from './pdfNativeGraphicsService.mjs';
import {compileNativePdfScenes} from '../lib/pdfPlanScene.mjs';
// Uses only the already-authorized original document download. No AI endpoint.
export async function buildNativePdfScene({bytes,projectId,documentId,documentName}){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>100*1024*1024)throw Error('A PDF up to 100 MB is required.');
 const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
 if(pdf.getPageCount()>150)throw Error('PDF preview supports up to 150 pages.');
 const pages=pdf.getPages().map((_,i)=>{
  const native=extractNativePdfText(pdf,i,{allowRotated:true});
  const architectural=native.status==='readable'&&(/FLOOR\s*\/\s*ARCHITECTURAL PLAN/i.test(native.spans.map(s=>s.text).join(' '))||!!centrelinePlanFloor(native));
  return {pageNumber:i+1,native_text_evidence:native,...(architectural?{native_graphics:extractNativePdfGraphics(pdf,i)}:{})};
 });
 return compileNativePdfScenes(pages,{projectId,documentId,documentName});
}
