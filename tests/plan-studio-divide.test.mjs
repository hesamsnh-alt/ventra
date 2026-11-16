import assert from 'node:assert/strict';
import test from 'node:test';
import {clickPoint,editorState,snappedPoint,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {boxSelection} from '../src/lib/planStudio/boxSelection.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {dividePath} from '../src/lib/planStudio/dividePath.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {importDxf,readDxf} from '../src/lib/planStudio/importDxf.mjs';
import {entitySVG} from '../src/lib/planStudio/render2d.mjs';

const p=(x,y)=>({x,y});

test('DIVIDE creates one marker at each equal arc-length interval without changing the source',()=>{
 const circle={id:'source',layer:'architecture',type:'circle',center:p(0,0),radius:2,start:0,sweep:2*Math.PI};
 const doc={...newDocument(),entities:[circle]};
 let state=startCommand(editorState(doc),'DIV');
 state=clickPoint(state,p(2,0),{raw:true});
 assert.equal(state.phase,'segments');
 assert.throws(()=>submit(state,'1'),/2 to 2000/);
 state=submit(state,'۶');
 const [source,...points]=state.doc.entities;
 assert.deepEqual(source,circle);
 assert.equal(points.length,6);
 assert.equal(points[0].type,'point');
 assert.deepEqual(points[0].position,p(2,0));
 for(const point of points)assert.ok(Math.abs(Math.hypot(point.position.x,point.position.y)-2)<1e-9);
 assert.deepEqual(startCommand(state,'UNDO').doc,doc);
 const markersOnly={...state,doc:{...state.doc,entities:points}};
 assert.deepEqual(snappedPoint(markersOnly,p(2.04,.02)),p(2,0));
 assert.deepEqual(boxSelection(state.doc,p(1.9,-.1),p(2.1,.1)),[points[0].id]);
});

test('DIVIDE measures around polyline bends and signed arcs, skipping endpoints on open paths',()=>{
 const path={type:'polyline',points:[p(0,0),p(3,0),p(3,5)]};
 assert.deepEqual(dividePath(path,4),[p(2,0),p(3,1),p(3,3)]);
 const arc={type:'arc',center:p(0,0),start:Math.PI/2,sweep:-Math.PI/2,radius:1};
 assert.deepEqual(dividePath(arc,2),[p(Math.cos(Math.PI/4),Math.sin(Math.PI/4))]);
 assert.deepEqual(dividePath({type:'line',a:p(0,0),b:p(4,0)},2),[p(2,0)]);
});

test('PTYPE changes the visible style and POINT entities and their elevation round-trip through DXF',()=>{
 const marker={id:'marker',layer:'architecture',type:'point',position:p(1,2),z:3};
 const doc={...newDocument(),entities:[marker]};
 const {doc:styled}=submit(startCommand(editorState(doc),'PTYPE'),'circle-cross');
 assert.equal(styled.pointStyle,'circle-cross');
 assert.match(entitySVG(styled,marker,{screen:true,unitsPerPixel:.02}),/data-plan-point="circle-cross"/);
 const {doc:imported,skipped}=importDxf(readDxf(exportDXF(styled)),'Points');
 assert.equal(imported.pointStyle,'circle-cross');
 assert.equal(imported.entities[0].type,'point');
 assert.deepEqual(imported.entities[0].position,p(1,2));
 assert.equal(imported.entities[0].z,3);
 assert.equal(skipped.size,0);
});
