import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {normalizeRasterPixelTrace,rasterPixelTraceSchemaForImage,rasterPixelTraceSchema} from '../src/lib/rasterFloorplanGeometry.mjs';
import {shouldRetryRasterGeometry} from '../src/lib/rasterVisionRequest.mjs';
import {rasterCoordinateReference} from '../src/lib/rasterCoordinateReference.mjs';

test('request schema binds every coordinate and frame to the prepared image, independently for each request', () => {
  const before = JSON.stringify(rasterPixelTraceSchema);
  for (const [width,height] of [[2200,679],[632,2048],[640,640]]) {
    const schema = rasterPixelTraceSchemaForImage(width,height);
    assert.deepEqual(schema.properties.imageWidth.enum,[width]);
    assert.deepEqual(schema.properties.imageHeight.enum,[height]);
    const points = [schema.properties.footprint.items,schema.properties.rooms.items.properties.polygon.items,schema.properties.holes.items.properties.polygon.items];
    for(const collection of ['walls','openings','measurements']) for(const endpoint of ['start','end'])points.push(schema.properties[collection].items.properties[endpoint]);
    for(const point of points){
      assert.equal(point.properties.x.minimum,0); assert.equal(point.properties.x.maximum,width);
      assert.equal(point.properties.y.minimum,0); assert.equal(point.properties.y.maximum,height);
    }
  }
  assert.equal(JSON.stringify(rasterPixelTraceSchema),before);
});

test('invalid prepared image dimensions fail before a model request can be built',()=>{
  for(const size of [0,-1,NaN,Infinity,1.5])assert.throws(()=>rasterPixelTraceSchemaForImage(size,632),{code:'IMAGE_SIZE_UNAVAILABLE'});
});

test('observed live failure identifies the exact out-of-image dimension endpoint without clamping it', () => {
  const report = JSON.parse(fs.readFileSync(new URL('./fixtures/raster-failed-live-20261107.json', import.meta.url)));
  const before = JSON.stringify(report);
  assert.throws(() => normalizeRasterPixelTrace(report.rawPixelTrace, report), error => {
    assert.equal(error.code, 'INVALID_COORDINATE');
    assert.deepEqual(error.details, {path:'measurements[14].end',point:{x:2214,y:545},imageWidth:2200,imageHeight:679});
    assert.equal(shouldRetryRasterGeometry(error), true);
    return true;
  });
  assert.equal(JSON.stringify(report), before);
});

test('coordinate frame mistakes qualify for bounded correction, provider failures do not', () => {
  assert.equal(shouldRetryRasterGeometry({code:'COORDINATE_FRAME_MISMATCH'}), true);
  for (const code of ['RASTER_VISION_TIMEOUT','RASTER_VISION_OUTPUT_LIMIT','RASTER_VISION_TRANSPORT']) assert.equal(shouldRetryRasterGeometry({code}), false);
});

for (const [width, height] of [[2200,679],[679,2200],[640,640]]) test(`ruler preserves source pixel frame ${width}x${height}`, async () => {
  const source = await sharp({create:{width,height,channels:3,background:'#fff'}}).png().toBuffer();
  const before = Buffer.from(source);
  const reference = await rasterCoordinateReference(source, width, height);
  assert.deepEqual(source, before);
  const encoded = Buffer.from(reference.image_url.split(',')[1], 'base64');
  const metadata = await sharp(encoded).metadata();
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  const stats = await sharp(encoded).stats();
  assert.ok(stats.channels.some(channel => channel.min < 200));
});
