import {mergePdfEvidence} from './pdfTakeoffEvidence.mjs';
// Read the persisted PDF evidence at export time, even after workspace tabs
// remount. This does not call analysis or an external API.
export async function latestPdfReportForExport({projectId, visible, readLatest, workflow}) {
  const assertIdle = () => {
    const state = workflow(projectId);
    if (state.active || state.analysisFailed) throw Error('Wait for the current analysis to finish before downloading its report.');
  };
  assertIdle();
  const {takeoff, error} = await readLatest(projectId);
  if (error) throw error;
  assertIdle();
  if (!takeoff?.pdf_analysis || takeoff.pdf_analysis.summaryOnly || !takeoff.page_results?.length) {
    throw Error('Full saved PDF evidence is unavailable. The old visible report was not exported.');
  }
  if (visible?.document_id && takeoff.document_id !== visible.document_id) {
    throw Error('Saved analysis belongs to a different drawing. Select that drawing before exporting.');
  }
  // Saved records can contain an old root summary beside newer full page
  // evidence. Reconcile at the export boundary; this performs no model call.
  if(takeoff.page_results.every(p=>p.page_evidence))return {...takeoff,
    ...mergePdfEvidence(takeoff.page_results,takeoff.failed_pages||[],takeoff.total_pages)};
  return takeoff;
}
