const data=node=>node?.data||node||{};
const role=node=>String(data(node).role||'').toLowerCase();
export function apsGeometryNodes(root){
 if(!root)return [];
 let found=[];
 try{found=root.search?.({type:'geometry'})||[];}catch{}
 if(!Array.isArray(found))found=[];
 if(!found.length){
  const seen=new Set();const visit=n=>{if(!n||seen.has(n))return;seen.add(n);if(String(data(n).type||'').toLowerCase()==='geometry')found.push(n);const children=n.children||data(n).children||[];if(Array.isArray(children))children.forEach(visit);};visit(root);
 }
 if(!found.length){try{const fallback=root.getDefaultGeometry?.();if(fallback)found=[fallback];}catch{}}
 return [...new Set(found)].filter(n=>!['failed','timeout'].includes(String(data(n).status||'').toLowerCase()));
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
