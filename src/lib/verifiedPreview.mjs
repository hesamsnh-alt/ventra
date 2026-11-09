// Shared client/server acceptance contract for newly generated image previews.
export const VERIFIED_PREVIEW_VERSION='verified-raster-preview-v134-20261107';
export const LEGACY_VISUAL_PREVIEW_VERSION='preview-compact-response-v133-20261015';

// v133 produced visual 3D scenes successfully before strict raster verification
// was introduced. Accept ONLY its exact, complete scene contract, and never
// re-label it as verified pixel geometry or engineering-grade takeoff data.
export function assertLegacyVisualPreview(payload){
 const scene=payload?.scene,diag=payload?.diagnostics;
 const invalid=()=>Object.assign(new Error('The restored visual 3D preview is incomplete. No new model was saved.'),{code:'PREVIEW_CONTRACT_MISMATCH'});
 if(payload?.routeVersion!==LEGACY_VISUAL_PREVIEW_VERSION||
    diag?.build!==LEGACY_VISUAL_PREVIEW_VERSION||diag?.accepted!==true||
    scene?.geometryValidation?.mode!=='visual_interactive_preview'||
    scene?.geometryValidation?.version!==LEGACY_VISUAL_PREVIEW_VERSION||
    ![scene?.width,scene?.depth,scene?.height].every(n=>Number.isFinite(n)&&n>0))throw invalid();
 for(const key of ['footprint','rooms','walls','openings','holes']){
   if(!Array.isArray(scene[key]))throw invalid();
 }
 if(scene.footprint.length<3||scene.walls.length<3||!scene.rooms.length)throw invalid();
 const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
 if(!scene.footprint.every(point)||
    !scene.walls.every(w=>point(w.start)&&point(w.end)&&Math.hypot(w.start.x-w.end.x,w.start.y-w.end.y)>0))throw invalid();
 return scene;
}
export function assertVerifiedPreview(payload){
 if(payload?.routeVersion===LEGACY_VISUAL_PREVIEW_VERSION)return assertLegacyVisualPreview(payload);
 const s=payload?.scene,d=payload?.diagnostics,v=s?.geometryValidation;
 if(!s?.rasterGeometryVersion||v?.pixelSupport!=='passed'||v?.structuralChecks!=='passed'||d?.accepted!==true||!d.trace||![s.width,s.depth,s.height].every(n=>Number.isFinite(n)&&n>0))throw Object.assign(new Error('The image result lacks validated source geometry. No new 3D model was saved. / خروجی تصویر هندسهٔ تأییدشده ندارد؛ مدل جدید ذخیره نشد.'),{code:'PREVIEW_CONTRACT_MISMATCH'});
 for(const key of ['rooms','walls','openings','holes'])if(!Array.isArray(s[key])||!Array.isArray(d.trace[key])||key!=='walls'&&s[key].length!==d.trace[key].length)throw Object.assign(new Error(`Incomplete image geometry: ${key}. No new 3D model was saved.`),{code:'PREVIEW_CONTRACT_MISMATCH'});
 return s;
}
