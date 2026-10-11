// Draw locally: no font download, image request or raw-export fallback.
export function drawVentraWatermark(ctx,width,height){
 const scale=Math.min(width/900,height/500,2.4),w=210*scale,h=62*scale,pad=18*scale;
 const x=width-w-pad,y=height-h-pad;
 ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
 ctx.globalAlpha=.9;ctx.fillStyle='#0b0f19';ctx.fillRect(0,0,210,62);
 ctx.globalAlpha=1;ctx.fillStyle='#ffda29';ctx.fillRect(0,0,3,62);
 ctx.strokeStyle='#ffda29';ctx.lineWidth=4;ctx.lineJoin='miter';
 ctx.beginPath();ctx.moveTo(17,17);ctx.lineTo(33,46);ctx.lineTo(49,17);ctx.stroke();
 ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(24,16);ctx.lineTo(33,11);ctx.lineTo(42,16);ctx.moveTo(33,11);ctx.lineTo(33,27);ctx.stroke();
 ctx.fillStyle='#ffffff';ctx.font='700 24px Arial, sans-serif';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText('VENTRA',62,31);
 ctx.fillStyle='#ffda29';ctx.font='9px Arial, sans-serif';ctx.fillText('AI ARCHITECTURE',63,47);ctx.restore();
 return {x,y,width:w,height:h};
}
export async function watermarkJpegCapture(capture){
 const url=URL.createObjectURL(capture.blob);
 try{
  const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Could not prepare the branded image.'));i.src=url;});
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||capture.width;
  const imageHeight=image.naturalHeight||capture.height,footer=Math.ceil(86*Math.min(canvas.width/900,2.4));canvas.height=imageHeight+footer;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable.');
  ctx.drawImage(image,0,0);ctx.fillStyle='#0b0f19';ctx.fillRect(0,imageHeight,canvas.width,footer);drawVentraWatermark(ctx,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Branded JPEG export failed.')),'image/jpeg',.97));
  return {blob,width:canvas.width,height:canvas.height};
 }finally{URL.revokeObjectURL(url);}
}
export async function downloadBrandedImage(url,name){
 const response=await fetch(url);if(!response.ok)throw new Error('Could not download this render.');
 const capture=await watermarkJpegCapture({blob:await response.blob()});
 const objectUrl=URL.createObjectURL(capture.blob),link=document.createElement('a');link.href=objectUrl;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);
}
