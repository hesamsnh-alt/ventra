// Shared client/server acceptance contract for newly generated image previews.
export const VERIFIED_PREVIEW_VERSION='verified-raster-preview-v134-20261107';
export function assertVerifiedPreview(payload){
 const s=payload?.scene,d=payload?.diagnostics,v=s?.geometryValidation;
 if(!s?.rasterGeometryVersion||v?.pixelSupport!=='passed'||v?.structuralChecks!=='passed'||d?.accepted!==true||!d.trace||![s.width,s.depth,s.height].every(n=>Number.isFinite(n)&&n>0))throw Object.assign(new Error('The image result lacks validated source geometry. No new 3D model was saved. / خروجی تصویر هندسهٔ تأییدشده ندارد؛ مدل جدید ذخیره نشد.'),{code:'PREVIEW_CONTRACT_MISMATCH'});
 for(const key of ['rooms','walls','openings','holes'])if(!Array.isArray(s[key])||!Array.isArray(d.trace[key])||key!=='walls'&&s[key].length!==d.trace[key].length)throw Object.assign(new Error(`Incomplete image geometry: ${key}. No new 3D model was saved.`),{code:'PREVIEW_CONTRACT_MISMATCH'});
 return s;
}
