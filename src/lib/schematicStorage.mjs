import {indexedTakeoffRecords} from './takeoffStorage.mjs';

// Large image scenes share the drawing database, never the localStorage quota.
const cache = new Map();
const writes = new Map();
const keyFor = (id, kind) => `ventra:project-${kind}:${id}`;
const local = () => typeof window === 'undefined' ? null : window.localStorage;
export function activeSourceSync(id, storage = local()) {
  const key = keyFor(id, 'active-3d-source');
  if (cache.has(key)) return cache.get(key);
  try { return storage?.getItem(key) || null; } catch { return null; }
}
export async function readActiveSource(id, {storage = local(), records = indexedTakeoffRecords} = {}) {
  if (writes.has(id)) await writes.get(id).catch(() => {});
  const value = await records.get(keyFor(id, 'active-3d-source'));
  if (value === 'aps' || value === 'schematic') { cache.set(keyFor(id, 'active-3d-source'), value); return value; }
  return activeSourceSync(id, storage);
}
export function saveActiveSource(id, source, {storage = local(), records = indexedTakeoffRecords} = {}) {
  if (!['aps','schematic'].includes(source)) return Promise.reject(new Error('Unsupported 3D source.'));
  const key = keyFor(id, 'active-3d-source');
  const task = (writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
    await records.put(key, source);
    cache.set(key, source);
    try { storage?.setItem(key, source); } catch { /* Database preserves the selection. */ }
    return source;
  });
  writes.set(id, task);
  task.finally(() => { if (writes.get(id) === task) writes.delete(id); }).catch(() => {});
  return task;
}
export function readSchematicSync(id, kind = 'schematic3d', storage = local()) {
  const key = keyFor(id, kind);
  if (cache.has(key)) return cache.get(key);
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null');
    return value?.__schematicRecord ? null : value;
  } catch { return null; }
}
export function saveSchematic(id, scene, {kind = 'schematic3d', preserveBase = true, storage = local(), records = indexedTakeoffRecords} = {}) {
  if (!id || !scene) return Promise.reject(new Error('Project and scene are required.'));
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
  if (stored) { cache.set(key, stored); return stored; }
  const legacy = readSchematicSync(id, kind, storage);
  if (legacy) await saveSchematic(id, legacy, {kind, storage, records});
  return legacy;
}
