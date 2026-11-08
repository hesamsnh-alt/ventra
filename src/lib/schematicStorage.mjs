import {indexedTakeoffRecords} from './takeoffStorage.mjs';
import {applyDesignDefaults} from './designDefaults.mjs';

// Large image scenes share the drawing database, never the localStorage quota.
const cache = new Map();
const writes = new Map();
const unsavedSelections = new Map();
const keyFor = (id, kind) => `ventra:project-${kind}:${id}`;
const sceneKind=kind=>['schematic3d','schematic3d-base'].includes(kind);
const documentKey=(id,kind,documentId)=>`${keyFor(id,kind)}:document:${encodeURIComponent(documentId)}`;
const local = () => typeof window === 'undefined' ? null : window.localStorage;
export function selectedDrawingSync(id, storage = local()) {
  const key=keyFor(id,'selected-drawing');
  if(unsavedSelections.has(key))return unsavedSelections.get(key);
  try{const stored=storage?.getItem(key);if(stored){cache.set(key,stored);return stored;}}catch{}
  return cache.get(key)||null;
}
export function subscribeDrawingSelection(id,notify){
 if(typeof window==='undefined')return()=>{};
 const updated=event=>{if(event.detail?.projectId===id)notify();};
 const changed=event=>{if(event.key===keyFor(id,'selected-drawing'))notify();};
 window.addEventListener('ventra:3d-source-updated',updated);window.addEventListener('storage',changed);
 return()=>{window.removeEventListener('ventra:3d-source-updated',updated);window.removeEventListener('storage',changed);};
}
export function drawingSceneMatches(id,scene,storage=local()) {
  const selected=selectedDrawingSync(id,storage);
  return !selected || scene?.documentId===selected;
}
export function selectedDrawingDetailsSync(id,storage=local()){
  const key=keyFor(id,'selected-drawing-details');let details;
  if(unsavedSelections.has(key))details=unsavedSelections.get(key);
  else{try{details=JSON.parse(storage?.getItem(key)||'null');}catch{}details=details||cache.get(key);}
  return details?.documentId===selectedDrawingSync(id,storage)?details:null;
}
export function selectDrawingDocument(id,documentId,storage=local(),fileName=null) {
  const previous=selectedDrawingSync(id,storage);
  const key=keyFor(id,'selected-drawing');
  if(fileName||previous!==documentId||!documentId){
    const detailsKey=keyFor(id,'selected-drawing-details'),details=documentId&&fileName?{documentId,fileName}:null;
    cache.set(detailsKey,details);
    try{if(details)storage?.setItem(detailsKey,JSON.stringify(details));else storage?.removeItem(detailsKey);unsavedSelections.delete(detailsKey);}catch{unsavedSelections.set(detailsKey,details);}
  }
  if(!documentId){cache.delete(key);unsavedSelections.set(key,null);try{storage?.removeItem(key);unsavedSelections.delete(key);}catch{}return;}
  cache.set(key,documentId);
  try{storage?.setItem(key,documentId);unsavedSelections.delete(key);}catch{unsavedSelections.set(key,documentId); /* Session selection still isolates scenes. */ }
  if(previous!==documentId&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('ventra:3d-source-updated',{detail:{projectId:id}}));
}
export function selectSchematicDrawing(id,documentId,storage=local()) {
  if(!documentId)return;
  selectDrawingDocument(id,documentId,storage);
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('ventra:3d-source-updated',{detail:{projectId:id,source:'schematic',scene:readSchematicSync(id,'schematic3d',storage)}}));
}
export function activeSourceSync(id, storage = local()) {
  const key = keyFor(id, 'active-3d-source');
  if (cache.has(key)) return cache.get(key);
  try { return storage?.getItem(key) || null; } catch { return null; }
}
export async function readActiveSource(id, {storage = local(), records = indexedTakeoffRecords} = {}) {
  if (writes.has(id)) await writes.get(id).catch(() => {});
  const value = await records.get(keyFor(id, 'active-3d-source'));
  if (['aps','schematic','dwg-interior'].includes(value)) { cache.set(keyFor(id, 'active-3d-source'), value); return value; }
  return activeSourceSync(id, storage);
}
export function saveActiveSource(id, source, {storage = local(), records = indexedTakeoffRecords, syncCloud = true} = {}) {
  if (!['aps','schematic','dwg-interior'].includes(source)) return Promise.reject(new Error('Unsupported 3D source.'));
  const key = keyFor(id, 'active-3d-source');
  const task = (writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
    await records.put(key, source);
    cache.set(key, source);
    try { storage?.setItem(key, source); } catch { /* Database preserves the selection. */ }
    if(syncCloud){const {writeCloud3DState}=await import('./cloud3DState.mjs');await writeCloud3DState(id,'selection',{source});}
    return source;
  });
  writes.set(id, task);
  task.finally(() => { if (writes.get(id) === task) writes.delete(id); }).catch(() => {});
  return task;
}
export function readSchematicSync(id, kind = 'schematic3d', storage = local()) {
  const selected=selectedDrawingSync(id,storage),scoped=selected&&sceneKind(kind)?cache.get(documentKey(id,kind,selected)):null;
  if(scoped?.documentId===selected)return scoped;
  const key = keyFor(id, kind);
  if (cache.has(key)) {const value=cache.get(key);return ['schematic3d','schematic3d-base'].includes(kind)&&!drawingSceneMatches(id,value,storage)?null:value;}
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null');
    return value?.__schematicRecord || (['schematic3d','schematic3d-base'].includes(kind)&&!drawingSceneMatches(id,value,storage)) ? null : value;
  } catch { return null; }
}
export function saveSchematic(id, scene, {kind = 'schematic3d', preserveBase = true, storage = local(), records = indexedTakeoffRecords, syncCloud = true} = {}) {
  if (!id || !scene) return Promise.reject(new Error('Project and scene are required.'));
  if (kind === 'schematic3d' || kind === 'schematic3d-base') scene=applyDesignDefaults(scene);
  const key = keyFor(id, kind);
  const entries = [[key, scene]];
  if(sceneKind(kind)&&scene.documentId)entries.push([documentKey(id,kind,scene.documentId),scene]);
  if (kind === 'schematic3d' && !preserveBase) entries.push([keyFor(id, 'schematic3d-base'), scene]);
  if(kind==='schematic3d'&&scene.documentId&&!preserveBase)entries.push([documentKey(id,'schematic3d-base',scene.documentId),scene]);
  if (kind === 'schematic3d') entries.push([keyFor(id, 'active-3d-source'), 'schematic']);
  const task = (writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
    if(sceneKind(kind)){
      for(const legacyKind of kind==='schematic3d'?['schematic3d','schematic3d-base']:[kind]){
        const previous=await records.get(keyFor(id,legacyKind));
        if(previous?.documentId&&previous.documentId!==scene.documentId){
          const previousKey=documentKey(id,legacyKind,previous.documentId);
          if(!await records.get(previousKey))entries.push([previousKey,previous]);
        }
      }
    }
    if(kind==='schematic3d'&&scene.documentId&&preserveBase){
      const baseKey=documentKey(id,'schematic3d-base',scene.documentId);
      if(!await records.get(baseKey))entries.push([baseKey,scene]);
    }
    // Commit current and original architecture together before publishing them.
    await records.putMany(entries);
    for (const [recordKey, value] of entries) {
      cache.set(recordKey, value);
      if(!recordKey.includes(':document:'))try { storage?.removeItem(recordKey); storage?.setItem(recordKey, recordKey === keyFor(id, 'active-3d-source') ? value : JSON.stringify({__schematicRecord: recordKey, revision: Date.now()})); } catch { /* IndexedDB remains authoritative. */ }
    }
    if(syncCloud&&(kind==='schematic3d'||kind==='concept-render')){const {writeCloud3DState}=await import('./cloud3DState.mjs');await writeCloud3DState(id,kind==='concept-render'?'render':'schematic',scene);}
    return scene;
  });
  writes.set(id, task);
  task.finally(() => { if (writes.get(id) === task) writes.delete(id); }).catch(() => {});
  return task;
}
export async function readSchematic(id, kind = 'schematic3d', {storage = local(), records = indexedTakeoffRecords} = {}) {
  if (writes.has(id)) await writes.get(id).catch(() => {});
  const key = keyFor(id, kind);
  const selected=selectedDrawingSync(id,storage),scopedKey=selected&&sceneKind(kind)?documentKey(id,kind,selected):null;
  const stored = (scopedKey?await records.get(scopedKey):null)||await records.get(key);
  if (stored) {
    if (['schematic3d','schematic3d-base'].includes(kind)&&!drawingSceneMatches(id,stored,storage)) return null;
    const upgraded=['schematic3d','schematic3d-base'].includes(kind)?applyDesignDefaults(stored):stored;
    if(upgraded!==stored)await saveSchematic(id,upgraded,{kind,storage,records});
    cache.set(key,upgraded);
    if(sceneKind(kind)&&upgraded.documentId){const snapshotKey=documentKey(id,kind,upgraded.documentId);if(!await records.get(snapshotKey))await records.put(snapshotKey,upgraded);cache.set(snapshotKey,upgraded);}
    return upgraded;
  }
  const legacy = readSchematicSync(id, kind, storage);
  if (legacy) await saveSchematic(id, legacy, {kind, storage, records});
  return legacy;
}
