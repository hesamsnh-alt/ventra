import {drawingProgressView} from './drawingProgress.mjs';
const values=new Map(),listeners=new Map();
export const readDrawingProgress=projectId=>values.get(projectId)||null;
export function updateDrawingProgress(projectId,change){
 const old=values.get(projectId),value=change.reset?drawingProgressView({},change):drawingProgressView(old||{},change);
 values.set(projectId,value);for(const fn of listeners.get(projectId)||[])fn(value);return value;
}
export function subscribeDrawingProgress(projectId,fn){
 const group=listeners.get(projectId)||new Set();group.add(fn);listeners.set(projectId,group);
 return ()=>{group.delete(fn);if(!group.size)listeners.delete(projectId);};
}
