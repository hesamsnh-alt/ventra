import * as categories from '../src/lib/furnitureCategories.mjs';
import * as walls from '../src/lib/manualWalls.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
import * as batch from '../src/lib/furnitureBatch.mjs';
import * as editor from '../src/lib/furnitureEditor.mjs';import * as openings from '../src/lib/manualOpenings.mjs';
const require=createRequire(import.meta.url);
async function panel(){
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();
 const compiled=await transform(readFileSync('src/app/projects/[id]/FurnitureEditorPanel.jsx','utf8'),{filename:'FurnitureEditorPanel.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const states=[];let cursor=0,effects=[],tool;
 const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef(initial){const i=cursor++;return states[i]||=( {current:initial});},useEffect(fn){effects.push(fn);}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
 const sandbox={window:{addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){}},exports:{},require:id=>id==='@/lib/furnitureCategories.mjs'?categories:id==='react'?react:id==='react/jsx-runtime'?jsx:id==='@/lib/furnitureEditor.mjs'?editor:id==='@/lib/manualOpenings.mjs'?openings:id==='@/lib/manualWalls.mjs'?walls:id==='@/lib/furnitureBatch.mjs'?batch:id==='@/app/components/i18n/LanguageProvider'?{useLanguage:()=>({language:'en'})}:id.endsWith('.css')?{}:id==='./ToolDrawer'?{default:'drawer'}:id==='./PersonalAssetLibrary'?{default:()=>null}:id==='@/lib/personalAssets.mjs'?{}:id==='@/services/personalAssetService'?{}:require(id)};
 vm.createContext(sandbox);vm.runInContext(compiled.code,sandbox);
 let scene={source:'dwg-engineering-interior',dwgRegion:1,width:8,depth:6,height:3.2,assets:[],openings:[],rooms:[{id:'scope',scopeOnly:true,polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}],footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],walls:[{id:'w',start:{x:6,y:0},end:{x:6,y:6},thickness:.15}]};
 const renderer={setFurnitureTool:v=>{tool=v;},setNamedView(){}};
 const props={getRenderer:()=>renderer,onCommit:async next=>{scene=next;},onCommitOpenings:async next=>{scene=next;},onCommitWalls:async next=>{scene=next;}};
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

test('actual panel draws a wall with two clicks, deletes a clicked wall and undoes it with its opening',async()=>{
 const ui=await panel();let tree=ui.render();ui.button(tree,'Furniture studio').props.onClick();tree=ui.render();
 ui.button(tree,'Add wall:').props.onClick();tree=ui.render();
 await ui.getTool().commit({x:2,y:1},{},false,{});tree=ui.render();
 assert.equal(ui.getTool().preview({x:2,y:5},{},{}).valid,true);
 await ui.getTool().commit({x:2,y:5},{},false,{});tree=ui.render();
 assert.equal(ui.getScene().walls.length,2);assert.equal(ui.getScene().walls[1].height,3.2);
 ui.button(tree,'Place opening with mouse').props.onClick();tree=ui.render();
 await ui.getTool().commit({x:6,y:2},null,false,{});tree=ui.render();
 ui.button(tree,'Delete wall:').props.onClick();tree=ui.render();
 await ui.getTool().commit({x:6,y:2},{},false,{});tree=ui.render();
 assert.equal(ui.getScene().walls.length,1);assert.equal(ui.getScene().openings.length,0);
 await ui.button(tree,'Undo wall edit').props.onClick();tree=ui.render();
 assert.equal(ui.getScene().walls.length,2);assert.equal(ui.getScene().openings.length,1);
 assert.equal(ui.getScene().assets.length,0);
});

test('actual panel supports drawing a wall in one drag gesture',async()=>{
 const ui=await panel();let tree=ui.render();ui.button(tree,'Add wall:').props.onClick();tree=ui.render();
 const data=ui.getTool().start(null,{x:2,y:1},{});
 assert.equal(ui.getTool().preview({x:2.06,y:5},data,{}).valid,true);
 await ui.getTool().commit({x:2.06,y:5},data,true,{});tree=ui.render();
 assert.equal(ui.getScene().walls.length,2);assert.equal(ui.getScene().walls.at(-1).start.x,2);assert.equal(ui.getScene().walls.at(-1).end.x,2);
});

 test('actual dropdown filters curtains and rugs and door choices use the real opening tool',async()=>{
 const ui=await panel();let tree=ui.render();ui.button(tree,'Furniture studio').props.onClick();tree=ui.render();
 const category=ui.nodes(tree,'select').find(n=>n.props.value==='all');category.props.onChange({target:{value:'curtains'}});tree=ui.render();
 assert.ok(ui.button(tree,'Pleated curtain'));assert.equal(ui.button(tree,'Indoor plant'),undefined);
 ui.nodes(tree,'select').find(n=>n.props.value==='curtains').props.onChange({target:{value:'rugs'}});tree=ui.render();assert.ok(ui.button(tree,'Persian rug'));
 ui.nodes(tree,'select').find(n=>n.props.value==='rugs').props.onChange({target:{value:'windows'}});tree=ui.render();
 ui.button(tree,'Wide window').props.onClick();tree=ui.render();await ui.getTool().commit({x:6,y:3},{},false,{});
 assert.equal(ui.getScene().openings[0].type,'window');assert.equal(ui.getScene().openings[0].width,2.4);assert.equal(ui.getScene().assets.length,0);
});

test('one model selection and one floor click add an entire sofa set through the actual panel',async()=>{
 const ui=await panel();let tree=ui.render();ui.button(tree,'Furniture studio').props.onClick();tree=ui.render();
 ui.nodes(tree,'select').find(n=>n.props.value==='all').props.onChange({target:{value:'sets'}});tree=ui.render();
 ui.button(tree,'Modern set · 6').props.onClick();tree=ui.render();
 assert.equal(ui.getTool().preview({x:3,y:3},{},{}).valid,true);await ui.getTool().commit({x:3,y:3},{},false,{});tree=ui.render();
 assert.equal(ui.getScene().assets.length,4);assert.equal(ui.getScene().assets.reduce((n,a)=>n+a.seatingCapacity,0),6);assert.equal(ui.getScene().assets.filter(a=>a.type==='coffee_table').length,1);
 await ui.button(tree,'Undo').props.onClick();assert.equal(ui.getScene().assets.length,0);
});

test('actual set-size slider updates floor preview and places resized components in one click',async()=>{
 const ui=await panel();let tree=ui.render();ui.button(tree,'Furniture studio').props.onClick();tree=ui.render();ui.nodes(tree,'select').find(n=>n.props.value==='all').props.onChange({target:{value:'sets'}});tree=ui.render();ui.button(tree,'Modern set · 6').props.onClick();tree=ui.render();
 const slider=ui.nodes(tree,'input').find(n=>n.props.type==='range');assert.ok(slider);slider.props.onChange({target:{value:'70'}});tree=ui.render();
 assert.equal(ui.nodes(tree,'input').find(n=>n.props.type==='range').props.value,70);const preview=ui.getTool().preview({x:3,y:3},{},{});assert.equal(preview.valid,true);assert.ok(preview.candidate.width<3.3);
 await ui.getTool().commit({x:3,y:3},{},false,{});tree=ui.render();assert.equal(ui.getScene().assets.length,4);assert.ok(ui.getScene().assets.every(a=>a.furnitureSetScale===.7));assert.ok(Math.abs(ui.getScene().assets[0].width-2.2*.7)<1e-9);
 ui.button(tree,'Original size').props.onClick();tree=ui.render();assert.equal(ui.nodes(tree,'input').find(n=>n.props.type==='range').props.value,100);
});
