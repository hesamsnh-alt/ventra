import * as T from 'three';
import sharp from 'sharp';
import {FURNITURE_FINISHES,createFurnitureFinishMaterial} from '../src/lib/furnitureFinishes.mjs';
for(const f of FURNITURE_FINISHES){const m=createFurnitureFinishMaterial(T,{id:f.id}),color=new T.Color(f.color).getRGB({},T.SRGBColorSpace),bytes=new Uint8Array(m.map.image.data);for(let i=0;i<bytes.length;i+=4){bytes[i]*=color.r;bytes[i+1]*=color.g;bytes[i+2]*=color.b;}await sharp(bytes,{raw:{width:128,height:128,channels:4}}).png().toFile(new URL('../public/realistic-assets/furniture-finishes/'+f.id+'.png',import.meta.url).pathname);m.map.dispose();m.bumpMap.dispose();m.dispose();}
