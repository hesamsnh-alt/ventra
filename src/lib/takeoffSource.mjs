// A preview is not a quantity takeoff. Never substitute another drawing's data.
export function assertTakeoffSource(takeoff, documentId, projectId) {
  if (!takeoff) return;
  const owner = takeoff.project_id || takeoff.projectId;
  if (owner && projectId && owner !== projectId) {
    throw new Error('Saved analysis belongs to another project. Analyze the selected drawing before generating BOQ.');
  }
  if (documentId && takeoff.document_id !== documentId) {
    throw new Error('The selected drawing has no matching quantity takeoff. The saved analysis belongs to another drawing. Open Drawings and run Analyze for the selected file before generating BOQ. A 3D preview alone does not create a quantity takeoff.');
  }
}

export function savedBoqMatchesTakeoff(boq, takeoff) {
  if (!takeoff) return true;
  const documentId = boq?.boqSource?.documentId || boq?.takeoff?.document_id;
  if (takeoff.document_id && documentId !== takeoff.document_id) return false;
  const previous = boq?.takeoff?.analyzed_at;
  return !previous || !takeoff.analyzed_at || previous === takeoff.analyzed_at;
}
