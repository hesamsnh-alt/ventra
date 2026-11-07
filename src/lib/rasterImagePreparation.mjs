import sharp from 'sharp';

// Keep the customer's original bytes unchanged. The Vision/evidence image uses
// a smaller pixel frame; review overlays are mapped back to the original frame.
export async function prepareRasterVisionBuffer(source, {maxDimension=2200,quality=92}={}) {
  const {data,info}=await sharp(source).rotate().flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info;
  let left=width,top=height,right=-1,bottom=-1;
  // Include even very pale CAD annotations; isolated ink is deliberately kept.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*channels;
    if(Math.min(data[offset],data[offset+1],data[offset+2])<248){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  const pad=Math.max(12,Math.ceil(Math.min(width,height)*.015));
  left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(width-1,right+pad);bottom=Math.min(height-1,bottom+pad);
  let crop={left:0,top:0,width,height};
  if(right>=left&&bottom>=top){const candidate={left,top,width:right-left+1,height:bottom-top+1};if(candidate.width>=32&&candidate.height>=32&&candidate.width*candidate.height<width*height*.85)crop=candidate;}
  const result=await sharp(data,{raw:{width,height,channels}}).extract(crop)
    .resize({width:maxDimension,height:maxDimension,fit:'inside',withoutEnlargement:true})
    .sharpen({sigma:.6}).jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer({resolveWithObject:true});
  return {buffer:result.data,imageUrl:`data:image/jpeg;base64,${result.data.toString('base64')}`,width:result.info.width,height:result.info.height,
    sourceFrame:{width,height,crop,preparedWidth:result.info.width,preparedHeight:result.info.height}};
}

// Input is the compiler's normalized [0,1000] trace in the prepared image frame.
// Copy only geometry collections: do not mutate provider output or metric data.
export function traceInOriginalImage(trace,frame){
  if(!trace||!frame)return trace;
  const point=p=>({...p,x:(frame.crop.left+p.x*frame.crop.width/1000)*1000/frame.width,y:(frame.crop.top+p.y*frame.crop.height/1000)*1000/frame.height});
  const polygon=ps=>Array.isArray(ps)?ps.map(point):ps;
  const spans=rows=>Array.isArray(rows)?rows.map(row=>({...row,start:point(row.start),end:point(row.end)})):rows;
  return {...trace,footprint:polygon(trace.footprint),holes:trace.holes?.map(r=>({...r,polygon:polygon(r.polygon)})),rooms:trace.rooms?.map(r=>({...r,polygon:polygon(r.polygon)})),walls:spans(trace.walls),openings:spans(trace.openings),measurements:spans(trace.measurements)};
}
