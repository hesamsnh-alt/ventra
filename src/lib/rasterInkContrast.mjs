// Retain dark ink and locally darker faint strokes. A bright paper background
// is not itself ink; smooth illumination changes must not create geometry.
export function rasterInkContrast(tone,width,height){
  const stride=width+1,integral=new Float64Array(stride*(height+1));
  for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=tone[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}}
  const mask=new Uint8Array(tone.length),strokeMask=new Uint8Array(tone.length);
  const radius=Math.max(6,Math.min(24,Math.round(Math.min(width,height)*.025)));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,v=tone[i],x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
    const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
    strokeMask[i]=v<252&&mean-v>=6?1:0;
    mask[i]=v<170||strokeMask[i]?1:0;
  }
  return{mask,strokeMask};
}
