import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
import * as editor from '../src/lib/furnitureEditor.mjs';import * as openings from '../src/lib/manualOpenings.mjs';
const require=createRequire(import.meta.url);
async function panel(){
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();
 const compiled=await transform(readFileSync('src/app/projects/[id]/FurnitureEditorPanel.jsx','utf8'),{filename:'FurnitureEditorPanel.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const states=[];let cursor=0,effects=[],tool;
 const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef(initial){const i=cursor++;return states[i]||=( {current:initial});},useEffect(fn){effects.push(fn);}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
 const sandbox={exports:{},require:id=>id==='react'?react:id==='react/jsx-runtime'?jsx:id==='@/lib/furnitureEditor.mjs'?editor:id==='@/lib/manualOpenings.mjs'?openings:id==='@/app/components/i18n/LanguageProvider'?{useLanguage:()=>({language:'en'})}:id.endsWith('.css')?{}:id==='./ToolDrawer'?{default:'drawer'}:require(id)};
 vm.createContext(sandbox);vm.runInContext(compiled.code,sandbox);
 let scene={source:'dwg-engineering-interior',dwgRegion:1,width:8,depth:6,height:3.2,assets:[],openings:[],rooms:[{id:'scope',scopeOnly:true,polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}],footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],walls:[{id:'w',start:{x:6,y:0},end:{x:6,y:6},thickness:.15}]};
 const renderer={setFurnitureTool:v=>{tool=v;},setNamedView(){}};
 const props={getRenderer:()=>renderer,onCommit:async next=>{scene=next;},onCommitOpenings:async next=>{scene=next;}};
 const render=()=>{cursor=0;effects=[];const tree=sandbox.exports.default({...props,scene});effects.forEach(f=>f());return tree;};
 const nodes=(tree,type)=>{const found=[];function visit(v){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}if(v.type===type)found.push(v);visit(v.props?.children);}visit(tree);return found;};
 const content=node=>{const flatten=v=>Array.isArray(v)?v.map(flatten).join(''):typeof v==='object'&&v?flatten(v.props?.children):typeof v==='string'?v:'';return flatten(node);};
 const button=(tree,label)=>nodes(tree,'button').find(n=>content(n).includes(label));
 return {render,nodes,button,getTool:()=>tool,getScene:()=>scene};
}
test('actual panel switches from blocked DWG placement to review mode and saves a mouse-inserted door',async()=>{
 const ui=await panel();let tree=ui.render();ui.button(tree,'Furniture studio').props.onClick();tree=ui.render();
 ui.button(tree,'Indoor plant').props.onClick();tree=ui.render();
 assert.equal(ui.getTool().preview({x:6,y:3},{},{clientX:100}).valid,false);
 const free=ui.nodes(tree,'input').find(n=>n.props.type==='checkbox');free.props.onChange({target:{checked:true}});tree=ui.render();
 assert.equal(ui.getTool().preview({x:6,y:3},{},{clientX:100}).valid,true);
 ui.button(tree,'Place opening with mouse').props.onClick();tree=ui.render();
 await ui.getTool().commit({x:6,y:2},null,false,{clientX:100});tree=ui.render();
 assert.equal(ui.getScene().openings.length,1);assert.equal(ui.getScene().openings[0].wallId,'w');assert.equal(ui.getScene().openings[0].width,.9);
 assert.equal(ui.getScene().assets.length,0);
});
