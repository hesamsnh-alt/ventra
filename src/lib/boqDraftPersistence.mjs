import {compactTakeoff} from './takeoffStorage.mjs';
import {assertTakeoffReady,bindBoqSource} from './takeoffSource.mjs';
export function saveReadyBoq(storage, projectId, document, lifecycle) {
  if (!projectId || lifecycle.loadedProject !== projectId || lifecycle.loading || lifecycle.generating) return false;
  if (!document || !Array.isArray(document.items)) throw new Error('Invalid BOQ draft');
  assertTakeoffReady(document.takeoff);
  let snapshot=bindBoqSource(document,document.takeoff,projectId);
  if(document.takeoff&&JSON.stringify(document.takeoff).length>64000){
    const t=document.takeoff;
    const engineering=!!(t.aps_urn||t.apsUrn||t.urn)&&!/image|raster/i.test(t.source||'');
    snapshot={...snapshot,takeoff:compactTakeoff(t,`${projectId}:${engineering?'engineering':'raster'}`)};
  }
  storage.setItem(`ventra:project-boq:${projectId}`, JSON.stringify(snapshot));
  if(typeof window!=="undefined"&&storage===window.localStorage)window.dispatchEvent(new CustomEvent("ventra:boq-updated",{detail:{projectId}}));
  return true;
}
