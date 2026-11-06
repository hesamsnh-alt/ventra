export const FURNITURE_FINISHES=Object.freeze([
 ['fabric-linen','Linen','کتان','fabric','#c7baa3',.88,0],['fabric-boucle','Bouclé','بوکله','fabric','#e0d4bd',.96,0],['fabric-velvet','Velvet','مخمل','fabric','#60756b',.8,0],['fabric-leather','Leather','چرم','fabric','#8c6550',.5,0],
 ['wood-oak','Oak','چوب بلوط','wood','#b58d5f',.58,0],['wood-walnut','Walnut','چوب گردو','wood','#78543d',.55,0],['wood-ebony','Dark timber','چوب تیره','wood','#433a33',.6,0],
 ['metal-brushed','Brushed metal','فلز برس‌خورده','metal','#9ea4a8',.38,.85],['metal-gold','Gold metal','فلز طلایی','metal','#c5a05a',.3,.82],['metal-chrome','Chrome','کروم','metal','#d3d9df',.18,.95],
 ['stone-marble','Marble','سنگ مرمر','stone','#dedbd2',.32,0],['stone-terrazzo','Terrazzo','ترازو','stone','#c9c0ad',.68,0],
].map(([id,en,fa,kind,color,roughness,metalness])=>({id,en,fa,ar:en,kind,color,roughness,metalness})));
export const furnitureHasUpholstery=a=>['sofa','armchair','bed','chair','curtain'].includes(a?.type);
export const supportsFurnitureFinish=a=>!!a&&!a.customModelId&&!['rug','plant','flower_pot','personal_model'].includes(a.type);
export function applyFurnitureFinish(scene,assetId,id,target='body'){
 const asset=scene.assets?.find(a=>a.id===assetId);if(!supportsFurnitureFinish(asset))throw Error('Choose editable furniture. / یک وسیله قابل‌ویرایش انتخاب کن.');
 if(!['body','upholstery'].includes(target)||target==='upholstery'&&!furnitureHasUpholstery(asset))throw Error('Invalid material target.');
 if(id!==null&&!FURNITURE_FINISHES.some(m=>m.id===id))throw Error('Unknown furniture material.');
 const finishes={...asset.furnitureFinishes};if(id===null)delete finishes[target];else finishes[target]={id};
 const next={...asset,placementSource:'manual_furniture_editor',provenance:'proposed',excludeFromTakeoff:true};if(Object.keys(finishes).length)next.furnitureFinishes=finishes;else delete next.furnitureFinishes;
 return {...scene,assets:scene.assets.map(a=>a.id===assetId?next:a),furnitureEditor:{version:'furniture-editor-v67',lastOperation:'material'}};
}
export function createFurnitureFinishMaterial(THREE,selection){
 const item=FURNITURE_FINISHES.find(m=>m.id===selection?.id);if(!item)return null;
 const size=128,pixels=new Uint8Array(size*size*4),relief=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size,noise=((x*73+y*139+x*y*13)%113)/113-.5;
  let value=240+noise*9,height=128+noise*18;
  if(item.kind==='wood'){const grain=Math.sin(u*320+Math.sin(v*14)*2+Math.sin(v*39)*.6);value=222+grain*19+noise*9;height=128+grain*20;}
  if(item.kind==='metal'){value=238+noise*7+(item.id==='metal-brushed'?Math.sin(y*2.6)*9:0);height=128+(item.id==='metal-brushed'?Math.sin(y*2.6)*8:noise*3);}
  if(item.id==='fabric-boucle'){height=128+Math.sin(u*140)*Math.cos(v*140)*45;value=232+height*.08+noise*8;}
  if(item.id==='fabric-linen'){height=128+(x%4<2?1:-1)*25+(y%4<2?1:-1)*18;value=237+height*.05+noise*7;}
  if(item.id==='fabric-leather'){height=128+Math.sin(u*90+Math.cos(v*37))*Math.sin(v*83)*25;value=235+height*.04+noise*8;}
  if(item.id==='stone-marble'){const vein=Math.pow(Math.abs(Math.sin(u*17+Math.sin(v*11)*2)),18);value=248-vein*65+noise*4;height=128;}
  if(item.id==='stone-terrazzo'){const chip=Math.sin(x*13+y*29)> .82;value=chip?170+noise*65:241+noise*8;height=128+noise*4;}
  const i=(y*size+x)*4;for(let c=0;c<3;c++){pixels[i+c]=Math.max(0,Math.min(255,value));relief[i+c]=height;}pixels[i+3]=relief[i+3]=255;
 }
 const tex=data=>{const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,2);t.anisotropy=4;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter||THREE.LinearMipMapLinearFilter;t.needsUpdate=true;return t;};
 const mat=new THREE.MeshPhongMaterial({color:selection.color||item.color,map:tex(pixels),bumpMap:tex(relief),bumpScale:item.kind==='fabric'?.0005:item.kind==='wood'?.001:.00015,shininess:item.kind==='metal'?110:item.id==='stone-marble'?45:4,side:THREE.DoubleSide});
 mat.userData={furnitureFinish:item.id,furnitureKind:item.kind,furniturePbr:{roughness:item.roughness,metalness:item.metalness}};return mat;
}
