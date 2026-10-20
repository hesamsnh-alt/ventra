import {PDFName,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';

// A deliberately bounded reader for positioned simple-font text. This is not
// an OCR engine. Unsupported fonts/forms/layout operators invalidate the page;
// never accept a partial opening table as a complete schedule.
const LIMIT=2_000_000,MAX_TOKENS=250_000;
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const identity=()=>[1,0,0,1,0,0];
// PDF strings contain bytes, not Windows-1252 characters. TextDecoder's
// "latin1" alias changes bytes 0x80..0x9f before the font gets to decode them.
const byteString=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.slice(i,i+8192));return s;};

// Bounded one-byte simple-font ToUnicode support. Never guess the encoding of
// an embedded subset font. Composite fonts and inherited CMaps remain excluded.
export function simpleFontUnicodeDecoder(cmap){
 if(typeof cmap!=='string'||cmap.length>65536||/usecmap|begincidchar|begincidrange/i.test(cmap))throw Error('Unsupported native Unicode CMap');
 const text=cmap.replace(/%[^\r\n]*/g,''),spaces=[...text.matchAll(/(\d+)\s+begincodespacerange([\s\S]*?)endcodespacerange/g)];
 if(spaces.length!==1||spaces[0][1]!=='1'||!/^\s*<[\da-f]{2}>\s*<[\da-f]{2}>\s*$/i.test(spaces[0][2]))throw Error('Unsupported native Unicode code space');
 const range=spaces[0][2].match(/<([\da-f]{2})>\s*<([\da-f]{2})>/i).slice(1).map(h=>parseInt(h,16));
 if(range[0]>range[1])throw Error('Invalid native Unicode code space');
 const map=new Map();
 const put=(source,target)=>{
  if(source<range[0]||source>range[1]||map.has(source)||!/^(?:[\da-f]{4}){1,8}$/i.test(target))throw Error('Invalid or conflicting native Unicode mapping');
  const codes=target.match(/.{4}/g).map(h=>parseInt(h,16));
  for(let i=0;i<codes.length;i++)if(codes[i]>=0xd800&&codes[i]<=0xdfff){if(codes[i]>0xdbff||!(codes[i+1]>=0xdc00&&codes[i+1]<=0xdfff))throw Error('Invalid native Unicode surrogate');i++;}
  map.set(source,String.fromCharCode(...codes));
 };
 const blocks=[...text.matchAll(/(\d+)\s+begin(bfchar|bfrange)([\s\S]*?)end\2/g)];
 if(!blocks.length||blocks.length>256||blocks.length!==[...text.matchAll(/\bbeginbf(?:char|range)\b/g)].length)throw Error('Invalid native Unicode mapping blocks');
 for(const b of blocks){
  const entries=b[2]==='bfchar'?[...b[3].matchAll(/<([\da-f]{2})>\s*<([\da-f]+)>/gi)]:[...b[3].matchAll(/<([\da-f]{2})>\s*<([\da-f]{2})>\s*(<[\da-f]+>|\[(?:\s*<[\da-f]+>\s*)+\])/gi)];
  if(Number(b[1])!==entries.length||b[3].replace(b[2]==='bfchar'?/<[\da-f]{2}>\s*<[\da-f]+>/gi:/<[\da-f]{2}>\s*<[\da-f]{2}>\s*(<[\da-f]+>|\[(?:\s*<[\da-f]+>\s*)+\])/gi,'').trim())throw Error('Malformed native Unicode mappings');
  for(const e of entries){
   const start=parseInt(e[1],16);if(b[2]==='bfchar'){put(start,e[2]);continue;}
   const end=parseInt(e[2],16);if(end<start||end-start>255)throw Error('Invalid native Unicode mapping range');
   const values=[...e[3].matchAll(/<([\da-f]+)>/gi)].map(v=>v[1]);
   if(e[3].startsWith('[')){if(values.length!==end-start+1)throw Error('Incomplete native Unicode range');for(let i=start;i<=end;i++)put(i,values[i-start]);}
   else{if(!/^[\da-f]{4}$/i.test(values[0])||parseInt(values[0],16)+end-start>65535)throw Error('Unsupported native Unicode range target');for(let i=start;i<=end;i++)put(i,(parseInt(values[0],16)+i-start).toString(16).padStart(4,'0'));}
  }
 }
 return bytes=>Array.from(bytes,b=>{const value=map.get(b);if(value===undefined||/[\u0000-\u001f\u007f-\u009f]/.test(value))throw Error('Unmapped or control native Unicode character');return value;}).join('');
}
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
  const decoder=fontIsSupported(font);
  if(!inText||!decoder||typeof decoder!=='function'&&bytes.some(b=>b<32||b>126))throw Error('Unsupported native text font or encoding');
  const m=multiply(ctm,tm);if(m[0]*m[3]-m[1]*m[2]<=0||!allowRotated&&(Math.abs(m[1])>1e-6||Math.abs(m[2])>1e-6||m[0]<=0||m[3]<=0))throw Error('Unsupported rotated or mirrored text');
  const text=typeof decoder==='function'?decoder(bytes):byteString(bytes);if(pending)pending.text+=text;else pending={text,x:m[4],y:m[5],height:fontSize*Math.hypot(m[2],m[3]),...(allowRotated?{angle:Math.atan2(m[1],m[0])}: {})};
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
  content+=byteString(bytes)+'\n';
 }return content;
}
export function extractNativePdfText(pdf,pageIndex,options={}){
 try{
  const page=pdf.getPage(pageIndex),resources=page.node.Resources();
  const fontDict=resources?.lookup(PDFName.of('Font'));const supported=new Map();
  for(const [name,ref] of fontDict?.entries?.()||[]){
   const f=pdf.context.lookup(ref),base=f.get(PDFName.of('BaseFont'))?.toString().slice(1),encoding=f.get(PDFName.of('Encoding'))?.toString();
   let decoder=false;
   if(f.has(PDFName.of('ToUnicode'))&&['/Type1','/TrueType'].includes(f.get(PDFName.of('Subtype'))?.toString()))try{
    const stream=f.lookup(PDFName.of('ToUnicode'));
    if(!(stream instanceof PDFRawStream))throw Error('Invalid Unicode stream');
    const bytes=decodePDFRawStream(stream).getBytes(65537);if(bytes.length>65536)throw Error('Unicode stream limit');
    decoder=simpleFontUnicodeDecoder(byteString(bytes));
   }catch{decoder=false;}
   supported.set(name.toString().slice(1),decoder||!f.has(PDFName.of('ToUnicode'))&&['/Type1','/TrueType'].includes(f.get(PDFName.of('Subtype'))?.toString())&&
    /^(?:Helvetica|Times-(?:Roman|Bold|Italic|BoldItalic)|Courier)(?:-Bold|-Oblique|-BoldOblique)?$/.test(base||'')&&(!encoding||encoding==='/WinAnsiEncoding'||encoding==='/StandardEncoding'));
  }
  const content=readNativePdfContent(pdf,pageIndex);
  return {version:1,status:'readable',spans:positionedPdfText(content,name=>supported.get(name),options)};
 }catch(e){return {version:1,status:'unsupported',reason:String(e.message).slice(0,160),spans:[]};}
}
