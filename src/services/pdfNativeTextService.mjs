import {PDFName,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';

// A deliberately bounded reader for positioned simple-font text. This is not
// an OCR engine. Unsupported fonts/forms/layout operators invalidate the page;
// never accept a partial opening table as a complete schedule.
const LIMIT=2_000_000,MAX_TOKENS=250_000;
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const identity=()=>[1,0,0,1,0,0];
export function tokenizePdfContent(text){
 const out=[];let i=0;
 while(i<text.length){
  if(out.length>MAX_TOKENS)throw Error('Native text token limit');
  const ch=text[i];if(/\s/.test(ch)){i++;continue;}if(ch==='%'){while(i<text.length&&!/[\r\n]/.test(text[i]))i++;continue;}
  if(ch==='('){let depth=1,bytes=[];i++;
   while(i<text.length&&depth){let c=text[i++];if(c==='\\'){
    c=text[i++];if(c==='\r'||c==='\n'){if(c==='\r'&&text[i]==='\n')i++;continue;}
    if(/[0-7]/.test(c||'')){let oct=c;for(let k=0;k<2&&/[0-7]/.test(text[i]||'');k++)oct+=text[i++];bytes.push(parseInt(oct,8)&255);}
    else bytes.push(({n:10,r:13,t:9,b:8,f:12})[c]??c?.charCodeAt(0));
   }else if(c==='('){depth++;bytes.push(40);}else if(c===')'){if(--depth)bytes.push(41);}else bytes.push(c.charCodeAt(0));}
   if(depth)throw Error('Unterminated PDF string');out.push({bytes});continue;
  }
  if(ch==='<'&&text[i+1]!=='<'){const end=text.indexOf('>',i);if(end<0)throw Error('Unterminated hex string');let h=text.slice(i+1,end).replace(/\s/g,'');if(!/^[\da-f]*$/i.test(h))throw Error('Invalid hex string');if(h.length%2)h+='0';out.push({bytes:Array.from({length:h.length/2},(_,k)=>parseInt(h.slice(k*2,k*2+2),16))});i=end+1;continue;}
  if('[]'.includes(ch)){out.push(ch);i++;continue;}
  const match=text.slice(i).match(/^\/?[^\s()[\]<>%]+/);if(!match)throw Error('Unsupported content token');
  const word=match[0];out.push(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)?Number(word):word);i+=word.length;
 }
 return out;
}
export function positionedPdfText(content,fontIsSupported,{allowRotated=false}={}){
 const tokens=tokenizePdfContent(content),spans=[],stack=[],saved=[];
 let ctm=identity(),tm=identity(),line=identity(),font='',fontSize=12,leading=0,inText=false,pending=null,array=null;
 const flush=()=>{if(pending?.text.trim())spans.push(pending);pending=null;if(spans.length>20000)throw Error('Native text span limit');};
 const show=bytes=>{
  if(!inText||!fontIsSupported(font)||bytes.some(b=>b<32||b>126))throw Error('Unsupported native text font or encoding');
  const m=multiply(ctm,tm);if(m[0]*m[3]-m[1]*m[2]<=0||!allowRotated&&(Math.abs(m[1])>1e-6||Math.abs(m[2])>1e-6||m[0]<=0||m[3]<=0))throw Error('Unsupported rotated or mirrored text');
  const text=String.fromCharCode(...bytes);if(pending)pending.text+=text;else pending={text,x:m[4],y:m[5],height:fontSize*Math.hypot(m[2],m[3]),...(allowRotated?{angle:Math.atan2(m[1],m[0])}: {})};
 };
 const move=(x,y)=>{flush();line=multiply(line,[1,0,0,1,x,y]);tm=[...line];};
 for(const token of tokens){
  if(token==='['){if(array)throw Error('Nested content array');array=[];continue;}if(token===']'){if(!array)throw Error('Unmatched array');stack.push(array);array=null;continue;}
  if(array){array.push(token);continue;}
  if(typeof token!=='string'||token.startsWith('/')){stack.push(token);continue;}
  const args=stack.splice(0);const numbers=n=>{if(args.length!==n||args.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid content operands');};
  if(token==='q'){flush();saved.push({ctm:[...ctm],font,fontSize,leading});}
  else if(token==='Q'){flush();const s=saved.pop();if(!s)throw Error('Unbalanced graphics state');({ctm,font,fontSize,leading}=s);}
  else if(token==='cm'){numbers(6);flush();ctm=multiply(ctm,args);}
  else if(token==='BT'){flush();inText=true;tm=identity();line=identity();}
  else if(token==='ET'){flush();inText=false;}
  else if(token==='Tf'){flush();if(args.length!==2||typeof args[0]!=='string'||!(args[1]>0))throw Error('Invalid font');font=args[0].slice(1);fontSize=args[1];}
  else if(token==='Tm'){numbers(6);flush();tm=[...args];line=[...args];}
  else if(token==='TL'){numbers(1);leading=args[0];}
  else if(token==='Td'||token==='TD'){numbers(2);if(token==='TD')leading=-args[1];move(...args);}
  else if(token==='T*')move(0,-leading);
  else if(token==='Tj'){if(!args[0]?.bytes)throw Error('Invalid text string');show(args[0].bytes);}
  else if(token==='TJ'){if(!Array.isArray(args[0]))throw Error('Invalid text array');for(const t of args[0]){if(t?.bytes)show(t.bytes);else if(typeof t==='number'){if(t<-150&&pending)pending.text+=' ';}else throw Error('Invalid text array element');}}
  else if(token==="'"){move(0,-leading);if(!args[0]?.bytes)throw Error('Invalid next-line text');show(args[0].bytes);}
  else if(['Do','BI','ID','EI','gs','Tr','Ts','Tz','Tc','Tw','"','W','W*'].includes(token))throw Error('Unsupported native text operation '+token);
 }
 flush();if(saved.length||array)throw Error('Unbalanced native content');return spans;
}
export function readNativePdfContent(pdf,pageIndex){
 const contents=pdf.getPage(pageIndex).node.Contents();let content='';
 for(const ref of contents instanceof PDFArray?contents.asArray():[contents]){
  const stream=pdf.context.lookup(ref);if(!(stream instanceof PDFRawStream))throw Error('Unsupported native content stream');
  const bytes=decodePDFRawStream(stream).getBytes(LIMIT+1);if(bytes.length>LIMIT||content.length+bytes.length>LIMIT)throw Error('Native text size limit');
  content+=new TextDecoder('latin1').decode(bytes)+'\n';
 }return content;
}
export function extractNativePdfText(pdf,pageIndex,options={}){
 try{
  const page=pdf.getPage(pageIndex),resources=page.node.Resources();
  const fontDict=resources?.lookup(PDFName.of('Font'));const supported=new Map();
  for(const [name,ref] of fontDict?.entries?.()||[]){
   const f=pdf.context.lookup(ref),base=f.get(PDFName.of('BaseFont'))?.toString().slice(1),encoding=f.get(PDFName.of('Encoding'))?.toString();
   supported.set(name.toString().slice(1),!f.has(PDFName.of('ToUnicode'))&&['/Type1','/TrueType'].includes(f.get(PDFName.of('Subtype'))?.toString())&&
    /^(?:Helvetica|Times-(?:Roman|Bold|Italic|BoldItalic)|Courier)(?:-Bold|-Oblique|-BoldOblique)?$/.test(base||'')&&(!encoding||encoding==='/WinAnsiEncoding'||encoding==='/StandardEncoding'));
  }
  const content=readNativePdfContent(pdf,pageIndex);
  return {version:1,status:'readable',spans:positionedPdfText(content,name=>supported.get(name)===true,options)};
 }catch(e){return {version:1,status:'unsupported',reason:String(e.message).slice(0,160),spans:[]};}
}
