import {indexedTakeoffRecords} from './takeoffStorage.mjs';
import {applyDesignDefaults} from './designDefaults.mjs';

// Large image scenes share the drawing database, never the localStorage quota.
const cache = new Map();
const writes = new Map();
const unsavedSelections = new Map();
const keyFor = (id, kind) => `ventra:project-${kind}:${id}`;
const local = () => typeof window === 'undefined' ? null : window.localStorage;
export function selectedDrawingSync(id, storage = local()) {
  const key=keyFor(id,'selected-drawing');
  if(unsavedSelections.has(key))return unsavedSelections.get(key);
  try{const stored=storage?.getItem(key);if(stored){cache.set(key,stored);return stored;}}catch{}
  return cache.get(key)||null;
}
export function drawingSceneMatches(id,scene,storage=local()) {
  const selected=selectedDrawingSync(id,storage);
  return !selected || scene?.documentId===selected;
}
export function selectDrawingDocument(id,documentId,storage=local()) {
  const key=keyFor(id,'selected-drawing');
  if(!documentId){cache.delete(key);unsavedSelections.set(key,null);try{storage?.removeItem(key);unsavedSelections.delete(key);}catch{}return;}
  cache.set(key,documentId);
  try{storage?.setItem(key,documentId);unsavedSelections.delete(key);}catch{unsavedSelections.set(key,documentId); /* Session selection still isolates scenes. */ }
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
  if (kind === 'schematic3d' && !preserveBase) entries.push([keyFor(id, 'schematic3d-base'), scene]);
  if (kind === 'schematic3d') entries.push([keyFor(id, 'active-3d-source'), 'schematic']);
  const task = (writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
    // Commit current and original architecture together before publishing them.
    await records.putMany(entries);
    for (const [recordKey, value] of entries) {
      cache.set(recordKey, value);
      try { storage?.removeItem(recordKey); storage?.setItem(recordKey, recordKey === keyFor(id, 'active-3d-source') ? value : JSON.stringify({__schematicRecord: recordKey, revision: Date.now()})); } catch { /* IndexedDB remains authoritative. */ }
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
  const stored = await records.get(key);
  if (stored) {
    if (['schematic3d','schematic3d-base'].includes(kind)&&!drawingSceneMatches(id,stored,storage)) return null;
    const upgraded=['schematic3d','schematic3d-base'].includes(kind)?applyDesignDefaults(stored):stored;
    if(upgraded!==stored)await saveSchematic(id,upgraded,{kind,storage,records});
    cache.set(key,upgraded);return upgraded;
  }
  const legacy = readSchematicSync(id, kind, storage);
  if (legacy) await saveSchematic(id, legacy, {kind, storage, records});
  return legacy;
}
