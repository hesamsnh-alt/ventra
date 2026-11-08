const data=node=>node?.data||node||{};
const role=node=>String(data(node).role||'').toLowerCase();
export function apsGeometryNodes(root){
 if(!root)return [];
 const found=new Set(),seen=new Set();
 const add=n=>{if(!n)return;const d=data(n);if(String(d.type||'').toLowerCase()==='geometry'&&['2d','3d'].includes(role(n))&&!['failed','timeout'].includes(String(d.status||'').toLowerCase()))found.add(n);};
 const visit=n=>{
  if(!n||seen.has(n))return;seen.add(n);
  if(['failed','timeout'].includes(String(data(n).status||'').toLowerCase()))return;
  add(n);
  const children=n.children||data(n).children||data(n).derivatives||[];
  if(Array.isArray(children))children.forEach(visit);
 };
 visit(root);
 // Search and default are SDK compatibility fallbacks, not alternatives to
 // traversing the tree. A partial/empty search must not hide a populated layout.
 try{for(const n of root.search?.({type:'geometry'})||[])add(n);}catch{}
 try{add(root.getDefaultGeometry?.());}catch{}
 return [...found].filter(n=>{
  const parents=new Set();for(let p=n?.parent;p&&!parents.has(p);p=p.parent){parents.add(p);if(['failed','timeout'].includes(String(data(p).status||'').toLowerCase()))return false;}return true;
 });
}
export function selectApsGeometry(root,{prefer2D=true}={}){
 const nodes=apsGeometryNodes(root);
 const preferred=prefer2D?'2d':'3d';
 // CAD model space contains drawing entities. The first 2D geometry can
 // instead be an empty print layout (a successfully loaded white sheet).
 // Native IFC/RVT selection keeps its existing 3D-first ordering.
 if(prefer2D){
  const modelNodes=nodes.filter(apsIsModelSpace);
  const model=modelNodes.find(n=>role(n)===preferred)||modelNodes[0];
  if(model)return model;
 }
 return nodes.find(n=>role(n)===preferred)||nodes[0]||null;
}
export function apsIsModelSpace(node){
 const seen=new Set();
 for(let n=node;n&&!seen.has(n);n=n.parent){
  seen.add(n);const d=data(n),name=String(d.name||'').trim();
  if(/^(?:\*?model[ _-]*space|model|模型空间|模型空間)$/i.test(name)||d.isModelSpace===true)return true;
  // Do not let a generic parent called Model override a named paper layout.
  if(/^(?:layout(?:[ _-]*\d+)?|\*?paper[ _-]*space(?:\d+)?|sheet(?:[ _-]*\d+)?)$/i.test(name))return false;
 }
 return false;
}
export function apsManifestGeometry(manifest){
 const views=[],messages=[];const visit=(n,blocked=false)=>{
  if(!n||typeof n!=='object')return;
  const failed=blocked||['failed','timeout'].includes(String(n.status||'').toLowerCase());
  if(n.type==='geometry'&&['2d','3d'].includes(String(n.role||'').toLowerCase())&&!failed)views.push({role:n.role,guid:n.guid||null,name:n.name||null});
  for(const m of n.messages||[])if(typeof m.message==='string')messages.push(m.message.slice(0,400));
  for(const c of [...(n.derivatives||[]),...(n.children||[])])visit(c,failed);
 };visit(manifest);return {views,messages};
}
export function isPlanCadUrn(urn){
 try{const encoded=String(urn||'').replace(/^urn:/,'').replace(/-/g,'+').replace(/_/g,'/');const resource=atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'='));return /\.(?:dwg|dxf)$/i.test(decodeURIComponent(resource));}catch{return false;}
}
