export const PERSONAL_ASSET_BUCKET='ventra-personal-assets';
export const MAX_PERSONAL_GLB_BYTES=25*1024*1024;
export const PERSONAL_FURNITURE_TYPES=['sofa','chair','bed','dining_table','cabinet','plant','desk','coffee_table'];
export const validAssetId=id=>typeof id==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id);
export function personalDimensions(value={}){
 const result={};for(const [key,max]of [['width',6],['depth',4],['height',3]]){
  const n=Number(value[key]??1);if(!Number.isFinite(n)||n<.05||n>max)throw new Error('Model size must be in metres: width 0.05–6, depth 0.05–4, height 0.05–3. / اندازه مدل باید برحسب متر و در محدوده مجاز باشد.');result[key]=n;
 }return result;
}
export function personalFurnitureModel(row){
 if(!validAssetId(row?.id)||row.kind!=='model'||!PERSONAL_FURNITURE_TYPES.includes(row.furniture_type))throw new Error('Invalid personal model.');
 const name=String(row.name||'Personal model').slice(0,100);
 return {id:`personal:${row.id}`,customModelId:row.id,type:row.furniture_type,...personalDimensions(row),en:name,fa:name,ar:name,color:'#ffffff',variant:'personal',preserveModelColors:true};
}
export function personalMaterial(row){
 if(!validAssetId(row?.id)||row.kind!=='material')throw new Error('Invalid personal material.');
 const name=String(row.name||'Personal material').slice(0,100);
 return {id:`personal:${row.id}`,assetId:row.id,kind:'custom',en:name,fa:name,ar:name,color:'#cccccc'};
}
// Reject external buffers/images, decompression bombs and scripts before loading
// a user GLB. Only embedded, bounded glTF resources are accepted.
export function validatePersonalGlb(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(bytes.byteLength<20||bytes.byteLength>MAX_PERSONAL_GLB_BYTES)throw new Error('GLB exceeds 25 MB or is incomplete.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw new Error('A complete GLB 2.0 file is required.');
 const length=view.getUint32(12,true);
 if(view.getUint32(16,true)!==0x4e4f534a||length>bytes.byteLength-20||length>4*1024*1024)throw new Error('Invalid GLB JSON chunk.');
 let doc;try{doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+length)).trim());}catch{throw new Error('Invalid GLB document.');}
 if(doc.asset?.version!=='2.0'||!doc.meshes?.length||!doc.nodes?.length)throw new Error('GLB has no mesh.');
 if(doc.animations?.length||doc.skins?.length)throw new Error('Use a static furniture model without animation or skinning.');
 if(doc.extensionsRequired?.some(x=>x!=='KHR_materials_unlit'))throw new Error('Compressed or unsupported GLB extensions; export a standard embedded GLB.');
 for(const list of [doc.buffers||[],doc.images||[]])for(const row of list)if(row.uri)throw new Error('All GLB resources must be embedded. External URLs are not accepted.');
 if((doc.nodes?.length||0)>3000||(doc.meshes?.length||0)>1000)throw new Error('Too many objects in GLB.');
 let vertices=0;for(const a of doc.accessors||[]){if(!Number.isSafeInteger(a.count)||a.count<0||a.count>1000000)throw new Error('GLB accessor is too large.');vertices+=a.count;}
 if(vertices>5000000)throw new Error('GLB is too complex for the viewer.');
 let cursor=12,binLength=0;while(cursor<bytes.byteLength){if(cursor+8>bytes.byteLength)throw new Error('Incomplete GLB chunk.');const length=view.getUint32(cursor,true),type=view.getUint32(cursor+4,true);if(length%4||cursor+8+length>bytes.byteLength)throw new Error('Invalid GLB chunk size.');if(type===0x004e4942)binLength+=length;cursor+=8+length;}
 const buffers=doc.buffers||[];if(buffers.length!==1||buffers[0].byteLength>binLength)throw new Error('Missing embedded GLB binary data.');if(buffers.some(b=>!Number.isSafeInteger(b.byteLength)||b.byteLength<0||b.byteLength>bytes.byteLength))throw new Error('Invalid embedded GLB buffer.');
 for(const v of doc.bufferViews||[]){const b=buffers[v.buffer];if(!b||!Number.isSafeInteger(v.byteLength)||v.byteLength<0||(v.byteOffset||0)<0||(v.byteOffset||0)+v.byteLength>b.byteLength)throw new Error('Invalid GLB buffer range.');}
 return doc;
}
