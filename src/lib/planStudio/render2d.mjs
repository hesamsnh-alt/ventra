import {shaftOuter,shaftSize,shaftFitsFloor} from './structures.mjs';
import {openingPlanGeometry,wallOpeningSegments} from './openings.mjs';
import {lineDash} from './lineTypes.mjs';
import {segments,at,bounds,dist} from './geometry.mjs';
import {styleFor,visibleEntities,displayLength} from './document.mjs';
export const escapeXML=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function hatchPattern(type,scale=.2,color='#999'){const gap=Math.max(.01,scale),s=gap;let body='';const line=(x1,y1,x2,y2)=>`<path d="M${x1},${y1}L${x2},${y2}"/>`;
 if(type==='solid')return `<rect width="${s}" height="${s}" fill="${color}" opacity=".3"/>`;
 if(['diagonal','steel','cross'].includes(type)){body=line(-s,0,s,2*s)+line(0,-s,2*s,s);if(type==='steel')body+=line(-s*.85,0,s*1.15,s*2);if(type==='cross')body+=line(0,s,s,0);}
 if(type==='brick')body=`<path d="M0,0H${s}M0,${s/2}H${s}M${s/2},0V${s/2}M0,${s/2}V${s}"/>`;
 if(type==='interlock')body=`<path d="M0,0H${s*.6}V${s*.3}H${s}M0,${s*.5}H${s*.3}V${s}M${s*.6},${s*.3}V${s*.7}H${s}M${s*.3},${s*.5}H${s*.6}"/>`;
 if(type==='concrete'||type==='sand')body=`<circle cx="${s*.2}" cy="${s*.3}" r="${s*.035}"/><circle cx="${s*.7}" cy="${s*.8}" r="${s*.025}"/>`+(type==='concrete'?`<path d="M${s*.5},${s*.2}l${s*.16},${s*.15}l-${s*.21},${s*.05}z"/>`:'');
 if(type==='insulation')body=`<path d="M0,${s/2}Q${s/4},${-s/2} ${s/2},${s/2}T${s},${s/2}"/>`;
 return `<g fill="none" stroke="${color}" stroke-width="${Math.max(.0005,s*.02)}">${body}</g>`;
}
export function pathData(e){if(e.type==='polyline')return 'M'+e.points.map(p=>`${p.x},${p.y}`).join('L')+(e.closed?'Z':'');if(e.type==='line')return`M${e.a.x},${e.a.y}L${e.b.x},${e.b.y}`;if(['arc','circle'].includes(e.type)){if(e.type==='circle'){const a=at(e,0),b=at(e,.5);return`M${a.x},${a.y}A${e.radius},${e.radius} 0 1 1 ${b.x},${b.y}A${e.radius},${e.radius} 0 1 1 ${a.x},${a.y}`;}const a=at(e,0),b=at(e,1);return`M${a.x},${a.y}A${e.radius},${e.radius} 0 ${Math.abs(e.sweep)>Math.PI?1:0} ${e.sweep>0?1:0} ${b.x},${b.y}`;}return '';}
export function dimensionGeometry(e){const l=dist(e.a,e.b),n={x:-(e.b.y-e.a.y)/l,y:(e.b.x-e.a.x)/l},o=e.offsetDistance||.3,a={x:e.a.x+n.x*o,y:e.a.y+n.y*o},b={x:e.b.x+n.x*o,y:e.b.y+n.y*o};return{a,b,mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},normal:n,length:l,angle:Math.atan2(e.b.y-e.a.y,e.b.x-e.a.x)*180/Math.PI};}
export function plateHoles(e){return[-1,1].flatMap(x=>[-1,1].map(y=>({x:x*(e.width/2-e.edge),y:y*(e.depth/2-e.edge)})));}
// Wall width is geometry; the drafting outline remains a thin screen pen.
export function wallOutlineData(e){
 const half=e.thickness/2;
 if(e.type==='line'){
  const length=dist(e.a,e.b);if(!length)return '';
  const nx=-(e.b.y-e.a.y)/length*half,ny=(e.b.x-e.a.x)/length*half;
  return `M${e.a.x+nx},${e.a.y+ny}L${e.b.x+nx},${e.b.y+ny}L${e.b.x-nx},${e.b.y-ny}L${e.a.x-nx},${e.a.y-ny}Z`;
 }
 if(e.type==='arc'&&e.radius>half){
  const outer={...e,radius:e.radius+half},inner={...e,radius:e.radius-half},end=at(inner,1),first=at(inner,0),sweep=e.sweep>0?0:1;
  return `${pathData(outer)}L${end.x},${end.y}A${inner.radius},${inner.radius} 0 ${Math.abs(e.sweep)>Math.PI?1:0} ${sweep} ${first.x},${first.y}Z`;
 }
 return '';
}
function renderEntitySVG(doc,e,{print=false,selected=false,screen=false}={}){
 const st=styleFor(doc,e),color=selected?'#ffdb4e':print&&st.color.toLowerCase()==='#dce6ed'?'#202832':st.color,w=screen?Math.max(.8,Math.min(3,st.weight*4)):(e.role==='wall'?e.thickness:st.weight*.001*(print?doc.printScale:35)),dash=lineDash(st.dash,screen),attrs=`stroke="${escapeXML(color)}" stroke-width="${w}" ${screen?'vector-effect="non-scaling-stroke"':''} ${dash?`stroke-dasharray="${dash}"`:''} fill="none" stroke-linecap="round" stroke-linejoin="round"`;
 if(e.role==='shaft'){const outer=pathData({type:'polyline',points:shaftOuter(e),closed:true}),inner=pathData(e),g=shaftSize(e);return `<g data-shaft="true"><path d="${outer+inner}" ${attrs.replace(' fill="none"','')} fill="${color}" fill-opacity=".18" fill-rule="evenodd"/><path d="M${e.points[0].x},${e.points[0].y}L${e.points[2].x},${e.points[2].y}M${e.points[1].x},${e.points[1].y}L${e.points[3].x},${e.points[3].y}" ${attrs} stroke-dasharray="${screen?'5 4':'.08 .06'}"/><text transform="translate(${g.center.x},${g.center.y}) scale(1,-1)" text-anchor="middle" fill="${color}" font-size=".15">LIFT PIT</text></g>`;}
 if(e.role==='wall'&&e.type==='line'&&doc.entities.some(o=>o.type==='opening'&&o.wall===e.id)){
  return wallOpeningSegments(doc,e).map(piece=>screen?`<path d="${wallOutlineData(piece)}" ${attrs.replace(' fill="none"','')} fill="${escapeXML(color)}" fill-opacity="${e.structure==='shear'?.32:.08}"/>`:`<path d="${pathData(piece)}" ${attrs.replace('stroke-linecap="round"','stroke-linecap="butt"')}/>`).join('');
 }
 const outline=screen&&e.role==='wall'&&e.thickness?wallOutlineData(e):'';if(outline)return `<path d="${outline}" ${attrs.replace(' fill="none"','')} fill="${escapeXML(color)}" fill-opacity="${e.structure==='shear'?.32:.08}"/>`;
 const floorVoids=e.role==='floor'?doc.entities.filter(x=>x.role==='shaft'&&Math.abs((x.z||0)-(e.z||0))<1e-6&&shaftFitsFloor(x,e)).map(shaftOuter):[];
 const path=pathData(e)+[...(e.hatchHoles||[]),...floorVoids].map(points=>pathData({type:'polyline',points,closed:true})).join('');if(path)return `<path d="${path}" fill-rule="evenodd" ${attrs.replace(' fill="none"','').replace(e.role==='hatch'&&!selected?`stroke="${escapeXML(color)}"`:'__never__','stroke="none"')} fill="${e.hatch?`url(#hatch-${escapeXML(e.id)})`:'none'}"/>`;
 if(e.type==='text')return `<text transform="translate(${e.position.x},${e.position.y}) rotate(${e.rotation||0}) scale(1,-1)" fill="${color}" font-size="${e.textHeight}" font-family="Arial,sans-serif" direction="${/[\u0600-\u06ff]/.test(e.text)?'rtl':'ltr'}">${escapeXML(e.text)}</text>`;
 if(e.type==='dimension'){const d=dimensionGeometry(e),size=Math.max(.09,.0025*(print?doc.printScale:50));return`<g ${attrs}><path d="M${e.a.x},${e.a.y}L${d.a.x+d.normal.x*.1},${d.a.y+d.normal.y*.1}M${e.b.x},${e.b.y}L${d.b.x+d.normal.x*.1},${d.b.y+d.normal.y*.1}M${d.a.x},${d.a.y}L${d.b.x},${d.b.y}"/>${[d.a,d.b].map(p=>`<path d="M${p.x-size*.3},${p.y-size*.3}l${size*.6},${size*.6}"/>`).join('')}<text transform="translate(${d.mid.x},${d.mid.y+size*.3}) scale(1,-1)" text-anchor="middle" fill="${color}" stroke="none" font-family="Arial,sans-serif" font-size="${size}">${displayLength(d.length,doc.units)}</text></g>`;}
 if(e.type==='plate')return `<g transform="translate(${e.center.x},${e.center.y}) rotate(${e.rotation||0})" ${attrs}><rect x="${-e.width/2}" y="${-e.depth/2}" width="${e.width}" height="${e.depth}" fill="${color}" fill-opacity=".12"/>${plateHoles(e).map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${e.boltDiameter/2}"/>`).join('')}</g>`;
 if(e.type==='asset')return `<g transform="translate(${e.center.x},${e.center.y}) rotate(${e.rotation||0})" ${attrs}><rect x="${-e.width/2}" y="${-e.depth/2}" width="${e.width}" height="${e.depth}" rx=".05" fill="${color}" fill-opacity=".13"/><path d="M${-e.width/2},${-e.depth/2}L${e.width/2},${e.depth/2}"/></g>`;
 if(e.type==='opening'){
  const geometry=openingPlanGeometry(doc,e);if(!geometry)return '';
  // All symbol lines are thin pens; the host wall already contains the gap.
  const pen=screen?w:st.weight*.001*(print?doc.printScale:35),symbol=attrs.replace(`stroke-width="${w}"`,`stroke-width="${pen}"`).replace(/stroke-dasharray="[^"]*"/,'');
  return `<g data-opening-symbol="${e.kind}">${geometry.curves.map(curve=>`<path d="${pathData(curve)}" ${symbol}/>`).join('')}</g>`;
 }

 if(e.type==='light')return `<g ${attrs}><circle cx="${e.center.x}" cy="${e.center.y}" r=".12"/><path d="M${e.center.x-.17},${e.center.y}h.34M${e.center.x},${e.center.y-.17}v.34"/></g>`;return '';
}
export function entitySVG(doc,e,options={}){
 const markup=renderEntitySVG(doc,e,options);
 if(!options.screen)return markup;
 // vector-effect is not inherited by children of an SVG group.
 return markup.replace(/<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/g,(tag,name,attributes)=>attributes.includes('vector-effect=')||attributes.includes('data-world-stroke=')?tag:`<${name} vector-effect="non-scaling-stroke"${attributes}>`);
}
export function drawingSVG(doc,{print=false,width=1800,height=1200,viewport=null}={}){
 const entities=visibleEntities(doc),b=viewport||bounds(entities),pad=viewport?0:Math.max(.3,Math.max(b.width,b.height)*.04);let w=b.width+2*pad,h=b.height+2*pad;if(w/h>width/height)h=w*height/width;else w=h*width/height;
 const defs=entities.filter(e=>e.hatch).map(e=>`<pattern id="hatch-${escapeXML(e.id)}" patternUnits="userSpaceOnUse" width="${e.hatchScale||.2}" height="${e.hatchScale||.2}">${hatchPattern(e.hatch,e.hatchScale,print&&styleFor(doc,e).color.toLowerCase()==='#dce6ed'?'#202832':styleFor(doc,e).color)}</pattern>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${b.x-pad} ${-b.y-b.height-pad} ${w} ${h}"><rect x="${b.x-pad}" y="${-b.y-b.height-pad}" width="${w}" height="${h}" fill="${print?'white':'#111923'}"/><defs>${defs}</defs><g transform="scale(1,-1)">${entities.map(e=>entitySVG(doc,e,{print})).join('')}</g></svg>`;
}
