// Read-only snapshot of Ventra's existing furniture renderer; existing viewer is untouched.
import {bindKitchenSwitch, buildKitchenFridge, buildKitchenStorage, buildKitchenFaucet} from '../kitchenModel.mjs';
import {presentationFinish} from '../interiorRenderQuality.mjs';
import {createFurnitureFinishMaterial} from '../furnitureFinishes.mjs';
const VENTRA_SCHEMATIC_ASSET_DEFAULTS = {
  sofa: { width: 2.35, depth: 0.95, height: 0.88 },
  armchair: { width: 0.9, depth: 0.9, height: 0.92 },
  coffee_table: { width: 1.15, depth: 0.65, height: 0.42 },
  dining_table: { width: 1.8, depth: 0.95, height: 0.76 },
  desk: { width: 1.35, depth: 0.65, height: 0.76 },
  chair: { width: 0.48, depth: 0.52, height: 0.9 },
  bed: { width: 1.8, depth: 2.05, height: 0.62 },
  wardrobe: { width: 1.8, depth: 0.62, height: 2.25 },
  cabinet: { width: 1.2, depth: 0.55, height: 0.9 },
  tv_unit: { width: 1.9, depth: 0.38, height: 0.62 },
  kitchen_counter: { width: 2.2, depth: 0.65, height: 0.92 },
  rug: { width: 2.2, depth: 1.6, height: 0.025 },
  plant: { width: 0.45, depth: 0.45, height: 0.9 },
  kitchen_island: { width: 1.9, depth: 0.95, height: 0.92 },
  nightstand: { width: 0.5, depth: 0.45, height: 0.5 },
  bathtub: { width: 1.75, depth: 0.78, height: 0.58 },
  sink: { width: 0.82, depth: 0.52, height: 0.86 },
  faucet: { width: 0.18, depth: 0.18, height: 0.38 },
  shower: { width: 0.95, depth: 0.95, height: 2.1 },
  toilet: { width: 0.72, depth: 0.82, height: 0.78 },
  refrigerator: { width: 0.85, depth: 0.75, height: 1.85 },
  stove: { width: 0.70, depth: 0.65, height: 0.90 },
  washing_machine: { width: 0.65, depth: 0.65, height: 0.88 },
  mirror: { width: 0.75, depth: 0.04, height: 1.10 },
};

function hexNumber(value, fallback = 0xcccccc) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  return fallback;
}

function ventraNormalizeSchematicAssetType(asset) {
  const raw = String(
    asset?.type ||
    asset?.assetType ||
    asset?.name ||
    asset?.label ||
    asset?.description ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  if (!raw) return "generic";
  if(raw==='picture_frame')return 'picture_frame';
  if(raw==='wall_tv')return 'tv_unit';
  if (/curtain/.test(raw)) return "curtain";

  if (/(sectional|l_shape.*sofa|l_sofa|couch|sofa)/.test(raw)) return "sofa";
  if (/(armchair|lounge_chair|accent_chair)/.test(raw)) return "armchair";
  if (/(double_bed|queen_bed|king_bed|single_bed|bed)/.test(raw)) return "bed";
  if (/(wardrobe|closet|dresser|cupboard)/.test(raw)) return "wardrobe";
  if (/(nightstand|bedside|side_table)/.test(raw)) return "nightstand";
  if (/(coffee_table|center_table|centre_table)/.test(raw)) return "coffee_table";
  if (/(dining_table|dinner_table)/.test(raw)) return "dining_table";
  if (/(office_desk|study_desk|desk)/.test(raw)) return "desk";
  if (/(dining_chair|chair|stool)/.test(raw)) return "chair";
  if (/(tv_unit|tv_console|media_console|television_unit)/.test(raw)) return "tv_unit";
  if (/(kitchen_island|island_counter|island)/.test(raw)) return "kitchen_island";
  if (/(kitchen_counter|base_cabinet|wall_cabinet|kitchen_cabinet|countertop|counter)/.test(raw)) return "kitchen_counter";
  if (/(range_hood|extractor_hood|cooker_hood)/.test(raw)) return "range_hood";
  if (/(rug|carpet)/.test(raw)) return "rug";
  if (/(plant|potted_plant|indoor_plant)/.test(raw)) return "plant";
  if (raw === "cabinet_door") return "cabinet_door";
  if (/(cabinet|storage_unit|shelving|shelf)/.test(raw)) return "cabinet";
  if (/(bathtub|bath_tub|bath)/.test(raw)) return "bathtub";
  if (/(wash_basin|basin|vanity_sink|sink)/.test(raw)) return "sink";
  if (/(faucet|tap|mixer)/.test(raw)) return "faucet";
  if (/(shower_enclosure|shower_cubicle|shower)/.test(raw)) return "shower";
  if (/(toilet|wc|water_closet)/.test(raw)) return "toilet";
  if (/(fridge|refrigerator)/.test(raw)) return "refrigerator";
  if (/(oven|stove|cooker|range)/.test(raw)) return "stove";
  if (/(washing_machine|washer)/.test(raw)) return "washing_machine";
  if (/(mirror)/.test(raw)) return "mirror";

  return raw;
}

function ventraApplyFloorMaterialUVs(THREE,geometry){
  if(geometry?.vertices&&geometry?.faces&&THREE.Vector2){
    geometry.faceVertexUvs[0]=geometry.faces.map(f=>[f.a,f.b,f.c].map(i=>new THREE.Vector2(geometry.vertices[i].x,geometry.vertices[i].y)));
    geometry.uvsNeedUpdate=true;
  }else if(geometry?.attributes?.position&&THREE.Float32BufferAttribute){
    const p=geometry.attributes.position,uv=[];
    for(let i=0;i<p.count;i++)uv.push(p.getX(i),p.getY(i));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  }
}

function ventraResolveSchematicAssetPlacement(
  asset,
  roomWidth,
  roomDepth
) {
  const assetType =
    ventraNormalizeSchematicAssetType(
      asset
    );

  const defaults =
    VENTRA_SCHEMATIC_ASSET_DEFAULTS[
      assetType
    ] || {
      width: 0.8,
      depth: 0.8,
      height: 0.8,
    };

  const finite = (value, fallback) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const positive = (value, fallback) => {
    const number = finite(value, NaN);
    return number > 0 ? number : fallback;
  };
  const w = positive(asset.width, defaults.width);
  const d = positive(asset.depth, defaults.depth);
  const h = positive(asset.height, defaults.height);
  const rot = finite(asset.rotation, 0) * Math.PI / 180;
  const cx = finite(asset.xMeters, finite(asset.x, 0.5) * roomWidth) - roomWidth / 2;
  const cy = finite(asset.yMeters, finite(asset.y, 0.5) * roomDepth) - roomDepth / 2;

  return {
    assetType,
    defaults,
    w,
    d,
    h,
    rot,
    cx,
    cy,
    roomId:
      asset?.roomId ||
      null,
    againstWallId:
      asset?.againstWallId ||
      null,
    placementSource:
      asset?.placementSource ||
      null,
  };
}

function ventraSoftFurnitureBox(THREE,w,d,h){
 const b=Math.min(.006,w*.04,d*.04,h*.12);
 if(!THREE.Shape||!THREE.ExtrudeGeometry||b<.0004)return new THREE.BoxGeometry(w,d,h);
 try{
  const shape=new THREE.Shape(),x=w/2-b,y=d/2-b;
  shape.moveTo(-x,-y);shape.lineTo(x,-y);shape.lineTo(x,y);shape.lineTo(-x,y);shape.lineTo(-x,-y);
  const geometry=new THREE.ExtrudeGeometry(shape,{amount:h-2*b,depth:h-2*b,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2,steps:1,curveSegments:1});
  // r71 uses Geometry, newer runtimes use BufferGeometry.
  if(geometry.translate)geometry.translate(0,0,b-h/2);
  else if(geometry.vertices)for(const v of geometry.vertices)v.z+=b-h/2;
  geometry.parameters={...(geometry.parameters||{}),width:w,height:d,depth:h};
  return geometry;
 }catch{return new THREE.BoxGeometry(w,d,h);}
}

function ventraUpholsteryGeometry(THREE,w,d,h){
 const g=new THREE.BoxGeometry(w,d,h,14,12,8),r=Math.min(w*.12,d*.16,h*.42);
 const sculpt=(x,y,z)=>{
  const q=new THREE.Vector3(Math.max(-w/2+r,Math.min(w/2-r,x)),Math.max(-d/2+r,Math.min(d/2-r,y)),Math.max(-h/2+r,Math.min(h/2-r,z)));
  const delta=new THREE.Vector3(x,y,z).sub(q);if(delta.length()>0)q.add(delta.normalize().multiplyScalar(r));
  if(q.z>h*.25){
   const center=Math.max(0,1-Math.pow(q.x/(w*.5),2))*Math.max(0,1-Math.pow(q.y/(d*.5),2));
   q.z-=h*.045*center; // slight loading of a padded seat, never a rigid slab
   q.z+=h*.009*Math.sin(q.x/w*45+q.y/d*8)*Math.pow(1-center,3);
  }
  q.z=Math.max(-h/2,Math.min(h/2,q.z));return q;
 };
 if(g.vertices){for(const v of g.vertices)v.copy(sculpt(v.x,v.y,v.z));g.computeFaceNormals?.();}
 else{const a=g.attributes.position;for(let i=0;i<a.count;i++){const v=sculpt(a.getX(i),a.getY(i),a.getZ(i));a.setXYZ(i,v.x,v.y,v.z);}}
 g.computeVertexNormals();g.userData={upholstery:true};return g;
}

function ventraTextileGrid(THREE,columns,rows,point){
 const positions=[],uvs=[],indices=[];
 for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
  const u=i/columns,v=j/rows,p=point(u,v);positions.push(p.x,p.y,p.z);uvs.push(u,v);
 }
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  const a=j*(columns+1)+i,b=a+1,c=a+columns+1,d=c+1;indices.push(a,b,d,a,d,c);
 }
 let g;
 if(THREE.Geometry){
  g=new THREE.Geometry();for(let i=0;i<positions.length;i+=3)g.vertices.push(new THREE.Vector3(...positions.slice(i,i+3)));
  for(let i=0;i<indices.length;i+=3){const ids=indices.slice(i,i+3);g.faces.push(new THREE.Face3(...ids));g.faceVertexUvs[0].push(ids.map(n=>new THREE.Vector2(uvs[n*2],uvs[n*2+1])));}
  g.computeFaceNormals();g.computeVertexNormals();
 }else{
  g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
 }
 g.computeBoundingBox();g.computeBoundingSphere();g.userData={textileSurface:true};return g;
}

function ventraTextileMaterial(THREE,color,width,height,kind='fabric',variant='modern'){
 const size=kind==='rug'?512:128,data=new Uint8Array(size*size*4),relief=new Uint8Array(128*128*4);
 const chosen=new THREE.Color(color||'#c4b8a4'),base=[chosen.r,chosen.g,chosen.b].map(n=>Math.round(n*255));
 // Ornament belongs to the rug surface, rather than stacked solid blocks.
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/(size-1),v=y/(size-1),noise=((Math.imul(x+17,73856093)^Math.imul(y+31,19349663))>>>0)%101/100-.5;
  const weave=(x%3===0?-.025:.008)+(y%3===0?-.018:.008)+noise*.035;
  let rgb=kind==='rug'?base:[238,238,238];
  if(kind==='rug'&&variant.startsWith('persian')){
   const X=(u-.5)*2,Y=(v-.5)*2,edge=Math.max(Math.abs(X),Math.abs(Y)),angle=Math.atan2(Y,X),radius=Math.hypot(X,Y);
   const border=edge>.80&&edge<.96,guard=edge>.96||edge>.77&&edge<.80;
   const floral=Math.sin(26*X+2*Math.sin(18*Y))*Math.cos(24*Y+2*Math.sin(16*X));
   const medallion=radius<.28+.045*Math.cos(8*angle),petal=Math.abs(Math.sin(12*angle+radius*22));
   if(guard)rgb=base.map(n=>n*.44);
   else if(border){const repeat=Math.cos((Math.abs(X)>Math.abs(Y)?Y:X)*Math.PI*22);rgb=repeat>.25?[209,186,140]:base.map(n=>n*.65);}
   else if(medallion)rgb=petal>.82?[211,183,125]:[52,65,76];
   else if(floral>.69)rgb=[215,196,154];
   else if(floral<-.8)rgb=base.map(n=>n*.52);
  }else if(kind==='rug'&&variant==='runner'){
   const edge=Math.min(u,1-u);if(edge<.06)rgb=base.map(n=>n*.6);else if(edge<.08)rgb=base.map(n=>Math.min(255,n*1.12));
  }
  const i=(y*size+x)*4;for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,Math.round(rgb[c]*(1+weave))));data[i+3]=255;
 }
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){
  const i=(y*128+x)*4,warp=Math.sin(x*Math.PI/2),weft=Math.cos(y*Math.PI/2),n=((x*73+y*139)%37)/37;
  relief[i]=relief[i+1]=relief[i+2]=Math.round(128+warp*28+weft*20+n*12);relief[i+3]=255;
 }
 const texture=(pixels,n)=>{const t=new THREE.DataTexture(pixels,n,n,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter||THREE.LinearMipMapLinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=4;t.needsUpdate=true;return t;};
 const map=texture(data,size),bump=texture(relief,128);
 if(kind!=='rug')map.repeat.set(Math.max(1,width/.18),Math.max(1,height/.18));
 bump.repeat.set(Math.max(1,width/.12),Math.max(1,height/.12));
 const Material=THREE.MeshPhongMaterial||THREE.MeshLambertMaterial;
 const mat=new Material({color:kind==='rug'?0xffffff:color||'#c4b8a4',map,bumpMap:bump,bumpScale:.0005,shininess:2,specular:0x121212,side:THREE.DoubleSide});
 mat.userData={ventraTextile:kind,textileVariant:variant,textileColor:color,physicalWidth:width,physicalHeight:height};return mat;
}

function ventraCurtainMeshes(THREE,w,d,h,variant,color){
 if(variant==='double-layer'){const back=ventraCurtainMeshes(THREE,w,d*.65,h,'sheer','#f1eee5'),front=ventraCurtainMeshes(THREE,w,d*.65,h,'open',color);for(const m of back)m.position.y-=d*.23;for(const m of front)m.position.y+=d*.23;return [...back,...front];}
 const out=[],fabric=ventraTextileMaterial(THREE,color,w,h,'curtain',variant),metal=new THREE.MeshPhongMaterial({color:0x8d8578,shininess:95}),hem=fabric.clone();hem.color.multiplyScalar(.94);
 if(variant==='sheer'){fabric.transparent=true;fabric.opacity=.57;fabric.depthWrite=false;hem.transparent=true;hem.opacity=.7;hem.depthWrite=false;}
 const add=(g,m,x=0,y=0,z=0)=>{const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=variant!=='sheer';mesh.receiveShadow=true;out.push(mesh);return mesh;};
 const rod=add(new THREE.CylinderGeometry(.016,.016,w*.98,16),metal,0,-d*.22,h-.024);rod.rotation.z=Math.PI/2;
 const top=h-.065,bottom=.015;
 if(variant==='roman'){
  for(let i=0;i<6;i++){const section=(top-bottom)/6;add(ventraTextileGrid(THREE,32,12,(u,v)=>({x:(u-.5)*w*.98,y:Math.sin(v*Math.PI)*d*.42,z:bottom+i*section+v*section})),fabric);}
 }else if(variant==='roller'){
  add(ventraTextileGrid(THREE,20,24,(u,v)=>({x:(u-.5)*w*.98,y:Math.sin(v*Math.PI)*d*.08,z:bottom+v*(top-bottom)})),fabric);
  const rail=add(new THREE.CylinderGeometry(.013,.013,w*.98,12),metal,0,0,.02);rail.rotation.z=Math.PI/2;
 }else{
  for(const sign of [-1,1]){
   const point=(u,v)=>{
    const opening=variant==='open'?.62*Math.pow(1-v,.62):variant==='tieback'?.68*Math.exp(-(((v-.43)/.32)**2)):0;
    const inner=opening*w*.5,outer=w*.49,span=outer-inner;
    const x=sign*(inner+u*span),fold=Math.cos(u*Math.PI*(variant==='eyelet'?12:variant==='blackout'?14:16)+.15*Math.sin(v*4)),wave=Math.sin(v*7+u*4)*.025;
    const z=bottom+v*(top-bottom)+Math.pow(1-v,6)*.007*(1+Math.sin(u*Math.PI*16));
    return {x,y:fold*d*.34*(.68+.32*(1-v))+wave*d,z};
   };
   const g=ventraTextileGrid(THREE,64,32,point);g.userData={...g.userData,curtainPanel:true,variant};add(g,fabric);
   const border=ventraTextileGrid(THREE,64,2,(u,v)=>{const p=point(u,.013+v*.014);return {...p,y:p.y+.0015};});add(border,hem);
  }
  // Rings sit on the pole; two continuous cloth meshes replace 24 cuboids.
  for(let i=0;i<14;i++){
   const ring=add(new THREE.TorusGeometry(.022,.003,5,10),metal,(i/13-.5)*w*.94,-d*.22,h-.042);ring.rotation.y=Math.PI/2;
  }
 }
 return out;
}

function ventraRugMeshes(THREE,w,d,h,variant,color){
 const out=[],fabric=ventraTextileMaterial(THREE,color,w,d,'rug',variant),edge=new THREE.MeshPhongMaterial({color:color||'#b9ab94',shininess:1,side:THREE.DoubleSide});edge.color.multiplyScalar(.73);
 const top=Math.min(.024,Math.max(.009,h*.65));
 const point=(u,v)=>{
  if(variant==='round'){
   const a=u*Math.PI*2,r=v*.49;return {x:Math.cos(a)*w*r,y:Math.sin(a)*d*r,z:top+.0005*Math.sin(u*81)*Math.sin(v*47)};
  }
  let x=(u-.5)*w*.98,y=(v-.5)*d*.97;const r=Math.min(.045,w*.04,d*.04),cx=w*.49-r,cy=d*.485-r;
  if(Math.abs(x)>cx&&Math.abs(y)>cy){const dx=Math.abs(x)-cx,dy=Math.abs(y)-cy,scale=Math.min(1,r/Math.hypot(dx,dy));x=Math.sign(x)*(cx+dx*scale);y=Math.sign(y)*(cy+dy*scale);}
  return {x,y,z:top+.0006*Math.sin(u*53)*Math.sin(v*37)};
 };
 const g=ventraTextileGrid(THREE,variant==='round'?96:48,32,point);g.userData={...g.userData,rugSurface:true};
 if(variant==='round'){
  // Cartesian UVs keep a woven pattern undistorted across the circular surface.
  if(g.vertices){for(let i=0;i<g.faces.length;i++){const f=g.faces[i];g.faceVertexUvs[0][i]=[f.a,f.b,f.c].map(n=>new THREE.Vector2(g.vertices[n].x/w+.5,g.vertices[n].y/d+.5));}}
  else{const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/w+.5,p.getY(i)/d+.5);}
 }
 const surface=new THREE.Mesh(g,fabric);surface.receiveShadow=true;surface.castShadow=false;out.push(surface);
 if(variant==='round'){
  const base=new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w,d)*.49,Math.min(w,d)*.49,top*.75,64),edge);base.rotation.x=Math.PI/2;base.position.z=top*.42;out.push(base);
 }else{
  const base=new THREE.Mesh(new THREE.BoxGeometry(w*.975,d*.965,top*.7),edge);base.position.z=top*.4;out.push(base);
  if(variant.startsWith('persian')||variant==='runner'){
   // A single indexed mesh contains all short twisted fringe ribbons.
   const count=Math.min(120,Math.max(32,Math.round(w/.023))),vertices=[],triangles=[];
   for(const sign of [-1,1])for(let i=0;i<count;i++){
    const x=(i/(count-1)-.5)*w*.94,length=d*(.011+.003*Math.sin(i*2.4));
    for(let j=0;j<4;j++){const along=j<2?0:1;vertices.push({x:x+(j%2?1:-1)*.0015,y:sign*(d*.479+along*length),z:top*.65+along*.001*Math.sin(i)});}
    const n=vertices.length-4;triangles.push(n,n+1,n+3,n,n+3,n+2);
   }
   let fringe;
   if(THREE.Geometry){fringe=new THREE.Geometry();fringe.vertices=vertices.map(p=>new THREE.Vector3(p.x,p.y,p.z));for(let i=0;i<triangles.length;i+=3)fringe.faces.push(new THREE.Face3(...triangles.slice(i,i+3)));fringe.computeFaceNormals();fringe.computeVertexNormals();}
   else{fringe=new THREE.BufferGeometry();fringe.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flatMap(p=>[p.x,p.y,p.z]),3));fringe.setIndex(triangles);fringe.computeVertexNormals();}
   const yarn=new THREE.MeshPhongMaterial({color:0xd8cbb2,shininess:1,side:THREE.DoubleSide}),mesh=new THREE.Mesh(fringe,yarn);mesh.userData={rugFringe:true};out.push(mesh);
  }
 }
 return out;
}

function ventraDecorImage(THREE,kind){
 const width=256,height=144,pixels=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/width,v=y/height,i=(y*width+x)*4;
  let rgb;
  if(kind==='screen'){
   const ridge=.43+.10*Math.sin(u*12)+.06*Math.cos(u*29),foreground=.23+.08*Math.sin(u*9+2);
   rgb=v<foreground?[35,55,55]:v<ridge?[66,84,92]:[126+v*52,142+v*38,150+v*30];
   if((u-.75)**2+(v-.76)**2<.002)rgb=[222,205,165];
  }else if(kind==='gold'){
   const stem=Math.abs(u-(.5+.08*Math.sin(v*4)))<.006,leaves=Math.sin(v*34+u*12)>.65&&Math.abs(u-.5)<.14;
   rgb=stem||leaves?[75,92,69]:[224,216,192];
  }else{
   const circle=(u-.6)**2+(v-.6)**2<.055,arch=Math.abs(u-.35)<.19&&v<.65;
   rgb=circle?[183,126,87]:arch?[113,132,120]:[218,208,186];
  }
  for(let c=0;c<3;c++)pixels[i+c]=rgb[c];pixels[i+3]=255;
 }
 const t=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);t.needsUpdate=true;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter||THREE.LinearMipMapLinearFilter;t.magFilter=THREE.LinearFilter;return t;
}

function ventraPictureFrames(THREE,w,d,h,variant,color){
 const parts=[],frame=new THREE.MeshPhongMaterial({color,shininess:variant==='gold'?65:12}),paper=new THREE.MeshPhongMaterial({color:0xeee9dd,shininess:1}),art=new THREE.MeshBasicMaterial({map:ventraDecorImage(THREE,variant),color:0xffffff,side:THREE.DoubleSide});
 const add=(width,depth,height,x,y,z,material)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(width,depth,height),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parts.push(m);};
 paper.userData={protectedFinish:true};
 const count=variant==='triptych'?3:1,each=w/(count===3?3.25:1),edge=Math.min(.035,each*.06);
 for(let i=0;i<count;i++){
  const x=(i-(count-1)/2)*w/count;
  add(each,d*.4,h,x,0,h/2,frame);
  add(each-edge*2,d*.15,h-edge*2,x,d*.25,h/2,paper);
  const artwork=new THREE.Mesh(new THREE.PlaneGeometry(each*.76,h*.76),art);artwork.rotation.x=Math.PI/2;artwork.position.set(x,d*.36,h/2);parts.push(artwork);
  for(const sign of [-1,1]){add(edge,d,h, x+sign*(each-edge)/2,0,h/2,frame);add(each,d,edge,x,0,sign===1?h-edge/2:edge/2,frame);}
 }
 return parts;
}

function ventraTelevisionMeshes(THREE,w,d,h,variant,color){
 const parts=[],body=new THREE.MeshPhongMaterial({color:0x14191d,shininess:65,specular:0x55595d}),wood=new THREE.MeshPhongMaterial({color,shininess:15}),trim=new THREE.MeshPhongMaterial({color:0x222b31,shininess:95}),screen=new THREE.MeshBasicMaterial({color:0xc3cbd1,side:THREE.DoubleSide,map:ventraDecorImage(THREE,'screen')});
 const add=(width,depth,height,x,y,z,material=body)=>{const m=new THREE.Mesh(ventraSoftFurnitureBox(THREE,width,depth,height),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parts.push(m);return m;};
 const wall=variant==='wall-mounted',media=variant==='media-wall',pedestal=variant==='pedestal';
 const consoleH=wall?0:pedestal?.08:Math.min(.45,h*.34);
 if(media){
  add(w,d*.16,h,0,-d*.4,h/2,wood);
  for(let i=0;i<18;i++)add(w*.017,d*.06,h*.98,(i/17-.5)*w*.94,-d*.29,h/2,trim);
 }
 if(!wall&&!pedestal){
  add(w,d*.88,consoleH,0,0,consoleH/2,wood);
  for(const x of [-.25,.25]){add(w*.44,.018,consoleH*.82,x*w,d*.45,consoleH*.5,wood);add(w*.1,.016,.012,x*w,d*.46,consoleH*.69,trim);}
  for(const x of [-.4,.4])add(.035,d*.7,.06,x*w,0,.03,trim);
 }
 const sw=Math.min(w*(media?.78:.94),(h-consoleH-.10)*16/9),sh=sw*9/16,center=wall?h*.5:media?h*.66:pedestal?h-sh/2-.02:consoleH+.08+sh/2;
 const backY=media?-d*.13:wall?0:-d*.07;
 if(pedestal){add(w*.34,d*.8,.035,0,0,.02,trim);add(.035,.045,Math.max(.04,center-sh/2),0,backY,(center-sh/2)/2,trim);}
 else if(!wall&&!media)for(const x of [-.31,.31])add(.025,d*.36,.08,x*sw,backY,consoleH+.04,trim);
 add(sw,Math.min(.04,d*.65),sh,0,backY,center);
 const display=new THREE.Mesh(new THREE.PlaneGeometry(sw*.976,sh*.965),screen);display.rotation.x=Math.PI/2;display.position.set(0,backY+Math.min(.04,d*.65)/2+.001,center);display.userData={televisionScreen:true};parts.push(display);
 const led=new THREE.Mesh(new THREE.SphereGeometry(.002,6,4),new THREE.MeshBasicMaterial({color:0xaad6df}));led.position.set(sw*.42,display.position.y,center-sh*.485);parts.push(led);
 return parts;
}

function buildSchematicAssetMeshes({ THREE, asset, palette, roomWidth, roomDepth }) {
  const meshes = [];
  const base=asset.renderingBaseDimensions;
  const ratios=base?['width','depth','height'].map(key=>asset[key]/base[key]):[];
  const objectScale=!["kitchen_counter","kitchen_island","refrigerator","stove","sink"].includes(ventraNormalizeSchematicAssetType(asset))&&ratios.length&&ratios.every(n=>Number.isFinite(n)&&n>0&&Math.abs(n-ratios[0])<.000001)?ratios[0]:1;
  const renderAsset=base&&objectScale!==1?{...asset,...base}:asset;
  const placement = ventraResolveSchematicAssetPlacement(renderAsset, roomWidth, roomDepth);
  const {w,d,h,rot,cx,cy}=placement;const assetType=asset.customModelId?'personal_model':placement.assetType;
  const interactiveKitchen = ['kitchen_counter', 'kitchen_island', 'refrigerator', 'stove'].includes(assetType)
    || (assetType === 'sink' && (asset.embeddedInCounter || asset.variant === 'kitchen'));
  // Tiny, deterministic surface grain adds material depth without a network asset.
  // Textures belong to this asset and are released with its mesh materials.
  const surfaceTexture = (kind) => {
    if (typeof document === 'undefined' || !THREE.Texture) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) return null;
      // Seeded, seamless grayscale surfaces preserve the material tint.
      // Geometry, dimensions and transforms are untouched.
      const pixels = context.createImageData(256, 256);
      let seed = 1729;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = seed / 4294967296 - 0.5;
        const wave = Math.sin(2 * Math.PI * y / 256);
        const grain = Math.sin(2 * Math.PI * (x * 13 / 256 + 0.28 * wave));
        const value = kind === 'wood'
          ? 240 + Math.sin(2 * Math.PI * (x * 79 / 256 + 0.28 * wave)) * 6 + Math.sin(2 * Math.PI * (x * 173 / 256 + 0.15 * wave)) * 2 + noise * 3
          : kind === 'fabric'
            ? 242 + ((x % 4 < 2) !== (y % 4 < 2) ? 4 : -4) + noise * 5
            : 246 + noise * 6 + Math.sin(2 * Math.PI * (x + y) / 256) * 2;
        const index = (y * 256 + x) * 4;
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const texture = new THREE.Texture(canvas);
      texture.needsUpdate = true;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipMapLinearFilter || THREE.LinearMipmapLinearFilter || THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 4;
      texture.repeat.set(kind === 'fabric' ? 8 : 1, kind === 'fabric' ? 8 : 1);
      return texture;
    } catch { return null; }
  };
  const designVariant=asset.variant||palette.designPreset||'classic';
  const upholstery = assetType === 'sofa' || assetType === 'armchair';
  const finish = (kind) => {
    const map = surfaceTexture(kind);
    return map ? {map,bumpMap:map,bumpScale:kind==='fabric'?.0005:kind==='wood'?.0012:.00035} : {};
  };
  const OpaqueMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const GlassMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const accent = upholstery ? ventraTextileMaterial(THREE,asset?.color||palette?.upholstery||'#b8afa2',w,d) : new OpaqueMaterial({
    color: hexNumber(asset?.color || (upholstery ? palette?.upholstery : palette?.furniture || palette?.accent), upholstery ? 0xb8afa2 : 0x815a3f),
    side: THREE.DoubleSide,
    shininess: upholstery ? 5 : 36,
    specular: upholstery ? 0x121212 : 0x302b25,
    ...finish(upholstery ? 'fabric' : 'wood'),
  });
  const light = upholstery ? ventraTextileMaterial(THREE,asset?.color||palette?.upholstery||'#d9d0c4',w,d) : new OpaqueMaterial({ color: hexNumber(asset?.color || palette?.upholstery, 0xd9d0c4), side: THREE.DoubleSide, shininess: ['cabinet','wardrobe','kitchen_counter','dining_table','desk'].includes(assetType) ? 20 : 3, specular: 0x222222, ...finish(['cabinet','wardrobe','kitchen_counter','dining_table','desk'].includes(assetType) ? 'wood' : 'fabric') });
  const white = new OpaqueMaterial({ color: hexNumber(asset?.color, 0xe8e2da), side: THREE.DoubleSide, shininess: 38, specular: 0x444444, ...finish('stone') });
  const dark = new OpaqueMaterial({ color: 0x4d433b, side: THREE.DoubleSide, shininess: 9 });
  const sage = new OpaqueMaterial({ color: hexNumber(palette?.textileAccent, 0x8e9b78), side: THREE.DoubleSide, shininess: 3, ...finish('fabric') });
  const rugMat = new OpaqueMaterial({ color: 0xc7bbaa, side: THREE.DoubleSide, shininess: 1, ...finish('fabric') });
  const leafMat = new OpaqueMaterial({ color: 0x6f805c, side: THREE.DoubleSide, shininess: 4 });
  const potMat = new OpaqueMaterial({ color: 0x8f7358, side: THREE.DoubleSide, shininess: 6 });
  const glass = new GlassMaterial({ color: hexNumber(palette?.glass, 0x8fb6cc), transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, shininess: 80 });
  const metal = new OpaqueMaterial({ color: hexNumber(palette?.metal, 0x817a72), side: THREE.DoubleSide, shininess: 110, specular:0xb8b6b1 });

  const applyPresentationFinish = (mat, kind) => {
    if (!THREE.MeshPhysicalMaterial) return mat;
    const replacement = new THREE.MeshPhysicalMaterial({
      color: mat.color, side: mat.side, map: mat.map, bumpMap: mat.bumpMap,
      bumpScale: mat.bumpScale, ...presentationFinish(kind),
    });
    mat.dispose();
    return replacement;
  };
  const kitchenWood = interactiveKitchen ? applyPresentationFinish(new OpaqueMaterial({
    color: accent.color, side: accent.side, ...finish("wood"),
  }), "satinWood") : accent;
  const kitchenStone = interactiveKitchen ? applyPresentationFinish(new OpaqueMaterial({
    color: white.color, side: white.side, ...finish("stone"),
  }), "polishedStone") : white;

  const rotateOffset = (ox, oy) => ({
    x: ox * Math.cos(rot) - oy * Math.sin(rot),
    y: ox * Math.sin(rot) + oy * Math.cos(rot),
  });

  const addBox = (bw, bd, bh, ox = 0, oy = 0, oz = bh / 2, material = accent) => {
    const mesh = new THREE.Mesh(ventraSoftFurnitureBox(THREE,bw,bd,bh), material);
    const shifted = rotateOffset(ox, oy);
    mesh.position.set(cx + shifted.x, cy + shifted.y, oz + (Number(asset.zMeters) || 0));
    mesh.rotation.z = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    return mesh;
  };

  // Rounded rectangle extruded along Z: an actual cushion silhouette, including
  // rounded plan corners and a narrow softened upper/lower edge in legacy r71.
  const addCushion = (bw, bd, bh, ox, oy, oz, material = light) => {
    const geometry = ventraUpholsteryGeometry(THREE,bw,bd,bh);
    const mesh = new THREE.Mesh(geometry, material);
    const shifted = rotateOffset(ox, oy);
    mesh.position.set(cx + shifted.x, cy + shifted.y, oz + (Number(asset.zMeters)||0));
    mesh.rotation.z = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    const radius=Math.min(.002,bh*.025);
    const piping=ventraTextileGrid(THREE,72,4,(u,v)=>{
      const a=u*Math.PI*2,c=Math.cos(a),s=Math.sin(a),x=Math.sign(c)*Math.pow(Math.abs(c),.32)*(bw/2-radius*2),y=Math.sign(s)*Math.pow(Math.abs(s),.32)*(bd/2-radius*2),length=Math.hypot(c,s)||1;
      return {x:x+c/length*Math.cos(v*Math.PI*2)*radius,y:y+s/length*Math.cos(v*Math.PI*2)*radius,z:bh*.15+Math.sin(v*Math.PI*2)*radius};
    });
    const seam=new THREE.Mesh(piping,material);seam.position.copy(mesh.position);seam.rotation.copy(mesh.rotation);seam.castShadow=true;seam.receiveShadow=true;seam.userData={upholsterySeam:true};meshes.push(seam);
    return mesh;
  };

  const addCylinder = (radius, length, ox, oy, oz, material = metal, horizontal = false) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 18), material);
    const shifted = rotateOffset(ox, oy);
    mesh.position.set(cx + shifted.x, cy + shifted.y, oz);
    if (!horizontal) mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    return mesh;
  };

  const traditionalSeat=()=>{
    addBox(w*.93,d*.82,h*.1,0,0,h*.19,dark);
    addCushion(w*.8,d*.68,h*.19,0,d*.06,h*.36,accent);
    addCushion(w*.79,d*.15,h*.46,0,-d*.37,h*.65,accent);
    for(const sign of [-1,1]){
      addBox(w*.045,d*.77,h*.09,sign*w*.45,0,h*.53,dark);
      addCushion(w*.09,d*.7,h*.15,sign*w*.43,0,h*.57,accent);
      for(const y of [-.3,.3])addBox(w*.035,d*.035,h*.19,sign*w*.39,d*y,h*.095,dark);
    }
    // Exposed wooden arched crest gives the classic set its own silhouette.
    for(let i=0;i<13;i++){const x=(i/12-.5)*w*.88,z=h*(.88+.085*Math.cos(x/w*Math.PI*2));addBox(w*.075,d*.055,h*.035,x,-d*.39,z,dark);}
    for(const x of [-.28,0,.28])addCylinder(.012,h*.009,w*x,-d*.29,h*.73,metal,true);
  };
  const comfortSeat=()=>{
    addBox(w*.94,d*.86,h*.18,0,0,h*.15,dark);
    for(const x of (w>1.3?[-.23,.23]:[0])){
      addCushion(w*(w>1.3?.43:.76),d*.69,h*.24,w*x,d*.08,h*.36,accent);
      addCushion(w*(w>1.3?.43:.76),d*.22,h*.51,w*x,-d*.32,h*.67,accent);
    }
    for(const x of [-1,1])addCushion(w*.12,d*.79,h*.41,x*w*.43,0,h*.43,accent);
  };

  switch (assetType) {
    case 'picture_frame': {
      for(const mesh of ventraPictureFrames(THREE,w,d,h,designVariant,asset.color||'#af8457')){const shift=rotateOffset(mesh.position.x,mesh.position.y);mesh.position.set(cx+shift.x,cy+shift.y,mesh.position.z+(Number(asset.zMeters)||0));mesh.rotation.z+=rot;meshes.push(mesh);}break;
    }
    case 'personal_model' : {const m=new THREE.MeshBasicMaterial({color:0x9ca3af,wireframe:true});addBox(w,d,h,0,0,h/2,m);break;}

    case 'curtain': {
      for(const mesh of ventraCurtainMeshes(THREE,w,d,h,designVariant,asset.color||'#c5b8a4')){
        const shift=rotateOffset(mesh.position.x,mesh.position.y);mesh.position.set(cx+shift.x,cy+shift.y,mesh.position.z+(Number(asset.zMeters)||0));mesh.rotation.z+=rot;meshes.push(mesh);
      }
      break;
    }
    case 'sofa': {
      if(designVariant==='traditional'){traditionalSeat();break;}
      if(designVariant==='comfort'){comfortSeat();break;}
      if(designVariant==='minimal'){
        addBox(w*.94,d*.85,h*.11,0,0,h*.22,dark);
        for(const x of [-.22,.22]){
          addCushion(w*.43,d*.67,h*.17,w*x,d*.07,h*.4,accent);
          addCushion(w*.43,d*.13,h*.44,w*x,-d*.36,h*.72,accent);
        }
        for(const x of [-1,1]){
          addCushion(w*.035,d*.77,h*.36,x*w*.47,0,h*.47,accent);
          for(const y of [-.3,.3])addBox(.025,.025,h*.16,x*w*.4,y*d,h*.08,metal);
        }
        break;
      }
      if(designVariant==='bench'){addCushion(w,d*.9,.18,0,0,.4,accent);for(const x of [-.4,.4])for(const y of [-.35,.35])addBox(.05,.05,.32,w*x,d*y,.16,dark);break;}
      if(designVariant.startsWith('sectional-')){
        const side=designVariant==='sectional-left'?-1:1;
        addBox(w*.96,d*.98,.15,0,0,.13,dark);
        addCushion(w*.94,d*.47,.22,0,-d*.2,.32,accent);
        addCushion(w*.3,d*.5,.22,side*w*.32,d*.24,.32,accent);
        addCushion(w*.94,d*.12,.4,0,-d*.43,.64,accent);
        for(const x of [-1,1])addCushion(w*.06,d*.48,.38,x*w*.46,-d*.18,.5,accent);
        break;
      }
      addBox(w * 0.94, d * 0.82, 0.13, 0, 0.03 * d, 0.15, dark);
      addCushion(w * 0.88, d * 0.64, 0.19, 0, 0.08 * d, 0.30, accent);
      addCushion(w * 0.88, d * 0.16, 0.55, 0, -d * 0.39, 0.51, accent);
      for (const sx of [-1, 1]) {
        addCushion(w * 0.09, d * 0.66, 0.39, sx * w * 0.43, d * 0.05, 0.43, accent);
        addBox(w * 0.035, d * 0.035, 0.12, sx * w * 0.38, d * 0.32, 0.06, dark);
      }
      for (const offset of (designVariant==='minimal'?[0]:[-0.27, 0, 0.27])) {
        addCushion(w * 0.26, d * 0.46, 0.09, w * offset, d * 0.09, 0.43, offset < 0 ? sage : light);
        addCushion(w * 0.25, d * 0.11, 0.25, w * offset, -d * 0.27, 0.53, light);
      }
      if(designVariant==='luxury'){for(const sx of [-1,1])addBox(w*.02,d*.78,.12,sx*w*.43,0,.08,metal);for(const x of [-.3,-.1,.1,.3])addCylinder(.025,.02,w*x,-d*.39,.69,metal,false);}
      break;
    }
    case 'rug': {
      for(const mesh of ventraRugMeshes(THREE,w,d,h,designVariant,asset.color||'#b9aa94')){
        const shift=rotateOffset(mesh.position.x,mesh.position.y);mesh.position.set(cx+shift.x,cy+shift.y,mesh.position.z+(Number(asset.zMeters)||0));mesh.rotation.z+=rot;meshes.push(mesh);
      }
      break;
    }
    case 'plant': {
      const potH=Math.min(.32,h*.26),radius=Math.min(w,d)*.20;
      addCylinder(radius,potH,0,0,potH/2,potMat,false);
      addCylinder(radius*.92,.018,0,0,potH,dark,false);
      addCylinder(Math.min(.012,radius*.07),h*.66,0,0,potH+h*.33,leafMat,false);
      for(let i=0;i<36;i++){
        const angle=i*2.399963,reach=Math.min(w,d)*(.13+(i%3)*.035),length=Math.min(Math.min(w,d)*.30,h*.18);
        const geometry=new THREE.SphereGeometry(1,10,6);
        if(geometry.vertices){for(const v of geometry.vertices){v.x*=length;v.y*=length*.40;v.z*=length*.065;}geometry.computeFaceNormals?.();geometry.computeVertexNormals?.();}
        else geometry.scale?.(length,length*.40,length*.065);
        const leaf=new THREE.Mesh(geometry,leafMat),shift=rotateOffset(Math.cos(angle)*reach,Math.sin(angle)*reach);
        leaf.position.set(cx+shift.x,cy+shift.y,potH+(h-potH)*(.23+i*.019));
        leaf.rotation.set(0,(i%2?.22:-.16),angle+rot);leaf.castShadow=true;leaf.receiveShadow=true;
        meshes.push(leaf);
      }
      break;
    }
    case 'flower_pot': {
      addCylinder(Math.min(w, d) * 0.20, 0.28, 0, 0, 0.14, potMat, false);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.33, 14, 10), leafMat);
      crown.position.set(cx, cy, Math.max(0.55, h * 0.64));
      meshes.push(crown);
      if (assetType === 'flower_pot') {
        for (const [x,y] of [[0,0],[w*.2,0],[-w*.2,d*.15],[0,-d*.2]]) {
          const flower = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w,d)*.12,12,8), accent);
          const shifted=rotateOffset(x,y);flower.position.set(cx+shifted.x,cy+shifted.y,h*.9);meshes.push(flower);
        }
      }
      for (const [ox, oy, oz] of [
        [0.12,0.00,0.66],[-0.10,0.05,0.72],[0.02,0.11,0.78],[0.00,-0.11,0.70]
      ]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.18, 12, 8), leafMat);
        const shifted = rotateOffset(ox, oy);
        leaf.position.set(cx + shifted.x, cy + shifted.y, Math.max(0.45, h * oz));
        meshes.push(leaf);
      }
      break;
    }
    case 'armchair': {
      if(designVariant==='traditional'){traditionalSeat();break;}
      if(designVariant==='comfort'){comfortSeat();break;}
      addBox(w * 0.82, d * 0.74, 0.13, 0, 0.04 * d, 0.14, dark);
      addCushion(w * 0.76, d * 0.61, 0.17, 0, 0.06 * d, 0.31, light);
      addCushion(w * 0.76, d * 0.16, 0.55, 0, -d * 0.38, 0.50, accent);
      addCushion(w * 0.10, d * 0.69, 0.42, -w * 0.40, 0, 0.41, accent);
      addCushion(w * 0.10, d * 0.69, 0.42, w * 0.40, 0, 0.41, accent);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.045, 0.045, 0.08, sx * w * 0.30, sy * d * 0.26, 0.04, dark);
      break;
    }
    case 'bed': {
      addBox(w, d, 0.20, 0, 0, 0.10, accent);
      addCushion(w * 0.91, d * 0.88, 0.24, 0, 0.01 * d, 0.32, white);
      addBox(w, 0.11, Math.min(h, 1.05), 0, -d * 0.47, Math.min(h, 1.05) / 2, designVariant==='luxury'?light:accent);
      if(designVariant==='luxury')for(const x of [-.32,-.16,0,.16,.32])addBox(w*.02,.035,Math.min(h,.9),w*x,-d*.40,Math.min(h,.9)/2,metal);
      addCushion(w * 0.30, d * 0.17, 0.11, -w * 0.19, -d * 0.29, 0.50, white);
      addCushion(w * 0.30, d * 0.17, 0.11,  w * 0.19, -d * 0.29, 0.50, white);
      if(THREE.Geometry&&THREE.Face3){
        const geometry=new THREE.Geometry(),nx=16,ny=20;
        for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
          const x=(i/nx-.5)*w*.88,y=(j/ny-.5)*d*.50+d*.16;
          const edge=Math.pow(Math.abs(i/nx-.5)*2,8);
          const z=.478+.012*Math.sin(i*.8+j*.32)+.008*Math.cos(j*.75)-edge*.055;
          geometry.vertices.push(new THREE.Vector3(x,y,z));
        }
        for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
          const a=j*(nx+1)+i,b=a+1,c=a+nx+1,e=c+1;
          geometry.faces.push(new THREE.Face3(a,b,e),new THREE.Face3(a,e,c));
        }
        geometry.computeFaceNormals();geometry.computeVertexNormals();
        ventraApplyFloorMaterialUVs(THREE,geometry);
        const blanket=new THREE.Mesh(geometry,sage);blanket.position.set(cx,cy,0);blanket.rotation.z=rot;
        blanket.castShadow=blanket.receiveShadow=true;blanket.userData={ventraComponent:'bed_fabric'};meshes.push(blanket);
      }else addCushion(w*.88,d*.5,.035,0,d*.16,.478,sage);
      addBox(w * 0.88, d * 0.05, 0.07, 0, d * 0.45, 0.07, dark);
      break;
    }
    case 'dressing_table': {
      addBox(w, d, 0.06, 0, 0, 0.75, accent);
      addBox(w * 0.92, d * 0.9, 0.16, 0, 0, 0.64, light);
      for(const sx of [-1,1]) addBox(0.045,d * 0.8,0.6,sx*w*0.43,0,0.30,dark);
      addBox(w * 0.8,0.035,0.7,0,-d*0.43,1.18,accent);
      // Opaque silver inset: a mirror surface, not a simulated reflection.
      addBox(w * 0.72,0.018,0.62,0,-d*0.38,1.18,metal);
      break;
    }
    case 'dining_table':
    case 'desk': {
      if (designVariant === 'round') {
        addCylinder(Math.min(w,d)/2,.08,0,0,Math.min(h,.76),accent,false);
        addCylinder(Math.min(w,d)*.13,Math.min(h,.72),0,0,Math.min(h,.72)/2,dark,false);
        addCylinder(Math.min(w,d)*.32,.045,0,0,.025,dark,false);
        break;
      }
      addBox(w, d, 0.08, 0, 0, Math.min(h, 0.76), accent);
      addBox(w * 0.86, d * 0.82, 0.035, 0, 0, Math.min(h, 0.76) + 0.055, light);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.08, 0.08, Math.min(h, 0.72), sx * w * 0.34, sy * d * 0.28, Math.min(h, 0.72) / 2, dark);
      break;
    }
    case 'coffee_table': {
      if(designVariant==='luxury'){const radius=Math.min(w,d)*.46;addCylinder(radius,.06,0,0,.41,white,false);addCylinder(radius*.65,.36,0,0,.19,metal,false);break;}
      if(designVariant==='minimal'){addBox(w*.95,d*.95,.05,0,0,.37,accent);for(const x of [-1,1])addBox(w*.04,d*.75,.34,x*w*.35,0,.17,accent);break;}
      addBox(w, d, 0.07, 0, 0, 0.34, accent);
      addBox(w * 0.94, d * 0.88, 0.03, 0, 0, 0.39, glass);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.05, 0.05, 0.30, sx * w * 0.34, sy * d * 0.26, 0.15, dark);
      break;
    }
    case 'chair': {
      addBox(w * 0.92, d * 0.92, 0.08, 0, 0, 0.46, accent);
      addBox(w * 0.88, 0.08, 0.50, 0, -d * 0.40, 0.69, accent);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.04, 0.04, 0.44, sx * w * 0.30, sy * d * 0.30, 0.22, dark);
      break;
    }
    case 'wardrobe': {
      addBox(w, d, h, 0, 0, h / 2, accent);
      addBox(w * 0.47, d * 0.03, h * 0.84, -w * 0.24, -d * 0.50, h * 0.52, light);
      addBox(w * 0.47, d * 0.03, h * 0.84, w * 0.24, -d * 0.50, h * 0.52, light);
      addCylinder(0.012, Math.min(0.16, h * 0.25), -w * 0.04, -d * 0.53, h * 0.53, metal);
      addCylinder(0.012, Math.min(0.16, h * 0.25), w * 0.04, -d * 0.53, h * 0.53, metal);
      break;
    }
    case 'cabinet_door': {
      addBox(w,d,h,0,0,h/2,accent);
      addBox(w*.8,.012,h*.8,0,-d/2,h/2,light);
      addBox(.02,.03,h*.2,w*.35,-d/2-.01,h*.5,metal);
      break;
    }
    case 'tv_unit': {
      for(const mesh of ventraTelevisionMeshes(THREE,w,d,h,designVariant,asset.color||'#947050')){const shift=rotateOffset(mesh.position.x,mesh.position.y);mesh.position.set(cx+shift.x,cy+shift.y,mesh.position.z+(Number(asset.zMeters)||0));mesh.rotation.z+=rot;meshes.push(mesh);}break;
    }
    case 'cabinet': {
      addBox(w, d, Math.min(h, assetType === 'tv_unit' ? 0.52 : h), 0, 0, Math.min(h, assetType === 'tv_unit' ? 0.52 : h) / 2, accent);
      addBox(w * 0.42, d * 0.04, Math.min(h * 0.78, 0.32), -w * 0.24, -d * 0.52, Math.min(h * 0.78, 0.32) * 0.72, light);
      addBox(w * 0.42, d * 0.04, Math.min(h * 0.78, 0.32), w * 0.24, -d * 0.52, Math.min(h * 0.78, 0.32) * 0.72, light);
      if (assetType === 'tv_unit') {
        const screenWidth = w * 0.94;
        const screenHeight = screenWidth * 9 / 16;
        const consoleTop = Math.min(h, 0.52);
        addBox(w * 0.28, d * 0.50, 0.025, 0, 0, consoleTop + 0.025, dark);
        addBox(0.035, 0.035, 0.13, 0, 0, consoleTop + 0.09, dark);
        addBox(screenWidth, 0.035, screenHeight, 0, 0, consoleTop + 0.15 + screenHeight / 2, dark);
        addBox(screenWidth * 0.95, 0.009, screenHeight * 0.93, 0, d > 0 ? -0.023 : 0, consoleTop + 0.15 + screenHeight / 2,
          new OpaqueMaterial({color:0x253845,emissive:0x080d13,shininess:65,side:THREE.DoubleSide}));
      }
      break;
    }
    case 'range_hood': {
      addBox(w,d,h*.24,0,0,h*.12,metal);
      addBox(w*.35,d*.45,h*.76,0,d*.2,h*.62,metal);
      addBox(w*.65,d*.55,.012,0,0,.012,dark);
      break;
    }
    case 'kitchen_counter': {
      buildKitchenStorage({type:assetType,variant:designVariant,w,d,h,rot,cx,cy,meshes,addBox,
        wood:kitchenWood,liner:dark,stone:kitchenStone,metal});
      break;
    }
    case 'kitchen_island': {
      buildKitchenStorage({type:assetType,variant:designVariant,w,d,h,rot,cx,cy,meshes,addBox,
        wood:kitchenWood,liner:dark,stone:kitchenStone,metal});
      break;
    }
    case 'floor_lamp': {
      addCylinder(Math.min(w,d)*.46, .045, 0, 0, .025, metal, false);
      addCylinder(.014, h*.78, 0, 0, h*.4, metal, false);
      addCylinder(Math.min(w,d)*.4, h*.2, 0, 0, h*.88, light, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 8), new OpaqueMaterial({color:0xffe7b0,emissive:0x665020}));
      bulb.position.set(cx,cy,h*.86); meshes.push(bulb);
      break;
    }
    case 'nightstand': {
      const nh = Math.min(h, 0.52);
      addBox(w, d, nh, 0, 0, nh / 2, accent);
      addBox(w * 0.88, d * 0.03, 0.12, 0, -d * 0.50, nh * 0.68, light);
      addCylinder(0.025, 0.22, 0, 0, nh + 0.11, metal);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 0.18, 16), light);
      shade.position.set(cx, cy, nh + 0.31);
      shade.rotation.x = Math.PI / 2;
      shade.castShadow = true;
      meshes.push(shade);
      break;
    }
    case 'freezer':
    case 'refrigerator': {
      if(interactiveKitchen && assetType==='refrigerator'){
        const stainless = new OpaqueMaterial({color:0xa5a6a5,side:THREE.DoubleSide,shininess:125,
          specular:0xbcbcb8, ...finish('metal')});
        buildKitchenFridge({w,d,h,rot,cx,cy,meshes,addBox,steel:applyPresentationFinish(stainless,"brushedSteel"),liner:light,dark});
        break;
      }
      addBox(w, d, h, 0, 0, h / 2, light);
      addBox(w * 0.03, d * 0.05, h * 0.34, w * 0.33, -d * 0.52, h * 0.60, metal);
      addBox(w * 0.84, d * 0.02, 0.02, 0, -d * 0.515, h * 0.36, metal);
      break;
    }
    case 'stove': {
      const top = asset?.embeddedInCounter ? 0.93 : Math.min(h, 0.88);
      if (!asset?.embeddedInCounter) addBox(w, d, top, 0, 0, top / 2, accent);
      addBox(w * 0.95, d * 0.95, 0.035, 0, 0, top + 0.025, dark);
      for (const sx of [-0.23, 0.23]) for (const sy of [-0.22, 0.22]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.10, Math.min(w, d) * 0.10, 0.02, 18), dark);
        const shifted = rotateOffset(sx * w, sy * d);
        burner.position.set(cx + shifted.x, cy + shifted.y, top + 0.06);
        burner.rotation.x = Math.PI / 2;
        burner.rotation.z = rot;
        meshes.push(burner);
        if (interactiveKitchen) {
          const radius = Math.min(w, d) * 0.097;
          const glow = new THREE.Mesh(new THREE.RingGeometry(radius * 0.69, radius, 32),
            new THREE.MeshBasicMaterial({color:0xff4819,side:THREE.DoubleSide}));
          glow.position.copy(burner.position);
          glow.position.z += 0.012;
          meshes.push(glow);
          glow.visible=false;
          glow.castShadow=false;
          bindKitchenSwitch(burner, glow);
        }
      }
      break;
    }
    case 'sink': {
      const vanityH = asset?.embeddedInCounter ? 0.90 : Math.min(h, 0.82);

      if (interactiveKitchen) {
        const rim = vanityH + 0.057;
        const width = w * 0.62;
        const depth = d * 0.53;
        const base = rim - Math.min(0.16, d * 0.27);
        const lip = Math.min(w, d) * 0.045;
        if (!asset.embeddedInCounter) {
          addBox(w, d, base, 0, 0, base / 2, accent);
          const side = (w - width) / 2;
          const end = (d - depth) / 2;
          for (const sign of [-1, 1]) {
            addBox(side, d, rim - base, sign * (w + width) / 4, 0, (rim + base) / 2, kitchenStone);
            addBox(width, end, rim - base, 0, sign * (d + depth) / 4, (rim + base) / 2, kitchenStone);
          }
        }
        const basinFloor = asset.embeddedInCounter ? rim - 0.01 : base + 0.009;
        addBox(width, depth, 0.015, 0, 0, basinFloor, dark);
        for (const sign of [-1, 1]) {
          addBox(lip, depth + lip, 0.013, sign * width / 2, 0, rim, metal);
          addBox(width, lip, 0.013, 0, sign * depth / 2, rim, metal);
        }
        const chrome = applyPresentationFinish(new OpaqueMaterial({
          color:0xc0c2c1,shininess:125,specular:0xbbbbbb,
        }),"chrome");
        buildKitchenFaucet({
          THREE, meshes, addBox, rim, basinFloor, depth:d, chrome, dark,
          project(ox, oy, oz) {
            const point = rotateOffset(ox, oy);
            return new THREE.Vector3(cx + point.x, cy + point.y, oz + (Number(asset.zMeters) || 0));
          },
        });
        break;
      }

      if (!asset?.embeddedInCounter) addBox(w, d, vanityH, 0, 0, vanityH / 2, accent);

      addBox(
        w * 0.96,
        d * 0.94,
        asset?.embeddedInCounter ? 0.025 : 0.07,
        0,
        0,
        vanityH + (asset?.embeddedInCounter ? 0.045 : 0.035),
        white
      );

      addBox(
        w * 0.62,
        d * 0.52,
        0.055,
        0,
        -d * 0.02,
        vanityH +
          0.075,
        dark
      );

      addCylinder(
        0.022,
        0.28,
        0,
        -d * 0.20,
        vanityH +
          0.20,
        metal
      );

      break;
    }
    case 'bathtub': {
      addBox(
        w,
        d,
        0.50,
        0,
        0,
        0.25,
        white
      );

      addBox(
        w * 0.82,
        d * 0.68,
        0.16,
        0,
        0,
        0.43,
        glass
      );

      addCylinder(
        0.018,
        0.30,
        w * 0.34,
        -d * 0.30,
        0.62,
        metal
      );

      break;
    }
    case 'shower': {
      addBox(w, d, 0.05, 0, 0, 0.025, white);
      addBox(0.028, d, Math.min(h, 2.1), -w / 2, 0, Math.min(h, 2.1) / 2, glass);
      addBox(w, 0.028, Math.min(h, 2.1), 0, -d / 2, Math.min(h, 2.1) / 2, glass);
      addCylinder(0.018, Math.min(h, 2), w * 0.36, d * 0.36, Math.min(h, 2) / 2, metal);
      break;
    }
    case 'toilet': {
      addBox(w * 0.68, d * 0.44, 0.26, 0, d * 0.14, 0.13, white);
      addBox(w * 0.72, d * 0.20, 0.44, 0, -d * 0.22, 0.34, white);
      addBox(w * 0.36, d * 0.24, 0.08, 0, d * 0.02, 0.28, light);
      break;
    }
    case 'washing_machine': {
      addBox(w,d,h,0,0,h/2,white);
      const radius=Math.min(w,h)*.22;
      const front=(geometry,mat,z)=>{
        const mesh=new THREE.Mesh(geometry,mat),shift=rotateOffset(0,-d*.515);
        mesh.position.set(cx+shift.x,cy+shift.y,z);mesh.rotation.z=rot;mesh.rotation.x=Math.PI/2;mesh.castShadow=true;meshes.push(mesh);
      };
      if(THREE.TorusGeometry)front(new THREE.TorusGeometry(radius,.022,8,32),metal,h*.52);
      front(new THREE.CircleGeometry(radius*.88,32),dark,h*.52);
      addBox(w*.94,.018,h*.10,0,-d*.51,h*.88,light);
      addCylinder(w*.045,.035,-w*.28,-d*.54,h*.88,metal,true);
      addBox(w*.25,.012,h*.045,w*.16,-d*.535,h*.88,dark);
      break;
    }
    case 'mirror': {
      const mirrorW =
        Math.max(
          0.55,
          w
        );

      const mirrorH =
        Math.max(
          0.75,
          h
        );

      // Wall-mounted mirror. Previous code started it at floor level.
      addBox(
        mirrorW,
        0.035,
        mirrorH,
        0,
        0,
        1.48,
        glass
      );

      addBox(
        mirrorW + 0.08,
        0.055,
        0.045,
        0,
        0.006,
        1.48 +
          mirrorH /
            2,
        metal
      );

      addBox(
        mirrorW + 0.08,
        0.055,
        0.045,
        0,
        0.006,
        1.48 -
          mirrorH /
            2,
        metal
      );

      addBox(
        0.045,
        0.055,
        mirrorH,
        -mirrorW /
          2,
        0.006,
        1.48,
        metal
      );

      addBox(
        0.045,
        0.055,
        mirrorH,
        mirrorW /
          2,
        0.006,
        1.48,
        metal
      );

      break;
    }
    default: {
      addBox(w, d, Math.min(h, 0.42), 0, 0, Math.min(h, 0.42) / 2, light);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        addBox(0.045, 0.045, Math.min(0.38, h), sx * w * 0.38, sy * d * 0.34, Math.min(0.38, h) / 2, accent);
      }
    }
  }

  if(asset.furnitureFinishes){
    const finishCache=new Map(),replaced=new Set();
    for(const mesh of meshes){
      const old=mesh.material;if(!old||old.transparent||old.userData?.protectedFinish||old.type==='MeshBasicMaterial'&&old.map)continue;
      const cloth=!!(mesh.geometry.userData?.upholstery||mesh.userData?.upholsterySeam||old.userData?.ventraTextile||Math.abs((old.bumpScale||0)-.0005)<1e-8),target=cloth?'upholstery':'body',selection=asset.furnitureFinishes[target];
      if(!selection)continue;if(!finishCache.has(target))finishCache.set(target,createFurnitureFinishMaterial(THREE,selection));
      const finish=finishCache.get(target);if(finish){mesh.material=finish;replaced.add(old);}
    }
    for(const material of replaced)if(!meshes.some(m=>m.material===material)){material.map?.dispose?.();if(material.bumpMap!==material.map)material.bumpMap?.dispose?.();material.dispose?.();}
  }

  for (const mesh of meshes) {
    if(objectScale!==1){
      const z=Number(asset.zMeters)||0;
      mesh.position.set(cx+(mesh.position.x-cx)*objectScale,cy+(mesh.position.y-cy)*objectScale,z+(mesh.position.z-z)*objectScale);
      mesh.scale.multiplyScalar(objectScale);
    }
    mesh.userData = {
      ...(mesh.userData || {}),
      assetId: asset?.id || null,
      ventraType:
        `schematic_${assetType}`,

      originalVentraType:
        asset?.type ||
        null,

      roomId:
        asset?.roomId ||
        null,

      againstWallId:
        asset?.againstWallId ||
        null,

      placementSource:
        asset?.placementSource ||
        null,

      schematic: true,
    };
  }

  const usedMaterials = new Set(meshes.map((mesh) => mesh.material));
  for (const material of new Set([accent, light, white, dark, sage, rugMat, leafMat, potMat, glass, metal, kitchenWood, kitchenStone])) {
    if (!usedMaterials.has(material)) {
      material.map?.dispose?.();
      if(material.bumpMap!==material.map)material.bumpMap?.dispose?.();
      material.dispose?.();
    }
  }

  return meshes;
}
export {buildSchematicAssetMeshes};
