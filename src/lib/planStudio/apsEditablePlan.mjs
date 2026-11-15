import {id,newDocument,validateDocument} from './document.mjs';
import {dist,EPS,TAU} from './geometry.mjs';
import {DWG_UNIT_FACTORS} from '../dwgUnits.mjs';

export function editableApsUnits(geometry){
 const factor=geometry.unitConfirmation?.meterFactor??geometry.sourceMeterFactor;
 return Object.entries(DWG_UNIT_FACTORS).find(([,scale])=>scale===factor)?.[0]??'';
}
const viewportOf=curve=>String(curve.viewportId??'default');
export function editableApsViewports(geometry){
 return [...new Set([...(geometry.lineSegments??[]),...(geometry.circularArcs??[])].map(viewportOf))]
  .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}

export function apsEditablePlan(geometry,{name,unit,viewport,selection=[]}){
 const factor=DWG_UNIT_FACTORS[unit];
 if(!Object.hasOwn(DWG_UNIT_FACTORS,unit))throw Error('Choose the source drawing unit. / واحد نقشهٔ اصلی را انتخاب کن.');
 const viewports=editableApsViewports(geometry);
 const view=viewport??(viewports.length===1?viewports[0]:null);
 if(!viewports.includes(view))throw Error('Choose a single drawing viewport. / یک نمای نقشه را انتخاب کن.');
 const selected=new Set(selection.map(String));
 const include=curve=>viewportOf(curve)===view&&(!selected.size||selected.has(String(curve.dbId)));
 const layers=new Map(), imported=newDocument((name||'CAD drawing').slice(0,160));
 const propertyObjects=[...(geometry.properties??[]),...(geometry.objects??[])];
 const names=new Map();
 for(const object of propertyObjects){
  const layer=object.layerName||object.layer;
  if(typeof layer==='string'&&layer.trim())names.set(String(object.dbId),layer.trim().slice(0,80));
 }
 const getLayer=curve=>{
  const name=names.get(String(curve.dbId))||'CAD geometry';
  if(layers.has(name))return layers.get(name);
  if(imported.layers.length>=80)throw Error('This selection contains too many CAD layers. / بخش کوچک‌تری از نقشه را انتخاب کن.');
  const key='cad-'+layers.size;
  imported.layers.push({id:key,name,color:'#a9bfcc',dash:'solid',weight:.25,visible:true,locked:false});
  layers.set(name,key);
  return key;
 };
 let skipped=0;
 const usable=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
 const scaled=p=>({x:p.x*factor,y:p.y*factor});
 const add=(shape,curve)=>{
  imported.entities.push({...shape,id:id(),layer:getLayer(curve),role:'line',color:'bylayer'});
  if(imported.entities.length>2000)throw Error('More than 2,000 editable objects. Select part of the plan in Autodesk first. / بیش از ۲۰۰۰ جزء است. ابتدا بخشی از پلان را در نمایشگر Autodesk انتخاب کن.');
 };
 for(const line of (geometry.lineSegments??[]).filter(include)){
  if(!usable(line.start)||!usable(line.end)){skipped++;continue;}
  const a=scaled(line.start),b=scaled(line.end);
  if(dist(a,b)<=EPS){skipped++;continue;}
  add({type:'line',a,b},line);
 }
 for(const arc of (geometry.circularArcs??[]).filter(include)){
  const {editStart:start,editSweep:sweep,editRadius}=arc;
  const radius=editRadius*factor;
  if(!usable(arc.center)||!Number.isFinite(start)||!Number.isFinite(sweep)||!Number.isFinite(radius)||
   radius<=.0001||radius>10000||Math.abs(sweep)<=EPS||Math.abs(sweep)>TAU+EPS){skipped++;continue;}
  const type=Math.abs(Math.abs(sweep)-TAU)<EPS?'circle':'arc';
  add({type,center:scaled(arc.center),radius,start,sweep},arc);
 }
 if(!imported.entities.length)throw Error('No editable vectors were found in this 2D view or selection. / در نمای دوبعدی یا انتخاب فعلی خطوط قابل‌ویرایش پیدا نشد.');
 const points=imported.entities.flatMap(e=>e.type==='line'?[e.a,e.b]:[e.center]);
 if(points.some(p=>Math.abs(p.x)>10000||Math.abs(p.y)>10000)){
  const origin={...points[0]};
  for(const p of points){p.x-=origin.x;p.y-=origin.y;}
  imported.cadOriginMeters=origin;
 }
 imported.importedCad={source:'aps-2d',skipped};
 return validateDocument(imported);
}

export function editablePlanUrl(id,projectId){
 const params=new URLSearchParams({drawing:id});
 if(projectId)params.set('project',projectId);
 return '/plan-studio?'+params.toString();
}
