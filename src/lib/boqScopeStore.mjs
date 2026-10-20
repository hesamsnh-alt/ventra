import {normalizeBoqScope} from './boqScope.mjs';
export const scopeKey=id=>`ventra:boq-scope:${id}`;
export function readBoqScope(storage,id){
 try{const draft=JSON.parse(storage.getItem(`ventra:project-boq:${id}`)||'null');const local=JSON.parse(storage.getItem(scopeKey(id))||'null');return normalizeBoqScope(local||draft?.boqScope?.config||{});}catch{return normalizeBoqScope();}
}
export function writeBoqScope(storage,id,value){
 const config=normalizeBoqScope(value);storage.setItem(scopeKey(id),JSON.stringify(config));return config;
}
export function mergeScopeBase(base=[],current=[],previouslySelectedIds=[]){
 const present=new Map(current.filter(i=>!i.scopeDefault).map(i=>[i.id,i]));
 const selected=new Set(previouslySelectedIds),seen=new Set(),result=[];
 for(const item of base){if(selected.has(item.id)&&!present.has(item.id))continue;result.push(present.get(item.id)||item);seen.add(item.id);}
 for(const item of present.values())if(!seen.has(item.id)){result.push(item);seen.add(item.id);}
 return result;
}
export function captureDefaultEdits(items=[],previous={},previousIds=[]){
 const edits={...previous};const present=new Set(items.map(i=>i.id));for(const id of previousIds)if(!present.has(id))edits[id]={...(edits[id]||{}),disabled:true};for(const i of items)if(i.scopeDefault){
  const edit={...(edits[i.id]||{}),disabled:false};
  if(Number(i.quantity)!==i.scopeDefault.initialQuantity)edit.quantity=i.quantity;
  if(Number(i.rate)>0)edit.rate=i.rate;
  if(i.description!==i.scopeDefault.initialDescription)edit.description=i.description;
  edits[i.id]=edit;
 }return edits;
}
