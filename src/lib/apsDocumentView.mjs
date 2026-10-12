import {selectApsGeometry,apsManifestGeometry} from './apsViewables.mjs';
// A full authenticated manifest may contain viewables absent from a cached SDK
// document. Rebuild the SDK Document from that manifest; never synthesize CAD.
export async function resolveApsDocumentView(document,{prefer2D=false,loadManifest,createDocument}){
 const node=selectApsGeometry(document?.getRoot?.(),{prefer2D});
 if(node)return {document,node,recovered:false};
 const manifest=await loadManifest();
 const diagnostics=apsManifestGeometry(manifest);
 if(diagnostics.views.length){
  const rebuilt=createDocument(manifest,document?.myPath,document?.acmSessionId);
  const recovered=selectApsGeometry(rebuilt?.getRoot?.(),{prefer2D});
  if(recovered)return {document:rebuilt,node:recovered,recovered:true,diagnostics};
 }
 const error=new Error(diagnostics.views.length
  ? 'Autodesk returned geometry, but the Viewer could not select a loadable view. Open Drawings and retry loading the model.'
  : `Autodesk has no loadable 2D/3D geometry for this model (translation: ${manifest?.status||'unknown'}). ${diagnostics.messages.join(' ')||'Open Drawings and check the translation diagnostics.'}`);
 error.code=diagnostics.views.length?'APS_VIEW_SELECTION_FAILED':'APS_NO_VIEWABLE_GEOMETRY';
 error.diagnostics={status:manifest?.status||null,...diagnostics};
 throw error;
}
