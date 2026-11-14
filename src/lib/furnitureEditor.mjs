import {outdoorGround} from './outdoorGround.mjs';
import {applyFurnitureFinish} from './furnitureFinishes.mjs';
import {SOFA_SET_LAYOUTS} from './sofaSets.mjs';
import {personalFurnitureModel} from './personalAssets.mjs';
import {applyPromptActions,placementProblem} from './scenePromptActions.mjs';
export const FURNITURE_CATALOG=Object.freeze([
 ['sofa-modern','sofa','Sofa · Modern','مبل مدرن','أريكة حديثة',2.2,.9,.85,'modern','#b4a28f'],
 ['sofa-minimal','sofa','Sofa · Minimal','مبل مینیمال','أريكة بسيطة',1.8,.8,.85,'minimal','#d4c8b7'],
 ['sofa-luxury','sofa','Sofa · Luxury','مبل لوکس','أريكة فاخرة',2.6,.95,.85,'luxury','#8f7358'],
 ['dining-oak','dining_table','Dining · Oak','غذاخوری چوبی','طاولة خشبية',1.6,.85,.76,'modern','#b99266'],
 ['dining-round','dining_table','Dining · Round','غذاخوری گرد','طاولة مستديرة',1.2,1.2,.76,'round','#c8b49b'],
 ['dining-set','dining_table','Dining + 4 chairs','غذاخوری و ۴ صندلی','طاولة و٤ كراسي',1.4,.8,.76,'modern','#b99266',4],
 ['bed-modern','bed','Bed · Modern','تخت مدرن','سرير حديث',1.6,2,.85,'modern','#b5a596'],
 ['bed-luxury','bed','Bed · Luxury','تخت لوکس','سرير فاخر',1.8,2.1,1.05,'luxury','#b79777'],
 ['bed-single','bed','Single bed','تخت یک‌نفره','سرير مفرد',.95,2,.85,'minimal','#b5a596'],
 ['cabinet-storage','cabinet','Storage cabinet','کمد کوتاه','خزانة تخزين',1.2,.55,.9,'modern','#bca487'],
 ['cabinet-door','cabinet_door','Cabinet door','در کابینت','باب خزانة',.45,.05,.75,'modern','#bca487'],
 ['wardrobe','wardrobe','Wardrobe','کمد لباس','خزانة ملابس',1.6,.6,2.2,'modern','#bca487'],
 ['counter-L','kitchen_counter','L-shaped kitchen cabinet','کابینت آشپزخانه L','خزانة مطبخ L',2.2,1.8,.92,'l-shape','#bca487'],
 ['nightstand','nightstand','Bedside table','پاتختی','طاولة بجانب السرير',.5,.45,.5,'modern','#bca487'],
 ['desk','desk','Desk','میز کار','مكتب',1.3,.65,.76,'modern','#bca487'],
 ['lamp','floor_lamp','Floor lamp','چراغ ایستاده','مصباح أرضي',.4,.4,1.6,'modern','#bca487'],
 ['chair','chair','Chair','صندلی','كرسي',.45,.5,.9,'modern','#bca487'],
 ['plant','plant','Indoor plant','گیاه آپارتمانی','نبات داخلي',.4,.4,1.05,'modern','#70845c'],
 ['plant-heart-small','plant','Heartleaf · Small','گیاه برگ‌قلبی کوچک','نبات قلبي الأوراق صغير',.4,.4,.65,'heartleaf','#b07b59'],
 ['plant-heart-large','plant','Heartleaf · Large','گیاه برگ‌قلبی بزرگ','نبات قلبي الأوراق كبير',.65,.65,1.2,'heartleaf','#b07b59'],
 ['tree-potted','plant','Potted tree · Medium','درختچه گلدانی متوسط','شجيرة داخلية متوسطة',.65,.65,1.5,'potted-tree','#b07b59'],
 ['tree-potted-tall','plant','Potted tree · Tall','درختچه گلدانی بلند','شجيرة داخلية طويلة',.8,.8,1.9,'potted-tree','#b07b59'],
 ['plant-calathea','plant','Calathea · Medium','کالاتیا متوسط','كالاتيا متوسطة',.65,.65,.85,'calathea','#9e7655'],
 ['plant-calathea-large','plant','Calathea · Large','کالاتیا بزرگ','كالاتيا كبيرة',.9,.9,1.2,'calathea','#9e7655'],
 ['plant-succulent','plant','Succulent · Tabletop','گیاه گوشتی رومیزی','نبات عصاري للطاولة',.3,.3,.4,'succulent','#b07b59'],
 ['tv','tv_unit','TV console','تلویزیون و میز','تلفاز وطاولة',1.6,.35,1.35,'modern','#947050'],
 ['washer','washing_machine','Washing machine','لباس‌شویی','غسالة',.6,.65,.88,'modern','#e9e9e5'],
 ['fridge','refrigerator','Refrigerator','یخچال','ثلاجة',.75,.7,1.85,'modern','#d8d8d4'],
 ['toilet','toilet','Toilet','توالت','مرحاض',.55,.75,.78,'modern','#f1f0e9'],
 ['basin','sink','Vanity basin','روشویی کابینت‌دار','حوض وخزانة',.65,.45,.85,'modern','#bca487'],
 ['shower','shower','Shower','دوش','دش',.85,.85,2.1,'modern','#c8d4d6'],
 ['dresser','dressing_table','Dressing table','میز آرایش','طاولة زينة',.9,.42,1.6,'modern','#bca487'],
 ['counter','kitchen_counter','Kitchen counter','کابینت آشپزخانه','خزانة مطبخ',1.8,.6,.92,'modern','#bca487'],
 ['cooker','stove','Cooker','اجاق','موقد',.6,.6,.9,'modern','#d0d0cb'],
 ['hood','range_hood','Extractor hood','هود','شفاط',.6,.48,.45,'modern','#c1c1bc'],
 ["sofa-compact", "sofa", "Compact sofa", "مبل جمع‌وجور", "Compact sofa", 1.5, 0.8, 0.85, "minimal", "#9cafa1"],
 ["sofa-sectional-left", "sofa", "Sectional · Left chaise", "مبل ال سمت چپ", "Sectional · Left chaise", 2.8, 1.6, 0.85, "sectional-left", "#a29a8f"],
 ["sofa-sectional-right", "sofa", "Sectional · Right chaise", "مبل ال سمت راست", "Sectional · Right chaise", 2.8, 1.6, 0.85, "sectional-right", "#829094"],
 ["sofa-bench", "sofa", "Bench sofa", "مبل نیمکتی", "Bench sofa", 1.7, 0.7, 0.85, "bench", "#bb8a5f"],
 ["armchair-soft", "armchair", "Lounge armchair", "مبل تک‌نفره", "Lounge armchair", 0.9, 0.9, 0.9, "modern", "#b8a291"],
 ["armchair-compact", "armchair", "Compact armchair", "مبل تک‌نفره کوچک", "Compact armchair", 0.7, 0.75, 0.85, "minimal", "#8b9c86"],
 ["rug-persian", "rug", "Persian rug", "فرش ایرانی", "Persian rug", 2.4, 1.7, 0.03, "persian", "#8d343b"],
 ["rug-persian-polonaise", "rug", "Persian Polonaise rug", "فرش ایرانی پولونز", "Persian Polonaise rug", 2.01, 1.84, 0.03, "persian-polonaise", "#a66c4d"],
 ["rug-persian-medallion", "rug", "Persian medallion rug", "فرش ایرانی ترنج‌دار", "Persian medallion rug", 2.36, 1.45, 0.03, "persian-medallion", "#b1996d"],
 ["rug-persian-czartoryski", "rug", "Persian long floral rug", "فرش ایرانی کشیده گل‌دار", "Persian long floral rug", 3.2, 1.43, 0.03, "persian-czartoryski", "#8f7950"],
 ["rug-round", "rug", "Round rug", "فرش گرد", "Round rug", 1.8, 1.8, 0.03, "round", "#c4ac86"],
 ["rug-runner", "rug", "Runner rug", "قالیچه راهرو", "Runner rug", 2.4, 0.75, 0.03, "runner", "#b99377"],
 ["rug-minimal", "rug", "Minimal rug", "فرش ساده", "Minimal rug", 2.2, 1.6, 0.03, "minimal", "#c1b8a5"],
 ["curtain-closed", "curtain", "Pleated curtain · Closed", "پرده پلیسه بسته", "Pleated curtain · Closed", 2, 0.16, 2.5, "closed", "#c5b8a4"],
 ["curtain-open", "curtain", "Pleated curtain · Open", "پرده پلیسه باز", "Pleated curtain · Open", 2, 0.16, 2.5, "open", "#c0b0a0"],
 ["curtain-sheer", "curtain", "Sheer curtain", "پرده حریر", "Sheer curtain", 2, 0.12, 2.5, "sheer", "#f1eee5"],
 ["curtain-roller", "curtain", "Roller blind", "پرده رول", "Roller blind", 1.2, 0.1, 1.6, "roller", "#d0c8b9"],
 ["cabinet-tall", "cabinet", "Tall storage cabinet", "کمد بلند", "Tall storage cabinet", 0.8, 0.5, 2, "modern", "#c8b398"],
 ["cabinet-wide", "cabinet", "Wide sideboard", "بوفه عریض", "Wide sideboard", 1.8, 0.45, 0.85, "modern", "#856348"],
 ["wardrobe-wide", "wardrobe", "Wide wardrobe", "کمد لباس عریض", "Wide wardrobe", 2.4, 0.6, 2.4, "modern", "#e0d7c8"],
 ["coffee-round", "coffee_table", "Round coffee table", "جلو مبلی گرد", "Round coffee table", 0.85, 0.85, 0.42, "round", "#ae865f"],
 ["coffee-low", "coffee_table", "Low coffee table", "جلو مبلی کوتاه", "Low coffee table", 1.2, 0.6, 0.32, "minimal", "#d8ccba"],
 ["coffee-walnut", "coffee_table", "Walnut coffee table", "جلو مبلی گردویی", "Walnut coffee table", 1.1, 0.6, 0.45, "modern", "#77533a"],
 ["dining-large", "dining_table", "Dining table · Large", "میز غذاخوری بزرگ", "Dining table · Large", 2.2, 1, 0.76, "modern", "#aa8159"],
 ["dining-small", "dining_table", "Dining table · Compact", "میز غذاخوری کوچک", "Dining table · Compact", 0.9, 0.9, 0.76, "round", "#d0bc9b"],
 ["desk-wide", "desk", "Wide desk", "میز کار عریض", "Wide desk", 1.8, 0.75, 0.76, "modern", "#a77d52"],
 ["bed-king", "bed", "King bed", "تخت کینگ", "King bed", 2, 2.1, 1, "luxury", "#bca995"],
 ["bed-small", "bed", "Guest bed", "تخت مهمان", "Guest bed", 1.2, 2, 0.85, "minimal", "#afbdc0"],
 ["island", "kitchen_island", "Kitchen island", "جزیره آشپزخانه", "Kitchen island", 1.8, 0.9, 0.92, "modern", "#d0b899"],
 ["bath", "bathtub", "Bathtub", "وان حمام", "Bathtub", 1.7, 0.75, 0.58, "modern", "#eeeee7"],
 ["mirror", "mirror", "Standing mirror", "آینه ایستاده", "Standing mirror", 0.65, 0.08, 1.7, "modern", "#bcaa8d"],
 ["lamp-tall", "floor_lamp", "Tall floor lamp", "آباژور بلند", "Tall floor lamp", 0.5, 0.5, 1.85, "modern", "#c6a66c"],
 ["sofa-modern-two", "sofa", "Modern two-seater", "مبل مدرن دونفره", "أريكة حديثة لشخصين", 1.6, 0.9, 0.85, "modern", "#b4a28f"],
 ["sofa-comfort", "sofa", "Comfort three-seater", "مبل راحتی سه‌نفره", "أريكة مريحة لثلاثة", 2.5, 1, 0.95, "comfort", "#a5b3a0"],
 ["sofa-comfort-two", "sofa", "Comfort two-seater", "مبل راحتی دونفره", "أريكة مريحة لشخصين", 1.8, 1, 0.95, "comfort", "#a5b3a0"],
 ["sofa-classic", "sofa", "Classic three-seater", "مبل استیل سه‌نفره", "أريكة كلاسيكية لثلاثة", 2.5, 1, 1.05, "traditional", "#bca07c"],
 ["sofa-classic-two", "sofa", "Classic two-seater", "مبل استیل دونفره", "أريكة كلاسيكية لشخصين", 1.8, 1, 1.05, "traditional", "#bca07c"],
 ["armchair-classic", "armchair", "Classic armchair", "مبل استیل تک‌نفره", "كرسي كلاسيكي", 0.95, 1, 1.05, "traditional", "#bca07c"],
 ["armchair-comfort", "armchair", "Comfort armchair", "مبل راحتی تک‌نفره", "كرسي مريح", 1, 1, 0.95, "comfort", "#a5b3a0"],
 ["sofa-set-modern-6", "sofa", "Modern set · 6 seats + coffee table", "ست مدرن 6 نفره با میز جلو مبلی", "Modern · 6", 4.8, 3.8, 1.05, "modern", "#b4a28f"],
 ["sofa-set-modern-7", "sofa", "Modern set · 7 seats + coffee table", "ست مدرن 7 نفره با میز جلو مبلی", "Modern · 7", 4.8, 3.8, 1.05, "modern", "#b4a28f"],
 ["sofa-set-comfort-6", "sofa", "Comfort set · 6 seats + coffee table", "ست راحتی 6 نفره با میز جلو مبلی", "Comfort · 6", 4.8, 3.8, 1.05, "comfort", "#a5b3a0"],
 ["sofa-set-comfort-7", "sofa", "Comfort set · 7 seats + coffee table", "ست راحتی 7 نفره با میز جلو مبلی", "Comfort · 7", 4.8, 3.8, 1.05, "comfort", "#a5b3a0"],
 ["sofa-set-classic-6", "sofa", "Classic set · 6 seats + coffee table", "ست استیل 6 نفره با میز جلو مبلی", "Classic · 6", 4.8, 3.8, 1.05, "classic", "#bca07c"],
 ["sofa-set-classic-7", "sofa", "Classic set · 7 seats + coffee table", "ست استیل 7 نفره با میز جلو مبلی", "Classic · 7", 4.8, 3.8, 1.05, "classic", "#bca07c"],
 ["curtain-eyelet", "curtain", "Eyelet curtain", "پرده پانچ", "ستارة حلقات", 2, 0.18, 2.5, "eyelet", "#ab967e"],
 ["curtain-linen", "curtain", "Natural linen curtain", "پرده کتان طبیعی", "ستارة كتان", 2, 0.16, 2.5, "linen", "#d6c9ad"],
 ["curtain-blackout", "curtain", "Blackout curtain", "پرده بلک‌اوت", "ستارة تعتيم", 2, 0.2, 2.5, "blackout", "#6d7b82"],
 ["curtain-double", "curtain", "Double layer · Sheer + drape", "پرده دولایه حریر و پارچه", "ستارة بطبقتين", 2.4, 0.25, 2.6, "double-layer", "#a99581"],
 ["curtain-roman", "curtain", "Roman blind", "پرده رومن", "ستارة رومانية", 1.2, 0.12, 1.7, "roman", "#c7b99e"],
 ["curtain-tieback", "curtain", "Tieback curtain", "پرده با بند جمع‌کن", "ستارة برباط", 2, 0.18, 2.5, "tieback", "#9c8174"],
 ["frame-oak", "picture_frame", "Oak frame · Landscape", "قاب چوبی افقی", "إطار خشبي أفقي", 0.9, 0.055, 0.6, "oak", "#af8457"],
 ["frame-black", "picture_frame", "Black frame · Square", "قاب مشکی مربع", "إطار أسود مربع", 0.7, 0.05, 0.7, "black", "#25282a"],
 ["frame-gold", "picture_frame", "Gold frame · Portrait", "قاب طلایی عمودی", "إطار ذهبي رأسي", 0.55, 0.065, 0.8, "gold", "#c5a35f"],
 ["frame-white", "picture_frame", "White gallery frame", "قاب سفید پاسپارتو", "إطار أبيض", 0.8, 0.05, 0.6, "white", "#e7e3d8"],
 ["frame-triptych", "picture_frame", "Triptych wall art", "تابلوی سه‌تکه", "لوحة ثلاثية", 1.6, 0.055, 0.65, "triptych", "#85684d"],
 ["tv-oled-55", "wall_tv", "Wall TV · 55 inch", "تلویزیون دیواری ۵۵ اینچ", "تلفاز جداري ٥٥ بوصة", 1.24, 0.06, 0.71, "wall-mounted", "#20252a"],
 ["tv-oled-75", "wall_tv", "Wall TV · 75 inch", "تلویزیون دیواری ۷۵ اینچ", "تلفاز جداري ٧٥ بوصة", 1.68, 0.065, 0.96, "wall-mounted", "#20252a"],
 ["tv-console-oak", "tv_unit", "TV + oak console", "تلویزیون و کنسول چوبی", "تلفاز ووحدة خشبية", 1.8, 0.45, 1.45, "console-oak", "#b2946f"],
 ["tv-console-white", "tv_unit", "TV + white console", "تلویزیون و کنسول سفید", "تلفاز ووحدة بيضاء", 1.8, 0.42, 1.45, "console-white", "#deded6"],
 ["tv-pedestal", "tv_unit", "TV · Pedestal stand", "تلویزیون با پایه مرکزی", "تلفاز بقاعدة", 1.45, 0.4, 1.25, "pedestal", "#292e33"],
 ["tv-media-wall", "tv_unit", "Media wall · Timber slats", "تی‌وی وال با پنل چوبی", "جدار تلفاز خشبي", 2.4, 0.4, 2.4, "media-wall", "#987853"],
].map(([id,type,en,fa,ar,width,depth,height,variant,color,chairs])=>Object.freeze({id,type,en,fa,ar,width,depth,height,variant,color,chairs,...(SOFA_SET_LAYOUTS[id]?{layout:SOFA_SET_LAYOUTS[id]}:{})})));
export const LOCKED_ARCHITECTURE=['rooms','walls','openings','footprint','holes','width','depth','height','palette','wallThickness','externalWallThickness'];
const fail=m=>{throw new Error(m);};
export function furniturePlacementScale(value=1){
 if(!Number.isFinite(value)||value<.5||value>1.25)fail('Placement size must be between 50% and 125%. / اندازه باید بین ۵۰ تا ۱۲۵ درصد باشد.');return value;
}
export function furnitureSetBounds(model,scale=1){
 furniturePlacementScale(scale);if(!model?.layout)return null;
 const boxes=model.layout.map(p=>{
  const child=FURNITURE_CATALOG.find(m=>m.id===p.catalogId);if(!child)fail('Unknown set component.');
  const a=p.rotation*Math.PI/180,rx=(Math.abs(Math.cos(a))*child.width+Math.abs(Math.sin(a))*child.depth)/2,ry=(Math.abs(Math.sin(a))*child.width+Math.abs(Math.cos(a))*child.depth)/2;
  return {minX:p.x-rx,maxX:p.x+rx,minY:p.y-ry,maxY:p.y+ry,height:child.height};
 });
 const minX=Math.min(...boxes.map(b=>b.minX))*scale,maxX=Math.max(...boxes.map(b=>b.maxX))*scale,minY=Math.min(...boxes.map(b=>b.minY))*scale,maxY=Math.max(...boxes.map(b=>b.maxY))*scale;
 return {width:maxX-minX,depth:maxY-minY,height:Math.max(...boxes.map(b=>b.height))*scale,centerX:(minX+maxX)/2,centerY:(minY+maxY)/2};
}
export function resolveFurnitureCatalog(edit){
 const builtIn=FURNITURE_CATALOG.find(a=>a.id===edit.catalogId);if(builtIn)return builtIn;
 if(edit.personalModel){const m=personalFurnitureModel(edit.personalModel);if(m.id===edit.catalogId)return m;}
 return null;
}
export function furnitureRotationFromDrag(initialRotation,startX,event){
 if(!Number.isFinite(initialRotation)||!Number.isFinite(startX)||!Number.isFinite(event?.clientX))fail('Invalid rotation gesture.');
 let angle=initialRotation+(event.clientX-startX)*.5;
 if(event.shiftKey)angle=Math.round(angle/15)*15;
 return ((angle%360)+360)%360;
}
export function furnitureSizeFromDrag(dimensions,startX,event){
 const {width,depth,height}=dimensions;
 if(![width,depth,height,startX,event?.clientX].every(Number.isFinite)||Math.min(width,depth,height)<=0)fail('Invalid size gesture.');
 const min=Math.max(.1/width,.04/depth,.01/height),max=Math.min(6/width,4/depth,3/height);
 const factor=Math.max(min,Math.min(max,Math.exp(Math.max(-10,Math.min(10,(event.clientX-startX)/240)))));
 return {width:width*factor,depth:depth*factor,height:height*factor};
}
const inside=(p,poly=[])=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
export function roomAtPoint(scene,point){
 if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return null;
 const hits=scene.rooms.filter(r=>inside(point,r.polygon));
 // DWG floor scopes cover areas without room metadata. Prefer a real room
 // when present, without making its overlap with the fallback ambiguous.
 const classified=hits.filter(r=>!r.scopeOnly);
 const rooms=classified.length?classified:hits;
 return rooms.length===1?rooms[0]:scene.source==='dwg-engineering-interior'?hits.find(r=>r.scopeOnly)||null:null;
}
export function furnitureAnchorAtPoint(scene,point,allowOutdoor){
 if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return null;
 const rooms=scene.source==='dwg-engineering-interior'
  ?scene.rooms.find(room=>room.scopeOnly&&inside(point,room.polygon))||roomAtPoint(scene,point)
  :roomAtPoint(scene,point);
 if(rooms||!allowOutdoor)return rooms;
 const ground=outdoorGround(scene);
 return ground&&!inside(point,ground.footprint)&&inside(point,ground.polygon)?ground:null;
}
// Snap wall-adjacent furniture onto the visible wall face, never its centreline.
export function snapFurnitureToWall(draft,scene){
 if(!['cabinet','kitchen_counter','kitchen_island','wardrobe','tv_unit','refrigerator','freezer','washing_machine','stove','sink','dressing_table','curtain','picture_frame','wall_tv'].includes(draft.type))return draft;
 let result=draft;
 for(let pass=0;pass<2;pass++){
  const candidates=[];
  for(const wall of scene.walls||[]){
   if(!wall.start||!wall.end||wall.type==='railing')continue;
   const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y,len=Math.hypot(dx,dy);if(len<.01)continue;
   const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
   const along=(result.xMeters-wall.start.x)*ux+(result.yMeters-wall.start.y)*uy;if(along<0||along>len)continue;
   const distance=(result.xMeters-wall.start.x)*nx+(result.yMeters-wall.start.y)*ny;
   const angle=(result.rotation||0)*Math.PI/180;
   const extent=result.width/2*Math.abs(nx*Math.cos(angle)+ny*Math.sin(angle))+result.depth/2*Math.abs(-nx*Math.sin(angle)+ny*Math.cos(angle));
   const face=extent+(Number(wall.thickness)||.12)/2;
   const delta=(distance<0?-1:1)*face-distance;
   // Up to 8 cm of empty gap or 18 cm of centreline/face confusion.
   const gap=Math.abs(distance)-face;if(gap>.08||gap<-.18)continue;
   const candidate={...result,xMeters:result.xMeters+nx*delta,yMeters:result.yMeters+ny*delta};
   if(!placementProblem(candidate,scene,{manualFurniturePlacement:true}))candidates.push({candidate,shift:Math.abs(delta)});
  }
  candidates.sort((a,b)=>a.shift-b.shift);if(!candidates.length)break;
  result=candidates[0].candidate;
 }
 return result;
}
export function furnitureDraft(scene,edit){
 const catalog=resolveFurnitureCatalog(edit),original=scene.assets.find(a=>a.id===edit.assetId);
 if(edit.kind==='add'&&!catalog)fail('Unknown furniture model.');
 if(edit.kind!=='add'&&!original)fail('Select a furniture object.');
 if(edit.kind==='replace'&&!catalog)fail('Unknown furniture model.');
 const p=edit.point||{x:original?.xMeters,y:original?.yMeters};
 // DWG room faces may be incomplete/overlapping. Manual design uses the floor
 // envelope; actual walls, openings, voids and other furniture still constrain it.
 const anchor=furnitureAnchorAtPoint(scene,p,edit.allowOutdoor===true);
 if(!anchor)fail(edit.allowOutdoor?'Choose a room or open ground outside the building. / اتاق یا فضای آزاد بیرون ساختمان را انتخاب کن.':'Choose a point inside one unambiguous room. / نقطه‌ای داخل یک اتاق مشخص انتخاب کن.');
 const model=edit.kind==='add'||edit.kind==='replace'?catalog:null;
 const draft={...original,...(model?{type:model.type,width:model.width,depth:model.depth,height:model.height,variant:model.variant,color:model.color,catalogId:model.id}:{}),id:original?.id||'furniture-preview',roomId:anchor.id,xMeters:p.x,yMeters:p.y,rotation:edit.rotation??original?.rotation??0};
 if(edit.kind==='add'&&model){const scale=furniturePlacementScale(edit.scale??1);for(const k of ['width','depth','height'])draft[k]*=scale;}
 if(draft.type==='range_hood')draft.zMeters=1.95;
 else if(['picture_frame','wall_tv'].includes(draft.type))draft.zMeters=1.1;
 else if(model)delete draft.zMeters;
 if(edit.color)draft.color=edit.color;
 if(edit.kind==='resize')for(const key of ['width','depth','height']){
  if(!Number.isFinite(edit.size?.[key])||edit.size[key]<=0)fail('Invalid furniture size.');
  draft[key]=edit.size[key];
 }
 if(edit.kind==='resize'){
  const ratios=['width','depth','height'].map(key=>draft[key]/original[key]);
  if(!ratios.every(n=>Number.isFinite(n)&&Math.abs(n-ratios[0])<.000001))fail('Resize must preserve furniture proportions.');
  if(Number.isFinite(scene.height)&&(Number(draft.zMeters)||0)+draft.height>scene.height)fail('Furniture would exceed the room height. / ارتفاع وسیله از سقف بیشتر می‌شود.');
 }
 return snapFurnitureToWall(draft,scene);
}
export function previewFurnitureEdit(scene,edit){
 let candidate;
 try{
  candidate={...furnitureDraft(scene,edit),previewOperation:edit.kind};
  if(edit.kind==='add'&&resolveFurnitureCatalog(edit)?.layout){
   const b=furnitureSetBounds(resolveFurnitureCatalog(edit),edit.scale??1),angle=candidate.rotation*Math.PI/180;
   candidate={...candidate,width:b.width,depth:b.depth,height:b.height,xMeters:candidate.xMeters+b.centerX*Math.cos(angle)-b.centerY*Math.sin(angle),yMeters:candidate.yMeters+b.centerX*Math.sin(angle)+b.centerY*Math.cos(angle)};
   applyFurnitureEdit(scene,edit);return {candidate,valid:true};
  }
  const problem=placementProblem(candidate,scene,{manualDwgPlacement:edit.freePlacement===true,manualFurniturePlacement:true});
  // Sets need room for the chairs too; the full transaction is checked at commit.
  if(problem)return {candidate,valid:false,error:problem};
  applyFurnitureEdit(scene,edit);
  return {candidate,valid:true};
 }catch(error){return {candidate,valid:false,error:error.message};}
}
export function applyFurnitureEdit(scene,edit){
 if(edit.kind==='material')return applyFurnitureFinish(scene,edit.assetId,edit.materialId,edit.target);
 if(!['add','move','rotate','resize','color','replace','remove'].includes(edit.kind))fail('Unsupported furniture operation.');
 const chosen=resolveFurnitureCatalog(edit);
 if(chosen?.layout&&edit.kind==='replace')fail('Place a complete set on the floor; it cannot replace one object. / ست کامل را روی کف قرار بده؛ جایگزین یک وسیله نمی‌شود.');
 if(chosen?.layout&&edit.kind==='add'){
  if(!Number.isFinite(edit.point?.x)||!Number.isFinite(edit.point?.y))fail('Choose a point on the floor.');
  const scale=furniturePlacementScale(edit.scale??1),angle=(edit.rotation||0)*Math.PI/180,groupId=`sofa-set-${globalThis.crypto.randomUUID()}`,originalCount=scene.assets.length;
  let next=scene;
  try{for(const piece of chosen.layout){
   const before=next.assets.length;
   next=applyFurnitureEdit(next,{kind:'add',catalogId:piece.catalogId,scale,freePlacement:edit.freePlacement,allowOutdoor:edit.allowOutdoor,point:{x:edit.point.x+scale*(piece.x*Math.cos(angle)-piece.y*Math.sin(angle)),y:edit.point.y+scale*(piece.x*Math.sin(angle)+piece.y*Math.cos(angle))},rotation:(edit.rotation||0)+piece.rotation});
   next.assets=next.assets.map((a,i)=>i>=before?{...a,furnitureSetId:groupId,furnitureSetCatalogId:chosen.id,furnitureSetScale:scale,seatingCapacity:piece.seats}:a);
  }}catch(error){fail('Not enough clear space for the complete set; nothing was added. / فضای آزاد کافی برای ست کامل نیست؛ هیچ وسیله‌ای اضافه نشد. '+error.message);}
  if(next.assets.length!==originalCount+chosen.layout.length)fail('Incomplete furniture set.');
  next.furnitureEditor={version:'furniture-editor-v67',lastOperation:'add-set',setCatalogId:chosen.id};return next;
 }

 const original=scene.assets.find(a=>a.id===edit.assetId);
 let plan,model,candidate;
 if(edit.kind==='remove')plan={action:'remove',assetId:edit.assetId};
 else if(edit.kind==='color')plan={action:'update',assetId:edit.assetId,color:edit.color};
 else{
  candidate=furnitureDraft(scene,edit);model=resolveFurnitureCatalog(edit);
  if(edit.kind==='replace'&&model.type!==original.type)fail('Choose a model of the same furniture type. / مدل هم‌نوع انتخاب کن.');
  plan={action:edit.kind==='add'?'add':'update',assetId:edit.kind==='add'?null:edit.assetId,type:candidate.type,roomId:candidate.roomId,xMeters:candidate.xMeters,yMeters:candidate.yMeters,width:candidate.width,depth:candidate.depth,height:candidate.height,rotation:candidate.rotation,color:candidate.color};
 }
 const actions=[plan];
 if(edit.kind==='add'&&model.chairs){
  const a=candidate,t=a.rotation*Math.PI/180;
  for(const [x,y,rotation] of [[-a.width/2-.3,0,-90],[a.width/2+.3,0,90],[0,-a.depth/2-.32,0],[0,a.depth/2+.32,180]])actions.push({action:'add',type:'chair',roomId:a.roomId,xMeters:a.xMeters+x*Math.cos(t)-y*Math.sin(t),yMeters:a.yMeters+x*Math.sin(t)+y*Math.cos(t),width:.45,depth:.5,height:.9,rotation:rotation+a.rotation,color:model.color});
 }
 const next=applyPromptActions(scene,{status:'apply',actions},{manualDwgPlacement:edit.freePlacement===true,manualFurniturePlacement:true}).scene;
 if(model){
  const id=edit.kind==='add'?next.assets[scene.assets.length].id:original.id;
  next.assets=next.assets.map(a=>{if(a.id!==id)return a;const {renderingBaseDimensions,customModelId,customModelName,preserveModelColors,...reset}=a;return {...reset,variant:model.variant,catalogId:model.id,...(edit.kind==='add'&&(edit.scale??1)!==1?{renderingBaseDimensions:{width:model.width,depth:model.depth,height:model.height}}:{}),...(model.customModelId?{customModelId:model.customModelId,customModelName:model.en,preserveModelColors:true}:{}),...(model.type==='range_hood'?{zMeters:1.95}:['picture_frame','wall_tv'].includes(model.type)?{zMeters:1.1}:{zMeters:0})};});
 }
 if(edit.kind==='color')next.assets=next.assets.map(a=>a.id===original.id&&a.furnitureFinishes?{...a,furnitureFinishes:Object.fromEntries(Object.entries(a.furnitureFinishes).map(([key,value])=>[key,{...value,color:edit.color}]))}:a);
 if(edit.kind==='color')next.assets=next.assets.map(a=>a.id===original.id&&a.customModelId?{...a,preserveModelColors:false}:a);
 if(edit.kind==='resize')next.assets=next.assets.map(a=>a.id===original.id?{...a,renderingBaseDimensions:original.renderingBaseDimensions||{width:original.width,depth:original.depth,height:original.height}}:a);
 const editedIds=new Set(edit.kind==='add'?next.assets.slice(scene.assets.length).map(a=>a.id):[edit.assetId]);
 next.assets=next.assets.map(a=>editedIds.has(a.id)?{...a,...(edit.freePlacement===true&&scene.source==='dwg-engineering-interior'?{placementReview:'unverified_dwg_wall_clearance'}:{}),placementSource:'manual_furniture_editor',provenance:'proposed',excludeFromTakeoff:true,...(['move','replace'].includes(edit.kind)?{embeddedInCounter:false}:{})}:a);
 for(const key of LOCKED_ARCHITECTURE)if(JSON.stringify(next[key])!==JSON.stringify(scene[key]))fail(`Architecture is locked: ${key}`);
 next.furnitureEditor={version:'furniture-editor-v67',lastOperation:edit.kind};
 return next;
}
