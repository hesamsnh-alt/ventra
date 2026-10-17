// Read-only local diagnostic. This module has no network, model, auth or
// database dependency and never modifies the selected PDF or application data.
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfPages} from '../src/lib/pdfNativePageExtraction.mjs';
import {normalizePdfScope} from '../src/lib/pdfTakeoffEvidence.mjs';

const filename=process.argv[2];
if(!filename)throw Error('Usage: node tools/check-pdf-native-first.mjs "path-to-source.pdf"');
const bytes=await readFile(filename),pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
if(pdf.getPageCount()>150)throw Error('PDF exceeds the application limit of 150 pages.');
const readings=Array.from({length:pdf.getPageCount()},(_,i)=>({pageNumber:i+1,native_text_evidence:extractNativePdfText(pdf,i,{allowRotated:true})}));
const extracted=extractNativePdfPages(readings,normalizePdfScope),accepted=new Set(extracted.pages.map(p=>p.pageNumber));
process.stdout.write(JSON.stringify({mode:'read_only_native_pdf_check',modelCalls:0,databaseWrites:0,
 totalPages:readings.length,readableTextPages:readings.filter(p=>p.native_text_evidence.status==='readable').length,
 locallyExtractedPages:[...accepted],unresolvedPageExtractions:readings.filter(p=>!accepted.has(p.pageNumber)).map(p=>p.pageNumber),
 completeMeasuredBoq:false,note:'Reading text or tables does not establish a complete takeoff. Unparsed geometry, prose and source relationships remain for review.',
 pages:extracted.audits},null,2)+'\n');
