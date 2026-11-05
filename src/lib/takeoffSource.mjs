// A preview is not a quantity takeoff. Never substitute another drawing's data.
export function takeoffBoqIssue(takeoff) {
  if(!takeoff)return '';
  const status=String(takeoff.extraction_status||takeoff.raw_result?.extraction_status||'').toLowerCase();
  const cad=!!(takeoff.aps_urn||takeoff.apsUrn)||/autodesk|aps/i.test(takeoff.source||'')||/\.(dwg|dxf|ifc|rvt)$/i.test(takeoff.document_name||'');
  const legacyPending=/Autodesk translation completed[\s\S]*geometry quantities have not been extracted yet/i.test(takeoff.notes||'');
  if(legacyPending||cad&&(['translation-complete','geometry-ready-analysis-pending'].includes(status)||
    ['pending','processing','extracting'].includes(String(takeoff.geometry_status||'').toLowerCase())))
    return 'BOQ generation stopped: CAD conversion is complete, but quantity extraction is incomplete. Complete geometry quantity extraction before pricing. The saved draft has been preserved.';
  return '';
}

export function assertTakeoffReady(takeoff) {
  const issue=takeoffBoqIssue(takeoff);
  if(issue)throw Object.assign(new Error(issue),{code:'CAD_EXTRACTION_INCOMPLETE'});
}

export function assertTakeoffSource(takeoff, documentId, projectId) {
  if (!takeoff) return;
  const owner = takeoff.project_id || takeoff.projectId;
  if (owner && projectId && owner !== projectId) {
    throw new Error('Saved analysis belongs to another project. Analyze the selected drawing before generating BOQ.');
  }
  if (documentId && takeoff.document_id !== documentId) {
    throw new Error('The selected drawing has no matching quantity takeoff. The saved analysis belongs to another drawing. Open Drawings and run Analyze for the selected file before generating BOQ. A 3D preview alone does not create a quantity takeoff.');
  }
  assertTakeoffReady(takeoff);
}

export function savedBoqMatchesTakeoff(boq, takeoff) {
  if(takeoffBoqIssue(takeoff)||takeoffBoqIssue(boq?.takeoff))return false;
  if (!takeoff) return true;
  const documentId = boq?.boqSource?.documentId || boq?.takeoff?.document_id;
  if (takeoff.document_id && documentId !== takeoff.document_id) return false;
  const previous = boq?.takeoff?.analyzed_at;
  return !previous || !takeoff.analyzed_at || previous === takeoff.analyzed_at;
}
