import {loadPersonalTexture} from './personalTextureResources.mjs';
import {markTextureResourceReady} from './textureBridge.mjs';
import {validAssetId} from './personalAssets.mjs';
// Visual finishes only. These IDs never enter the quantity or pricing engine.
export const SURFACE_MIME = 'application/x-ventra-surface-material';
export const SURFACE_GROUPS = Object.freeze([
  {id:'stone',en:'Stone',fa:'سنگ',ar:'حجر'},
  {id:'brick',en:'Brick',fa:'آجر',ar:'طوب'},
  {id:'sand',en:'Sand',fa:'شن',ar:'رمل'},
  {id:'cement',en:'Cement',fa:'سیمان',ar:'أسمنت'},
  {id:'wood',en:'Wood',fa:'چوب',ar:'خشب'},
  {id:'paint',en:'Paint',fa:'رنگ',ar:'دهان'},
  {id:'wallpaper',en:'Wallpaper',fa:'کاغذدیواری',ar:'ورق جدران'},
]);
export const SURFACE_MATERIALS = Object.freeze([
  ['stone-ivory','stone','Ivory','سفید عاجی','عاجي','#e7e2d7'],
  ['stone-beige','stone','Beige','بژ','بيج','#c9b797'],
  ['stone-slate','stone','Slate','خاکستری سنگی','رمادي','#69727a'],
  ['stone-charcoal','stone','Charcoal','ذغالی','فحمي','#41464b'],
  ['brick-red','brick','Red','قرمز','أحمر','#ad5843'],
  ['brick-terracotta','brick','Terracotta','سفالی','فخاري','#cb8960'],
  ['brick-white','brick','White','سفید','أبيض','#e0dace'],
  ['brick-dark','brick','Dark','تیره','داكن','#57534f'],
  ['sand-golden','sand','Golden','طلایی','ذهبي','#c9ab72'],
  ['sand-pale','sand','Pale','روشن','فاتح','#e4d9bc'],
  ['sand-grey','sand','Grey','خاکستری','رمادي','#a3a5a0'],
  ['sand-brown','sand','Brown','قهوه‌ای','بني','#99816a'],
  ['cement-grey','cement','Grey','خاکستری','رمادي','#a5a7a5'],
  ['cement-white','cement','White','سفید','أبيض','#e2e0d8'],
  ['cement-warm','cement','Warm','کرم گرم','دافئ','#c0b6a5'],
  ['cement-dark','cement','Dark','تیره','داكن','#666b6c'],
  ['wood-oak','wood','Oak','بلوط روشن','بلوط','#c4a071'],
  ['wood-walnut','wood','Walnut','گردویی','جوز','#825b40'],
  ['wood-ash','wood','Ash','چوب خاکستری','خشب رمادي','#b4ada1'],
  ['wood-ebony','wood','Ebony','آبنوس تیره','أبنوس','#51463d'],
  ['paint-white','paint','White','سفید','أبيض','#f2f1eb'],
  ['paint-ivory','paint','Ivory','کرم روشن','عاجي','#e8ddc7'],
  ['paint-grey','paint','Warm grey','طوسی گرم','رمادي دافئ','#bcb7af'],
  ['paint-charcoal','paint','Charcoal','ذغالی','فحمي','#505559'],
  ['paint-sage','paint','Sage green','سبز ملایم','أخضر مريمي','#a6b29b'],
  ['paint-blue','paint','Dusty blue','آبی ملایم','أزرق هادئ','#9bafbe'],
  ['paint-terracotta','paint','Terracotta','سفالی','فخاري','#c68f77'],
  ['paint-rose','paint','Dusty rose','صورتی چرک','وردي هادئ','#c6a3a0'],
  ['wallpaper-stripe-cream','wallpaper','Cream stripes','راه‌راه کرم','مخطط كريمي','#eee5d4','stripe','#cdbb9a'],
  ['wallpaper-stripe-blue','wallpaper','Blue stripes','راه‌راه آبی','مخطط أزرق','#e5edf1','stripe','#95acbe'],
  ['wallpaper-geo-greige','wallpaper','Geometric beige','هندسی بژ','هندسي بيج','#e8e2d9','geometric','#ac9a87'],
  ['wallpaper-geo-sage','wallpaper','Geometric sage','هندسی سبز','هندسي أخضر','#e5e9df','geometric','#a0ad94'],
  ['wallpaper-damask-gold','wallpaper','Gold damask','داماسک طلایی','دمشقي ذهبي','#eee4d2','damask','#c8ab75'],
  ['wallpaper-damask-navy','wallpaper','Navy damask','داماسک سرمه‌ای','دمشقي كحلي','#334961','damask','#97aabe'],
  ['wallpaper-leaf-ivory','wallpaper','Ivory botanical','برگ‌دار روشن','نباتي عاجي','#eeeadf','botanical','#899a7d'],
  ['wallpaper-leaf-olive','wallpaper','Olive botanical','برگ‌دار زیتونی','نباتي زيتوني','#65735b','botanical','#bbc5a6'],
].map(([id,kind,en,fa,ar,color,pattern,accent])=>Object.freeze({id,kind,en,fa,ar,color,
  ...(pattern?{pattern,accent}:{}),...(['paint','wallpaper'].includes(kind)?{wallOnly:true}:{})})));
export const findSurfaceMaterial=(id,scene)=>SURFACE_MATERIALS.find(m=>m.id===id)||(validAssetId(scene?.surfaceFinishes?.customMaterials?.[id]?.assetId)&&id==='personal:'+scene.surfaceFinishes.customMaterials[id].assetId?scene.surfaceFinishes.customMaterials[id]:null);
export const surfaceMaterialAllowed=(id,target,scene)=>!!target&&!!findSurfaceMaterial(id,scene)&&(!findSurfaceMaterial(id,scene).wallOnly||target.kind==='wall');
export const WALL_SURFACE_SIDES=Object.freeze(['x+','x-','y+','y-','z+','z-']);
// Raycaster face normals are mesh-local: camera motion and wall rotation do
// not change the saved face identity. Never infer the face from screen space.
export function wallSurfaceSide(normal){
  if(!normal||![normal.x,normal.y,normal.z].every(Number.isFinite))return null;
  const axis=['x','y','z'].reduce((a,b)=>Math.abs(normal[b])>Math.abs(normal[a])?b:a);
  return Math.abs(normal[axis])>.7?axis+(normal[axis]>0?'+':'-'):null;
}
export const surfaceMaterialList=material=>Array.isArray(material)?material:material?.materials||[material];
export const surfaceKey=target=>JSON.stringify([target.kind,String(target.id),...(target.side===undefined?[]:[target.side])]);
export function validSurfaceTarget(scene,target){
  if(!target||typeof target.id!=='string'||!target.id)return false;
  if(target.side!==undefined&&(target.kind!=='wall'||!WALL_SURFACE_SIDES.includes(target.side)))return false;
  if(target.kind==='floor-base')return target.id==='footprint'&&scene.footprint?.length>=3;
  if(target.kind==='floor')return scene.rooms?.some(r=>String(r.id)===target.id&&!r.scopeOnly);
  if(target.kind==='wall')return scene.walls?.some(w=>String(w.id)===target.id&&w.type!=='railing');
  return false;
}
export function applySurfaceMaterial(scene,target,materialId){
  if(!validSurfaceTarget(scene,target))throw new Error('The floor or wall is no longer available.');
  if(materialId!==null&&!findSurfaceMaterial(materialId,scene))throw new Error('Unknown surface material.');
  if(materialId!==null&&!surfaceMaterialAllowed(materialId,target,scene))throw new Error('Paint and wallpaper apply to walls only.');
  const assignments={...(scene.surfaceFinishes?.assignments||{})},scales={...(scene.surfaceFinishes?.scales||{})};
  // Expand an older whole-wall finish before the first face edit. Untouched
  // faces keep their appearance, while resetting one face restores its base.
  if(target.kind==='wall'&&target.side!==undefined){
    const legacyKey=surfaceKey({kind:'wall',id:target.id}),legacy=assignments[legacyKey];
    if(findSurfaceMaterial(legacy,scene)){
      for(const side of WALL_SURFACE_SIDES){
        const faceKey=surfaceKey({...target,side});
        if(!Object.hasOwn(assignments,faceKey))assignments[faceKey]=legacy;
        if(scales[legacyKey]!==undefined&&!Object.hasOwn(scales,faceKey))scales[faceKey]=scales[legacyKey];
      }
      delete assignments[legacyKey];delete scales[legacyKey];
    }
  }
  const key=surfaceKey(target);
  if(materialId===null){delete assignments[key];delete scales[key];}else assignments[key]=materialId;
  return {...scene,surfaceFinishes:{...scene.surfaceFinishes,version:1,assignments,...(scene.surfaceFinishes?.scales||Object.keys(scales).length?{scales}:{})}};
}
export function surfaceTextureSize(scene,target){
 const key=surfaceKey(target),legacy=surfaceKey({kind:target.kind,id:target.id});
 const n=scene.surfaceFinishes?.scales?.[key]??scene.surfaceFinishes?.scales?.[legacy]??2;
 return Number.isFinite(n)&&n>=.05&&n<=20?n:2;
}
export function applySurfaceTextureSize(scene,target,sizeMeters){
 if(!Number.isFinite(sizeMeters)||sizeMeters<.05||sizeMeters>20)throw new Error('Texture repeat size must be 0.05–20 metres. / اندازه تکرار بافت باید بین ۰٫۰۵ تا ۲۰ متر باشد.');
 const id=scene.surfaceFinishes?.assignments?.[surfaceKey(target)]??scene.surfaceFinishes?.assignments?.[surfaceKey({kind:target.kind,id:target.id})];
 if(!findSurfaceMaterial(id,scene))throw new Error('Apply a material to this face first. / ابتدا متریال را روی این سطح اعمال کن.');
 const next=applySurfaceMaterial(scene,target,id);
 return {...next,surfaceFinishes:{...next.surfaceFinishes,scales:{...next.surfaceFinishes.scales,[surfaceKey(target)]:sizeMeters}}};
}
export function assertSurfaceOnlyEdit(before,after){
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(key!=='surfaceFinishes'&&JSON.stringify(before[key])!==JSON.stringify(after[key]))throw new Error(`Material edit cannot change ${key}.`);
  }
  if(after.surfaceFinishes===undefined)return;
  const finish=after.surfaceFinishes;
  if(finish?.version!==1||!finish.assignments||typeof finish.assignments!=='object'||Array.isArray(finish.assignments))throw new Error('Invalid material assignments.');
  for(const [key,id] of Object.entries(finish.assignments)){
    let parts;try{parts=JSON.parse(key);}catch{throw new Error('Invalid surface reference.');}
    // Old, orphaned assignments may remain after a wall edit, but cannot be
    // introduced by this editor. This avoids destroying unrelated saved work.
    const target=Array.isArray(parts)&&[2,3].includes(parts.length)?{kind:parts[0],id:parts[1],...(parts.length===3?{side:parts[2]}:{})}:null;
    if(parts?.length===3&&(target?.kind!=='wall'||!WALL_SURFACE_SIDES.includes(target.side)))throw new Error('Invalid wall face.');
    if(!surfaceMaterialAllowed(id,target,after)||(!validSurfaceTarget(after,target)&&before.surfaceFinishes?.assignments?.[key]!==id))throw new Error('Invalid surface material or target.');
  }
  if(finish.scales!==undefined){
   if(!finish.scales||typeof finish.scales!=='object'||Array.isArray(finish.scales))throw new Error('Invalid texture sizes.');
   for(const[key,value]of Object.entries(finish.scales)){
    let p;try{p=JSON.parse(key);}catch{throw new Error('Invalid texture target.');}
    const target=Array.isArray(p)&&[2,3].includes(p.length)?{kind:p[0],id:p[1],...(p.length===3?{side:p[2]}:{})}:null;
    if(!Number.isFinite(value)||value<.05||value>20||(!validSurfaceTarget(after,target)&&before.surfaceFinishes?.scales?.[key]!==value))throw new Error('Invalid texture size or target.');
   }
  }
  if(finish.customMaterials!==undefined){
   if(!finish.customMaterials||typeof finish.customMaterials!=='object'||Array.isArray(finish.customMaterials))throw new Error('Invalid personal materials.');
   for(const[key,item]of Object.entries(finish.customMaterials)){
    if(!validAssetId(item?.assetId)||key!=='personal:'+item.assetId||item.id!==key||item.kind!=='custom'||['en','fa','ar'].some(k=>typeof item[k]!=='string'||item[k].length>100)||Object.keys(item).some(k=>!['id','assetId','kind','en','fa','ar','color'].includes(k)))throw new Error('Invalid personal material reference.');
   }
  }

}

function surfaceHitMaterial(hit){
  return surfaceMaterialList(hit.object.material)[hit.face?.materialIndex||0];
}

export function pickSurfaceHit(hits){
  const visible=object=>{for(let p=object;p;p=p.parent)if(p.visible===false)return false;return true;};
  const candidates=hits.filter(h=>visible(h.object)&&!h.object.userData?.nonSelectable&&!h.object.isLine&&!h.object.isSprite&&
    !['Line','LineSegments','Sprite'].includes(h.object.type)&&
    !(h.object.userData?.surfaceTarget?.kind==='wall'&&surfaceHitMaterial(h)?.transparent&&surfaceHitMaterial(h)?.opacity<.1));
  // The base plate and a room floor can be coplanar. Prefer the actual room.
  candidates.sort((a,b)=>Math.abs(a.distance-b.distance)<1e-5
    ? Number(a.object.userData?.surfaceTarget?.kind==='floor-base')-Number(b.object.userData?.surfaceTarget?.kind==='floor-base')
    : a.distance-b.distance);
  const hit=candidates[0],target=hit?.object.userData?.surfaceTarget;
  if(target?.kind==='wall'){
    const side=wallSurfaceSide(hit.face?.normal);
    return side?{...target,side}:null; // missing face must never paint both sides
  }
  return target?{...target}:null; // furniture/glass blocks painting through it
}

// Reproducible repeating procedural swatches: no network, paid model, or remote
// texture license is required. Use the same painter for UI and rendered meshes.
export function paintSurfaceSwatch(canvas,material){
  if(!canvas||!material)return;
  const c=canvas.getContext('2d');if(!c)return;
  const s=canvas.width;canvas.height=s;
  let seed=21731;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  c.fillStyle=material.color;c.fillRect(0,0,s,s);
  if(material.kind==='paint')return; // clean matte paint, not gritty masonry
  const rgb=material.color.match(/\w\w/g).map(v=>parseInt(v,16));
  const tint=(delta,alpha=1)=>`rgba(${rgb.map(v=>Math.max(0,Math.min(255,Math.round(v+delta)))).join(',')},${alpha})`;
  for(let i=0;i<9000;i++){
    const x=rand()*s,y=rand()*s,r=material.kind==='sand'?1+rand()*2:.5+rand();
    c.fillStyle=tint((rand()-.5)*(material.kind==='cement'?20:material.kind==='wallpaper'?12:50),.45);
    c.fillRect(x,y,r,r);
  }
  if(material.kind==='wallpaper'){
    c.strokeStyle=material.accent;c.fillStyle=material.accent;c.lineWidth=s/170;
    if(material.pattern==='stripe'){
      for(let x=0;x<s;x+=s/8)c.fillRect(x,0,s/16,s);
    }else{
      const tile=s/4;
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const x=(col+.5)*tile,y=(row+.5)*tile;
        c.beginPath();
        if(material.pattern==='geometric'){
          c.moveTo(x,y-tile/2);c.lineTo(x+tile/2,y);c.lineTo(x,y+tile/2);c.lineTo(x-tile/2,y);c.closePath();c.stroke();
          c.strokeRect(x-tile*.12,y-tile*.12,tile*.24,tile*.24);
        }else if(material.pattern==='damask'){
          for(let petal=0;petal<4;petal++){
            const angle=petal*Math.PI/2,dx=Math.cos(angle),dy=Math.sin(angle),px=-dy,py=dx;
            c.moveTo(x,y);
            c.bezierCurveTo(x+dx*tile*.48+px*tile*.24,y+dy*tile*.48+py*tile*.24,x+dx*tile*.48-px*tile*.24,y+dy*tile*.48-py*tile*.24,x,y);
          }
          c.stroke();c.beginPath();c.arc(x,y,tile*.055,0,Math.PI*2);c.fill();
        }else if(material.pattern==='botanical'){
          c.moveTo(x-tile*.1,y+tile*.4);c.bezierCurveTo(x-tile*.14,y,x+tile*.14,y,x+tile*.1,y-tile*.4);c.stroke();
          for(let leaf=0;leaf<4;leaf++){
            const yy=y-tile*.27+leaf*tile*.18,sign=leaf%2?1:-1;
            c.beginPath();c.moveTo(x,yy+tile*.08);
            c.bezierCurveTo(x+sign*tile*.38,yy+tile*.12,x+sign*tile*.38,yy-tile*.15,x,yy+tile*.08);c.fill();
          }
        }
      }
    }
  }else if(material.kind==='wood'){
    const board=s/6;
    for(let i=0;i<6;i++){
      c.fillStyle=tint((rand()-.5)*24,.5);c.fillRect(i*board,0,board,s);
      for(let j=0;j<35;j++){
        const x=i*board+rand()*board;
        c.strokeStyle=tint(-35,.18+rand()*.2);c.lineWidth=.4+rand();c.beginPath();
        for(let k=0;k<=32;k++){const y=k*s/32,xx=x+Math.sin(k*Math.PI/16+rand()*.15)*2;k?c.lineTo(xx,y):c.moveTo(xx,y);}c.stroke();
      }
      c.strokeStyle=tint(-60,.5);c.lineWidth=1;c.beginPath();c.moveTo(i*board,0);c.lineTo(i*board,s);c.stroke();
      const y=(i%3)*s/3;c.beginPath();c.moveTo(i*board,y);c.lineTo((i+1)*board,y);c.stroke();
    }
  }else if(material.kind==='brick'||material.kind==='stone'){
    const rows=material.kind==='brick'?8:4,cols=material.kind==='brick'?4:4;
    for(let row=0;row<rows;row++)for(let col=-1;col<=cols;col++){
      const w=s/cols,h=s/rows,x=col*w+(material.kind==='brick'&&row%2?w/2:0),y=row*h;
      c.fillStyle=tint((rand()-.5)*28,.35);c.fillRect(x+1,y+1,w-2,h-2);
      c.strokeStyle=material.kind==='brick'?'rgba(225,216,199,.72)':tint(-50,.4);
      c.lineWidth=material.kind==='brick'?2.5:1;c.strokeRect(x,y,w,h);
      if(material.kind==='stone')for(let k=0;k<3;k++){
        const yy=y+rand()*h;c.strokeStyle=tint(-65,.13);c.lineWidth=.6+rand();c.beginPath();
        c.moveTo(x,yy);c.bezierCurveTo(x+w*.3,yy-8,x+w*.6,yy+10,x+w,yy+2);c.stroke();
      }
    }
  }else if(material.kind==='cement'){
    for(let i=0;i<120;i++){
      const x=rand()*s,y=rand()*s,r=s*(.02+rand()*.09);
      const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,tint(rand()>.5?20:-25,.13));g.addColorStop(1,tint(0,0));
      c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);
    }
  }
}

export function createSurfaceMeshMaterial(THREE,id,makeCanvas=()=>document.createElement('canvas'),options={}){
  const item=findSurfaceMaterial(id,options.scene);if(!item)return null;
  const canvas=makeCanvas();canvas.width=item.kind==='custom'?256:512;if(item.kind==='custom'){canvas.height=256;const c=canvas.getContext('2d');if(c){c.fillStyle='#cccccc';c.fillRect(0,0,256,256);}}else paintSurfaceSwatch(canvas,item);
  const texture=new THREE.Texture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.generateMipmaps=true;texture.anisotropy=4;
  texture.minFilter=THREE.LinearMipmapLinearFilter??THREE.LinearMipMapLinearFilter??THREE.LinearFilter;
  texture.magFilter=THREE.LinearFilter;
  const tile=Number.isFinite(options.tileSize)&&options.tileSize>=.05&&options.tileSize<=20?options.tileSize:2;
  texture.repeat.set(1/tile,1/tile);texture.needsUpdate=true;
  const Material=THREE.MeshPhongMaterial||THREE.MeshLambertMaterial;
  const material=new Material({color:0xffffff,map:texture,side:THREE.DoubleSide,
    shininess:item.kind==='stone'?34:item.kind==='wood'?12:2});
  if(!['paint','custom'].includes(item.kind)){
    material.bumpMap=texture;material.bumpScale=item.kind==='brick'?.008:item.kind==='sand'?.012:item.kind==='wallpaper'?.0005:.002;
  }
  material.userData={ventraSurfaceMaterial:id};
  if(item.kind==='custom'&&typeof window!=='undefined'){
   let disposed=false,image;material.addEventListener?.('dispose',()=>{disposed=true;if(image){image.onload=null;image.onerror=null;image.src='';}});
   loadPersonalTexture(item.assetId,options.scene?.projectId).then(resource=>{
    if(disposed)return;const {image,width,height}=resource;
    // Power-of-two canvases also work in the legacy WebGL fallback. UV repeat
    // restores the source image's aspect ratio after resampling into the square.
    const size=2**Math.ceil(Math.log2(Math.min(1024,Math.max(width,height))));canvas.width=size;canvas.height=size;
    const c=canvas.getContext('2d');c.drawImage(image,0,0,size,size);texture.repeat.set(1/tile,(width/height)/tile);markTextureResourceReady(texture);
    window.dispatchEvent(new CustomEvent('ventra:surface-resource',{detail:{projectId:options.scene?.projectId,assetId:item.assetId}}));
   }).catch(error=>{if(!disposed)window.dispatchEvent(new CustomEvent('ventra:surface-resource-error',{detail:{projectId:options.scene?.projectId,assetId:item.assetId,message:error.message}}));});
  }
  return material;
}

export function applySurfaceUVs(THREE,mesh,kind){
  const g=mesh.geometry,wall=kind==='wall',z=mesh.position?.z||0;
  const angle=mesh.rotation?.z||0;
  const along=(mesh.position?.x||0)*Math.cos(angle)+(mesh.position?.y||0)*Math.sin(angle);
  const uv=(v,n)=>wall?(Math.abs(n.z)>.7?[v.x,v.y]:Math.abs(n.x)>.7?[v.y,v.z+z]:[v.x+along,v.z+z]):[v.x,v.y];
  if(g?.vertices&&g.faces){
    g.faceVertexUvs[0]=g.faces.map(f=>[f.a,f.b,f.c].map(i=>new THREE.Vector2(...uv(g.vertices[i],f.normal||{}))));g.uvsNeedUpdate=true;
  }else if(g?.attributes?.position&&THREE.Float32BufferAttribute){
    const p=g.attributes.position,n=g.attributes.normal,values=[];
    for(let i=0;i<p.count;i++)values.push(...uv({x:p.getX(i),y:p.getY(i),z:p.getZ(i)},{x:n?.getX(i)||0,y:n?.getY(i)||0,z:n?.getZ(i)||0}));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(values,2));
  }
}

// Assign one slot per local box face. Legacy Face3 indices also feed the
// physical renderer's BufferGeometry groups; no source vertices are changed.
export function assignWallFaceMaterials(THREE,mesh,materials){
  const g=mesh.geometry;
  if(g?.faces){
    for(const face of g.faces){
      const index=WALL_SURFACE_SIDES.indexOf(wallSurfaceSide(face.normal));
      if(index<0)throw new Error('Wall face normal is unavailable.');
      face.materialIndex=index;
    }
    g.groupsNeedUpdate=true;
    mesh.material=THREE.MeshFaceMaterial?new THREE.MeshFaceMaterial(materials):materials;
  }else if(g?.attributes?.normal&&g.clearGroups&&g.addGroup){
    const n=g.attributes.normal,index=g.index;
    const count=index?index.count:g.attributes.position.count;
    const groups=[];
    for(let start=0;start<count;start+=3){
      const i=index?index.getX(start):start;
      const slot=WALL_SURFACE_SIDES.indexOf(wallSurfaceSide({x:n.getX(i),y:n.getY(i),z:n.getZ(i)}));
      if(slot<0)throw new Error('Wall face normal is unavailable.');
      const last=groups[groups.length-1];
      if(last?.materialIndex===slot)last.count+=3;
      else groups.push({start,count:3,materialIndex:slot});
    }
    g.clearGroups();for(const group of groups)g.addGroup(group.start,group.count,group.materialIndex);
    mesh.material=materials;
  }else throw new Error('Wall geometry does not support face materials.');
}

export function decorateSurfaceMesh(THREE,mesh,target,scene,cache){
  if(!mesh)return;
  mesh.userData={...mesh.userData,surfaceTarget:target};
  const assignments=scene.surfaceFinishes?.assignments||{};
  const id=assignments[surfaceKey(target)];
  const resolve=(id,size=2)=>{
    const key=size===2?`${target.kind}:${id}`:`${target.kind}:${id}:${size}`;
    let material=cache?.get(key);
    if(!material){material=createSurfaceMeshMaterial(THREE,id,undefined,{scene,tileSize:size});cache?.set(key,material);}
    return material;
  };
  if(target.kind==='wall'&&WALL_SURFACE_SIDES.some(side=>Object.hasOwn(assignments,surfaceKey({...target,side})))){
    const original=mesh.material;
    const materials=WALL_SURFACE_SIDES.map(side=>{
      const faceId=assignments[surfaceKey({...target,side})]??id;
      return findSurfaceMaterial(faceId,scene)?resolve(faceId,surfaceTextureSize(scene,{...target,side})):original;
    });
    assignWallFaceMaterials(THREE,mesh,materials);
    applySurfaceUVs(THREE,mesh,target.kind);return;
  }
  // Legacy whole-wall assignments remain readable until the next face edit.
  if(!findSurfaceMaterial(id,scene))return;
  if(target.kind!=='wall'){
    mesh.material?.map?.dispose?.();mesh.material?.bumpMap?.dispose?.();mesh.material?.dispose?.();
  }
  mesh.material=resolve(id,surfaceTextureSize(scene,target));applySurfaceUVs(THREE,mesh,target.kind);
}
