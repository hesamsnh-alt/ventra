// Thresholds follow the visible drawing, not unused scanner/export paper.
// Coordinates stay in the original image frame; no crop or rescale is applied.
export function rasterContentExtent(mask,width,height){
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x]){
  left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
 }
 if(right<left)return{left:0,top:0,width,height,scalePixels:Math.min(width,height),empty:true};
 const activeWidth=right-left+1,activeHeight=bottom-top+1;
 return{left,top,width:activeWidth,height:activeHeight,scalePixels:Math.min(activeWidth,activeHeight),empty:false};
}
