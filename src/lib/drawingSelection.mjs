// Preserve an explicit file selection across Drawing Center remounts.
export function resolveDrawingSelection(documents,selectedId,takeoffDocumentId){
 const available=id=>id&&documents.some(doc=>doc.id===id);
 if(available(selectedId))return selectedId;
 if(available(takeoffDocumentId))return takeoffDocumentId;
 return documents.length===1?documents[0].id:null;
}
export function schematicRequestKey(projectId,document){
 return JSON.stringify([String(projectId),String(document?.id||document?.file_name||'unknown')]);
}
export function isSelectedApsDrawing(takeoff,document){
 if(takeoff?.source!=='autodesk-aps'||!takeoff?.aps_urn||!document)return false;
 if(!/\.(dwg|dxf|ifc|rvt)$/i.test(document.file_name||''))return false;
 return takeoff.document_id?takeoff.document_id===document.id:takeoff.document_name===document.file_name;
}
