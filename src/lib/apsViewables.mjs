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
 if(!found.size){try{add(root.getDefaultGeometry?.());}catch{}}
 return [...found].filter(n=>{
  const parents=new Set();for(let p=n?.parent;p&&!parents.has(p);p=p.parent){parents.add(p);if(['failed','timeout'].includes(String(data(p).status||'').toLowerCase()))return false;}return true;
 });
}
export function selectApsGeometry(root,{prefer2D=true}={}){
 const nodes=apsGeometryNodes(root);
 return nodes.find(n=>role(n)===(prefer2D?'2d':'3d'))||nodes[0]||null;
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
