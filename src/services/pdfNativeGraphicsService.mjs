import {readNativePdfContent,tokenizePdfContent} from './pdfNativeTextService.mjs';
const identity=()=>[1,0,0,1,0,0];
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export function readNativePdfPaths(content){
 let ctm=identity(),width=1,color=[0],dash=[],path=[],point=null,start=null,curved=false,array=null;const saved=[],args=[],strokes=[];
 const transform=(x,y)=>({x:ctm[0]*x+ctm[2]*y+ctm[4],y:ctm[1]*x+ctm[3]*y+ctm[5]});
 const finish=stroke=>{if(stroke&&path.length){
  const sx=Math.hypot(ctm[0],ctm[1]),sy=Math.hypot(ctm[2],ctm[3]);if(Math.abs(sx-sy)>1e-5||Math.abs(ctm[0]*ctm[2]+ctm[1]*ctm[3])>1e-5)throw Error('Nonuniform or sheared vector scale');
  strokes.push({width:width*sx,color:[...color],dash:[...dash],curved,segments:path});if(strokes.length>20000)throw Error('Native vector path limit');
 }path=[];point=null;start=null;curved=false;};
 const line=p=>{if(point)path.push({a:point,b:p});point=p;};
 for(const token of tokenizePdfContent(content)){
  if(token==='['){array=[];continue;}if(token===']'){if(!array)throw Error('Unmatched graphics array');args.push(array);array=null;continue;}if(array){array.push(token);continue;}
  if(typeof token!=='string'||token.startsWith('/')){args.push(token);continue;}const a=args.splice(0);
  const nums=n=>{if(a.length!==n||a.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid graphics operands');};
  if(token==='q')saved.push({ctm:[...ctm],width,color:[...color],dash:[...dash]});
  else if(token==='Q'){const s=saved.pop();if(!s)throw Error('Unbalanced graphics state');({ctm,width,color,dash}=s);}
  else if(token==='cm'){nums(6);ctm=mul(ctm,a);}
  else if(token==='w'){nums(1);width=a[0];}
  else if(['RG','G','K'].includes(token)){nums(token==='RG'?3:token==='G'?1:4);color=[...a];}
  else if(token==='d'){if(!Array.isArray(a[0]))throw Error('Invalid dash');dash=a[0];}
  else if(token==='m'){nums(2);point=transform(...a);start=point;}
  else if(token==='l'){nums(2);line(transform(...a));}
  else if(token==='re'){nums(4);point=transform(a[0],a[1]);start=point;line(transform(a[0]+a[2],a[1]));line(transform(a[0]+a[2],a[1]+a[3]));line(transform(a[0],a[1]+a[3]));line(start);}
  else if(token==='h'){if(start)line(start);}
  else if(['c','v','y'].includes(token)){curved=true;line(transform(a.at(-2),a.at(-1)));}
  else if(['s','b','b*'].includes(token)){if(start)line(start);finish(true);}
  else if(['S','B','B*'].includes(token))finish(true);
  else if(['n','f','f*','F'].includes(token))finish(false);
  else if(['Do','BI','ID','EI','gs','W','W*'].includes(token))throw Error('Unsupported vector graphics operator '+token);
 }
 if(saved.length)throw Error('Unbalanced graphics save');return strokes;
}
export function extractNativePdfGraphics(pdf,pageIndex){
 try{return {version:1,status:'readable',strokes:readNativePdfPaths(readNativePdfContent(pdf,pageIndex))};}
 catch(e){return {version:1,status:'unsupported',reason:String(e.message).slice(0,160),strokes:[]};}
}
