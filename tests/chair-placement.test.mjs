import {canonicalRoomType} from "../src/lib/roomSemantics.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/app/api/ai/design-3d-preview/route.js', import.meta.url), 'utf8');
const sandbox = { canonicalRoomType, process: { env: {} } };
vm.createContext(sandbox);
vm.runInContext(source.replace(/^import .*;\n/gm, '').split('function parseJson')[0] +
  '\nthis.helpers = { furnishRoom, diningChairCandidates, assetBox, pointInPolygon };', sandbox);
const { furnishRoom, diningChairCandidates, assetBox, pointInPolygon } = sandbox.helpers;

function clearOfTable(chair, table) {
  const a = assetBox(chair), b = assetBox(table);
  return a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY;
}

test('uploaded kitchen/dining shape places chairs around its 1.55 m table', () => {
  // Coordinates from the 2026-09-26 reported scene. The long lower edge is
  // the supported kitchen counter wall; dining occupies the open upper zone.
  const room = { id: 'kitchenDining', name: 'KITCHEN & DINING', type: 'living',
    semanticType: 'kitchen_dining', polygon: [
      { x: 3.590308630393996, y: 4.7025 }, { x: 8.011271575984988, y: 4.7025 },
      { x: 8.011271575984988, y: 2.5882768924302786 }, { x: 9.506920731707318, y: 2.5882768924302786 },
      { x: 9.506920731707318, y: 0.0475 }, { x: 3.5683137898686668, y: 0.0475 },
      { x: 3.5683137898686668, y: 2.847918326693227 },
    ] };
  const walls = [{ id: 'counter-wall', type: 'external', start: { x: 3.5683137898686668, y: 0.0475 },
    end: { x: 9.506920731707318, y: 0.0475 } }];
  const assets = furnishRoom(room, { walls, openings: [] });
  const table = assets.find(a => a.type === 'dining_table');
  const chairs = assets.filter(a => a.type === 'chair');
  assert.ok(table, 'the room has a dining table');
  assert.ok(chairs.length >= 2, 'chairs surround the actual scene table');
  for (const chair of chairs) {
    assert.ok(clearOfTable(chair, table), 'chair footprint does not overlap table');
    const box = assetBox(chair, 0.04);
    for (const corner of [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]) {
      assert.ok(pointInPolygon(corner, room.polygon), 'chair stays inside room polygon');
    }
  }
});

test('chairs follow a rotated table with dimensions rather than fixed offsets', () => {
  const room = { id: 'd', type: 'dining', polygon: [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
  ] };
  const table = { type: 'dining_table', roomId: 'd', xMeters: 2, yMeters: 2,
    width: 2.1, depth: 0.75, rotation: 90 };
  const chairs = diningChairCandidates(table);
  assert.equal(chairs.length, 4);
  for (const chair of chairs) {
    assert.ok(clearOfTable(chair, table), 'rotated chair clears the rotated table');
    const box = assetBox(chair, 0.04);
    assert.ok(pointInPolygon({ x: box.minX, y: box.minY }, room.polygon));
    assert.ok(pointInPolygon({ x: box.maxX, y: box.maxY }, room.polygon));
  }
  const furnished = furnishRoom(room);
  assert.ok(furnished.filter(a => a.type === 'chair').length >= 2);
});
