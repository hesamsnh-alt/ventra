import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument,PDFName} from 'pdf-lib';
import {simpleFontUnicodeDecoder,extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfPages} from '../src/lib/pdfNativePageExtraction.mjs';
import {mergePdfEvidence,normalizePdfScope} from '../src/lib/pdfTakeoffEvidence.mjs';

const cmap=body=>`begincmap 1 begincodespacerange <00> <FF> endcodespacerange ${body} endcmap`;
const decoder=simpleFontUnicodeDecoder(cmap('2 beginbfchar <80> <0037> <81> <00660069> endbfchar 1 beginbfrange <20> <7E> <0020> endbfrange'));
test('subset font mappings decode real source bytes, ranges and multi-character glyphs rather than assuming ASCII',()=>{
 assert.equal(decoder(new Uint8Array([0x80,32,0x81,32,65])),'7 fi A');
 const f=simpleFontUnicodeDecoder(cmap('1 beginbfrange <01> <03> [<0031> <0039> <0032>] endbfrange'));
 assert.equal(f([1,2,3]),'192');
});
test('malformed, inherited, duplicate and out-of-range CMaps fail instead of returning partial measurements',()=>{
 for(const mapping of [
  '2 beginbfchar <20> <0020> endbfchar',
  '2 beginbfchar <20> <0020> <20> <0033> endbfchar',
  '1 beginbfchar <20> <D800> endbfchar',
  '1 beginbfrange <10> <12> [<0031> <0032>] endbfrange',
  '1 beginbfrange <12> <10> <0031> endbfrange',
  '1 beginbfchar <20> <0020> endbfchar /Parent usecmap',
  '1 beginbfchar <20> <0020>',
 ])assert.throws(()=>simpleFontUnicodeDecoder(cmap(mapping)));
 assert.throws(()=>simpleFontUnicodeDecoder('1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0020> <0020> endbfchar'));
 assert.throws(()=>decoder([0x82]));
 assert.throws(()=>simpleFontUnicodeDecoder(cmap('1 beginbfchar <20> <0000> endbfchar'))([32]));
});
async function mappedPdf(mapping,content){
 const pdf=await PDFDocument.create(),page=pdf.addPage();
 const unicode=pdf.context.register(pdf.context.flateStream(mapping));
 const font=pdf.context.register(pdf.context.obj({Type:'Font',Subtype:'TrueType',BaseFont:'ABCDEF+Example',ToUnicode:unicode}));
 page.node.set(PDFName.of('Resources'),pdf.context.obj({Font:{F1:font}}));
 page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(content)));
 return PDFDocument.load(await pdf.save());
}
test('literal byte 0x80 and hex text use the declared embedded font map end to end',async()=>{
 const pdf=await mappedPdf(cmap('2 beginbfchar <80> <0037> <20> <0020> endbfchar'),
  'BT /F1 12 Tf 1 0 0 1 20 40 Tm ('+String.fromCharCode(128)+') Tj <2080> Tj ET');
 const r=extractNativePdfText(pdf,0);assert.equal(r.status,'readable');assert.equal(r.spans[0].text,'7 7');
});
test('one unmapped glyph invalidates the complete page rather than silently dropping a schedule row',async()=>{
 const pdf=await mappedPdf(cmap('1 beginbfchar <31> <0031> endbfchar'),'BT /F1 12 Tf 1 0 0 1 20 40 Tm <31> Tj 0 -20 Td <32> Tj ET');
 const r=extractNativePdfText(pdf,0);assert.equal(r.status,'unsupported');assert.deepEqual(r.spans,[]);
});

const bytes=readFileSync('tests/fixtures/pdf-complex-dimensioned-input.pdf');
const pdf=await PDFDocument.load(bytes);
const readings=Array.from({length:pdf.getPageCount()},(_,i)=>({pageNumber:i+1,native_text_evidence:extractNativePdfText(pdf,i,{allowRotated:true})}));
test('the actual 13-sheet source is readable locally, including HVAC, plumbing and the finish register',()=>{
 assert.equal(readings.length,13);assert.ok(readings.every(p=>p.native_text_evidence.status==='readable'));
 for(const [page,label] of [[5,'FLOOR FINISHES / ROOM REGISTER'],[10,'HVAC / DIMENSIONED DUCT ROUTES'],[11,'PLUMBING / DIMENSIONED PIPE ROUTES']])
  assert.ok(readings[page-1].native_text_evidence.spans.some(s=>s.text===label));
});
test('saved failed arithmetic stays withheld while explicit source WC and basin counts recover without any model',()=>{
 const saved=JSON.parse(readFileSync('tests/fixtures/pdf-complex-saved-review.json','utf8'));
 const baseline=mergePdfEvidence(saved.page_results,[],13);
 const pages=saved.page_results.map(p=>({...p,native_text_evidence:readings[p.pageNumber-1].native_text_evidence}));
 const merged=mergePdfEvidence(pages,[],13);
 assert.equal(baseline.toilet_count,0);assert.equal(merged.toilet_count,8);assert.equal(merged.basin_count,8);
 assert.equal(merged.floor_area,0);assert.equal(merged.plaster_area,0);assert.equal(merged.pdf_analysis.measurement_completion.status,'incomplete');
 const again=mergePdfEvidence(merged.page_results,[],13);assert.equal(again.toilet_count,8);
 assert.ok(merged.pdf_analysis.native_page_extraction||merged.scheduled_quantities.toilet_count===8);
});
const fixtureReading=(text,pageNumber=1)=>({pageNumber,native_text_evidence:{version:1,status:'readable',spans:text.map((text,i)=>({text,x:10,y:800-i*15,height:10}))}});
test('independent fixture schedules vary rooms and counts; unknown sink use is not classified as a kitchen',()=>{
 for(const [rooms,count] of [['R101 and R102',3],['A7, A8 and A9',2]]){
  const reading=fixtureReading(['Plumbing',`Each of ${rooms}: ${count} WC sets + 1 wash basin + 2 sinks.`,'All unshown plumbing is excluded.']);
  const r=extractNativePdfPages([reading],normalizePdfScope),q=r.pages[0].page_evidence.quantities;
  assert.equal(q.find(c=>c.key==='toilet_count').value,count*(rooms==='R101 and R102'?2:3));
  assert.ok(!q.some(c=>c.key==='kitchen_sink_count'));
 }
});
test('ambiguous, repeated or incomplete fixture schedules cannot publish a partial native project count',()=>{
 for(const lines of [
  ['Each R1: 4 WC sets.'],
  ['Each R1: 4 WC sets.','Each R1: 4 WC sets.','All unshown plumbing is excluded.'],
  ['Each R1: 4 WC sets.','Also 2 WC sets in the hall.','All unshown plumbing is excluded.'],
  ['Each R1: 4 WC sets + unknown allowance.','All unshown plumbing is excluded.'],
  ['Each R1: 1.5 WC sets.','All unshown plumbing is excluded.'],
 ])assert.equal(extractNativePdfPages([fixtureReading(['Plumbing',...lines])],normalizePdfScope).pages.length,0);
});
