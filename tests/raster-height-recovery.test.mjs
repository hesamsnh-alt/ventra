import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileRasterMeasurements,confirmRasterWallHeight,formatRasterAuditNumber} from '../src/lib/rasterMeasurementAudit.mjs';
const saved=JSON.parse(readFileSync('tests/fixtures/raster-missing-height-20261106.json'));
test('actual second screenshot does not claim wall-face validation when the model omitted the printed height',()=>{
 const t=reconcileRasterMeasurements(structuredClone(saved));
 assert.equal(t.floor_area,46.5225);assert.equal(t.raster_measurement_audit.wallMeasurementStatus,'height_required');
 assert.equal(t.raster_measurement_audit.netInternalWall,undefined);assert.equal(t.wall_area,115.35);
 assert.deepEqual(reconcileRasterMeasurements(t),t);
});
for(const height of [2.4,2.8,3,4.1])test(`height confirmation ${height} uses room perimeter faces and tagged count-unit opening dimensions`,()=>{
 const t=confirmRasterWallHeight(structuredClone(saved),height);
 assert.equal(t.wall_area,Math.round(47.1*height*1e6)/1e6);
 assert.equal(t.raster_measurement_audit.netInternalWall.value,Math.round((47.1*height-5.67-3.78-5.04)*1e6)/1e6);
 assert.equal(t.wall_height_source,'user_confirmed_printed_dimension');assert.equal(saved.wall_area,115.35);
 assert.equal(t.raster_measurement_audit.wallMeasurementStatus,'computed');
 assert.deepEqual(reconcileRasterMeasurements(t),t);
});
test('typed printed height survives in a fresh extraction without relying on prose notes or a centerline-area ratio',()=>{
 const t=reconcileRasterMeasurements({...saved,wall_height:3,wall_height_evidence:'All clear room heights: 3.00 m.'});
 assert.equal(t.wall_area,141.3);assert.equal(t.raster_measurement_audit.netInternalWall.value,126.81);
});
test('a user correction replaces the saved height arithmetic while retaining previous claims for review',()=>{
 const t=confirmRasterWallHeight(confirmRasterWallHeight(saved,2.8),3);
 assert.equal(t.wall_area,141.3);assert.equal(t.raster_measurement_audit.netInternalWall.value,126.81);
 assert.ok(t.raster_measurement_audit.corrections.some(c=>c.key==='wall_area'&&c.reported===115.35));
});
for(const n of [0,-1,'','abc',NaN,Infinity])test(`invalid height ${n} cannot generate a wall quantity`,()=>assert.throws(()=>confirmRasterWallHeight(saved,n)));
test('missing or contradictory opening sizes never fabricate a net finish area',()=>{
 const t=structuredClone(saved);t.detected_items.find(i=>i.name==='Door D0').description='Door size unavailable';
 assert.equal(confirmRasterWallHeight(t,3).raster_measurement_audit.netInternalWall,undefined);
});
test('audit display rounds binary floating point and does not call a rounded observation a new arithmetic correction',()=>{
 assert.equal(formatRasterAuditNumber(46.522499999999994),'46.5225');assert.equal(formatRasterAuditNumber(12.8975),'12.8975');
 assert.equal(formatRasterAuditNumber(undefined),'—');
});
import {drawingTakeoffMatches,resolveDrawingSelection} from '../src/lib/drawingSelection.mjs';
test('reuploading the same filename cannot display deleted-document analysis or a different selected source',()=>{
 const documents=[{id:'new-upload',file_name:'plan.png'}],old={document_id:'deleted-upload',document_name:'plan.png'};
 const id=resolveDrawingSelection(documents,'deleted-upload',old.document_id);
 assert.equal(id,'new-upload');assert.equal(drawingTakeoffMatches(old,documents[0]),false);
 assert.equal(drawingTakeoffMatches({...old,document_id:'new-upload'},documents[0]),true);
 assert.equal(drawingTakeoffMatches(null,documents[0]),false);
});
