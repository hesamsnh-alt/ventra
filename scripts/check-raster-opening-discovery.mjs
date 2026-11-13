// Local, zero-API regression against independently annotated source jambs.
// Usage: node scripts/check-raster-opening-discovery.mjs IMAGE ANNOTATIONS.json
// Annotation: {doors:[{start:{x,y},end:{x,y},swingDirection:"clockwise"}],tolerancePixels:8}
import fs from 'node:fs/promises';import sharp from 'sharp';
import {extractRasterPixelGraph} from '../src/lib/rasterPixelGraph.mjs';
import {discoverRasterOpenings,sourceDoorGapCandidates} from '../src/lib/rasterOpeningDiscovery.mjs';
const[imagePath,annotationPath]=process.argv.slice(2);if(!imagePath||!annotationPath)throw Error('Supply IMAGE and independent ANNOTATIONS.json. No API is used.');
const input=await fs.readFile(imagePath),truth=JSON.parse(await fs.readFile(annotationPath,'utf8')),metadata=await sharp(input).metadata(),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),results=[];
if(!Array.isArray(truth.doors)||!truth.doors.length)throw Error('Independent door annotations are required.');
for(const{name,scale,rotation}of [{name:'original',scale:1,rotation:0},{name:'rotated90',scale:1,rotation:90},{name:'rotated17',scale:1,rotation:17},{name:'scaled75',scale:.75,rotation:0}]){
 let pipeline=sharp(input);if(scale!==1)pipeline=pipeline.resize({width:Math.round(metadata.width*scale)});if(rotation)pipeline=pipeline.rotate(rotation,{background:'#fff'});
 const buffer=await pipeline.sharpen({sigma:.6}).jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer(),graph=await extractRasterPixelGraph(buffer),observed=await discoverRasterOpenings(buffer,graph),attached=sourceDoorGapCandidates(graph,observed),angle=rotation*Math.PI/180;
 const transform=p=>({x:graph.imageWidth/2+scale*((p.x-metadata.width/2)*Math.cos(angle)-(p.y-metadata.height/2)*Math.sin(angle)),y:graph.imageHeight/2+scale*((p.x-metadata.width/2)*Math.sin(angle)+(p.y-metadata.height/2)*Math.cos(angle))}),available=new Set(observed.doors.map((_,i)=>i));
 const matches=truth.doors.map((door,i)=>{const start=transform(door.start),end=transform(door.end);let nearest=-1,error=Infinity;for(const j of available){const d=attached[j],value=Math.max(distance(start,d.start),distance(end,d.end))/scale;if(value<error){nearest=j;error=value;}}available.delete(nearest);const actual=observed.doors[nearest];return{annotation:i+1,errorPixels:Number(error.toFixed(2)),passed:!!actual&&error<=(truth.tolerancePixels||8)&&actual.swingDirection===door.swingDirection};});
 results.push({name,expected:truth.doors.length,detected:observed.doors.length,passed:observed.doors.length===truth.doors.length&&matches.every(m=>m.passed),matches});
}
console.log(JSON.stringify({apiRequests:0,passed:results.every(r=>r.passed),results},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
