import {furnitureOverlaps} from './interiorPresentation.mjs';

export const PROMPT_ASSET_DEFAULTS={
 sofa:[2.2,.9,.85],armchair:[.85,.85,.9],bed:[1.8,2,.65],wardrobe:[1.6,.6,2.1],
 dining_table:[1.8,.95,.76],chair:[.48,.52,.9],coffee_table:[1.1,.65,.42],desk:[1.3,.65,.76],
 cabinet:[1.2,.55,.9],kitchen_counter:[2.2,.65,.92],kitchen_island:[1.8,.9,.92],tv_unit:[1.8,.35,.65],
 toilet:[.7,.8,.78],shower:[.95,.95,2.1],sink:[.8,.5,.85],bathtub:[1.7,.75,.58],
 washing_machine:[.65,.65,.88],refrigerator:[.85,.75,1.85],stove:[.7,.65,.9],
 nightstand:[.5,.45,.5],rug:[2.2,1.6,.025],plant:[.45,.45,.9],mirror:[.75,.04,1.1],
 freezer:[.7,.7,1.5],floor_lamp:[.4,.4,1.6],dressing_table:[.9,.42,1.6],flower_pot:[.45,.45,.7],
 range_hood:[.7,.5,.45],
};
const fail=(message,code='SCENE_EDIT_REJECTED')=>{throw Object.assign(new Error(message),{code,status:422});};
const color=v=>/^#[0-9a-f]{6}$/i.test(v);
const inside=(p,poly=[])=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const points=a=>{const t=a.rotation*Math.PI/180;return [-1,0,1].flatMap(x=>[-1,0,1].map(y=>({x:a.xMeters+x*a.width/2*Math.cos(t)-y*a.depth/2*Math.sin(t),y:a.yMeters+x*a.width/2*Math.sin(t)+y*a.depth/2*Math.cos(t)})));};
const segment=(a,b,depth=.001)=>({xMeters:(a.x+b.x)/2,yMeters:(a.y+b.y)/2,width:Math.hypot(b.x-a.x,b.y-a.y),depth,rotation:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI});
const crossing=(asset,poly,scene)=>poly.some((p,i)=>furnitureOverlaps(asset,segment(p,poly[(i+1)%poly.length]),scene,-.002));

export function preparePromptScene(scene){
 if(!scene||!Array.isArray(scene.rooms)||!scene.rooms.length||!Array.isArray(scene.assets)||scene.rooms.length>200||scene.assets.length>300||!Number.isFinite(scene.width)||!Number.isFinite(scene.depth)||scene.width<=0||scene.depth<=0)fail('The model needs valid room geometry before editing. / هندسه اتاق‌ها برای ویرایش آماده نیست.');
 const next=structuredClone(scene),seen=new Set();
 next.assets=next.assets.map((a,i)=>{
  const id=String(a.id||`asset-${i}`);if(seen.has(id))fail('Duplicate furniture identifiers; re-analyze this drawing.');seen.add(id);
  return {...a,id,xMeters:Number.isFinite(a.xMeters)?a.xMeters:Number(a.x??.5)*next.width,yMeters:Number.isFinite(a.yMeters)?a.yMeters:Number(a.y??.5)*next.depth};
 });
 return next;
}

export function placementProblem(a,s){
 const room=s.rooms.find(r=>r.id===a.roomId);
 if(!room?.polygon?.length)return 'unknown room';
 const ps=points(a);
 if(!ps.every(p=>inside(p,room.polygon))||crossing(a,room.polygon,s))return 'outside target room';
 if(s.footprint?.length&&(!ps.every(p=>inside(p,s.footprint))||crossing(a,s.footprint,s)))return 'outside building';
 const corners=[ps[0],ps[2],ps[8],ps[6]];
 if((s.holes||[]).some(h=>ps.some(p=>inside(p,h.polygon))||(h.polygon||[]).some(p=>inside(p,corners))||crossing(a,h.polygon||[],s)))return 'inside shaft or void';
 if((s.walls||[]).some(w=>furnitureOverlaps(a,segment(w.start,w.end,Number(w.thickness)||.12),s,.03)))return 'intersects wall';
 if(a.type!=='rug'&&(s.assets||[]).some(b=>b.id!==a.id&&b.type!=='rug'&&(Number(a.zMeters)||0)<(Number(b.zMeters)||0)+(Number(b.height)||.8)&&(Number(b.zMeters)||0)<(Number(a.zMeters)||0)+(Number(a.height)||.8)&&furnitureOverlaps(a,b,s,.03)))return 'overlaps furniture';
 if((s.openings||[]).some(o=>{
  if(o.type!=='door')return false;const w=s.walls?.find(w=>w.id===o.wallId);if(!w)return false;
  const x=w.start.x+(w.end.x-w.start.x)*o.offset,y=w.start.y+(w.end.y-w.start.y)*o.offset,r=Math.max(.8,Number(o.width)||.8);
  return furnitureOverlaps(a,{xMeters:x,yMeters:y,width:r*2,depth:r*2,rotation:0},s,0);
 }))return 'blocks door clearance';
 return null;
}

export function applyPromptActions(input,plan){
 if(!plan||!Array.isArray(plan.actions)||plan.actions.length>40||!['apply','clarify','unsupported'].includes(plan.status))fail('Invalid edit plan.');
 if(plan.status!=='apply')fail(plan.message||'Please clarify your request.',plan.status==='clarify'?'SCENE_EDIT_CLARIFY':'SCENE_EDIT_UNSUPPORTED');
 if(!plan.actions.length)fail('No executable edit was returned; the model is unchanged.');
 const next=preparePromptScene(input),before=JSON.stringify(next),spatial=new Set(),changes=[],appearance={palette:{},colors:[]};
 for(const [index,op] of plan.actions.entries()){
  if(!['add','update','remove','palette','style'].includes(op.action))fail('Unsupported edit operation.');
  if(op.action==='palette'){
   if(!['wall','floor','ceiling','accent','glass','door','furniture','upholstery','textileAccent'].includes(op.key)||!color(op.color))fail('Invalid palette edit.');
   next.palette={...next.palette,[op.key]:op.color};appearance.palette[op.key]=op.color;changes.push(`palette:${op.key}`);continue;
  }
  if(op.action==='style'){
   if(!['modern','minimal','luxury','classic'].includes(op.value))fail('Unsupported style.');
   next.promptStyle=op.value;changes.push(`style:${op.value}`);continue;
  }
  const existing=next.assets.find(a=>a.id===op.assetId);
  if(op.action==='remove'){
   if(!existing)fail(`Unknown asset: ${op.assetId}`);
   next.assets=next.assets.filter(a=>a.id!==op.assetId);spatial.delete(op.assetId);changes.push(`remove:${op.assetId}`);continue;
  }
  if(op.action==='update'&&!existing)fail(`Unknown asset: ${op.assetId}`);
  if(op.action==='add'&&existing)fail('Adding a duplicate asset is not allowed.');
  const type=op.type||existing?.type,defaults=PROMPT_ASSET_DEFAULTS[type];
  if(!defaults)fail(`The renderer does not support ${type}.`);
  const a=existing?{...existing}:{id:`prompt-${index}-${next.assets.length}`,type,width:defaults[0],depth:defaults[1],height:defaults[2],rotation:0};
  if(!existing){let suffix=0;const base=a.id;while(next.assets.some(b=>b.id===a.id))a.id=`${base}-${++suffix}`;if(type==='range_hood')a.zMeters=1.95;}
  // Only allow visual furniture fields; never spread model output into a scene.
  for(const key of ['roomId','xMeters','yMeters','width','depth','height','rotation','color'])if(op[key]!=null)a[key]=op[key];
  if(op.type!=null)a.type=op.type;
  if(a.color!=null&&!color(a.color))fail('Invalid furniture color.');
  if(op.color!=null)appearance.colors.push({id:a.id,color:op.color});
  for(const key of ['xMeters','yMeters','rotation','width','depth','height'])if(!Number.isFinite(a[key]))fail(`Invalid ${key} for ${a.id}.`);
  if(a.width<.1||a.width>6||a.depth<.04||a.depth>4||a.height<.01||a.height>3)fail('Furniture dimensions exceed supported limits.');
  const moved=op.action==='add'||['roomId','xMeters','yMeters','width','depth','height','rotation','type'].some(key=>op[key]!=null&&op[key]!==existing?.[key]);
  if(moved){a.userPlaced=true;a.placementSource='user_prompt_ai';a.wallSupported=false;delete a.againstWallId;delete a._presentationOmit;spatial.add(a.id);}
  if(existing)next.assets=next.assets.map(b=>b.id===a.id?a:b);else next.assets.push(a);
  changes.push(`${op.action}:${a.id}`);
 }
 // Validate the FINAL batch, permitting swaps/removals before repositioning.
 for(const id of spatial){const a=next.assets.find(a=>a.id===id);if(!a)continue;const problem=placementProblem(a,next);if(problem)fail(`${id}: ${problem}. / جای‌گذاری پیشنهادی با هندسه یا وسایل تداخل دارد؛ مدل تغییر نکرد.`);}
 if(next.assets.length>300)fail('Too many furniture objects.');
 if(JSON.stringify(next)===before)fail('The requested state already exists; no change was made.','SCENE_EDIT_NO_CHANGE');
 next.updatedAt=new Date().toISOString();next.promptEdit={version:'ai-actions-v61',changes};
 return {scene:next,changes,appearance};
}

const nullableNumber={type:['number','null']},nullableString={type:['string','null']};
const fields={action:{type:'string',enum:['add','update','remove','palette','style']},assetId:nullableString,type:{type:['string','null'],enum:[...Object.keys(PROMPT_ASSET_DEFAULTS),null]},roomId:nullableString,xMeters:nullableNumber,yMeters:nullableNumber,width:nullableNumber,depth:nullableNumber,height:nullableNumber,rotation:nullableNumber,color:nullableString,key:nullableString,value:nullableString};
export const promptActionSchema={type:'object',additionalProperties:false,required:['status','message','actions'],properties:{status:{type:'string',enum:['apply','clarify','unsupported']},message:{type:'string'},actions:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:Object.keys(fields),properties:fields}}}};

export function promptSceneContext(scene){
 const s=preparePromptScene(scene);
 return {units:'meters',axes:'X right, Y up in plan; rotation degrees counterclockwise',width:s.width,depth:s.depth,footprint:s.footprint,holes:s.holes,rooms:s.rooms.map(({id,name,type,semanticType,polygon})=>({id,name,type,semanticType,polygon})),walls:s.walls,openings:s.openings,palette:s.palette,style:s.style,assets:s.assets.map(({id,type,roomId,xMeters,yMeters,width,depth,height,rotation,color})=>({id,type,roomId,xMeters,yMeters,width,depth,height,rotation,color}))};
}
