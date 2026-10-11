import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {indexedDB} from "fake-indexeddb";
import {saveSchematic,readSchematic,saveActiveSource} from "../src/lib/schematicStorage.mjs";
globalThis.indexedDB=indexedDB;
import { compileRasterFloorplan, rasterFloorplanSchema, rasterPixelTraceSchema, normalizeRasterPixelTrace } from "../src/lib/rasterFloorplanGeometry.mjs";

const p = (x, y) => ({ x, y });
const box = [p(100, 100), p(900, 100), p(900, 900), p(100, 900)];
const size = { imageWidth: 1000, imageHeight: 1000 };
const wallLoop = (poly) => poly.map((start, i) => ({ id: `w${i}`, type: "external", start, end: poly[(i + 1) % poly.length] }));
function fixture(poly = box) {
  return JSON.parse(JSON.stringify({
    title: "Synthetic geometry fixture", confidence: 0.9, wallHeightMeters: null,
    measurements: [{ id: "m1", text: "8.00 m", axis: "horizontal", start: p(100, 50), end: p(900, 50), meters: 8 }],
    footprint: poly, rooms: [{ id: "r1", name: "Zone A", type: "room", polygon: poly }],
    walls: wallLoop(poly), holes: [], openings: [],
  }));
}
function opening(overrides = {}) {
  return { id: "o1", type: "window", wallId: "w0", start: p(110, 100), end: p(145, 100), heightMeters: null, sillHeightMeters: null, hingeSide: "unknown", swingDirection: "unknown", ...overrides };
}
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const rejectCode = (raw, code) => assert.throws(() => compileRasterFloorplan(raw, size), (e) => e.code === code);

test("pixel tracing survives non-square images and image resizing without moving any layer", () => {
  const normalized = fixture();
  normalized.openings = [opening()];
  for (const [imageWidth, imageHeight] of [[957, 709], [1914, 1418]]) {
    const dimensions = { imageWidth, imageHeight };
    const pixelize = (value) => {
      if (Array.isArray(value)) return value.map(pixelize);
      if (value && typeof value === "object") {
        if (Object.keys(value).length === 2 && "x" in value && "y" in value) return p(value.x * imageWidth / 1000, value.y * imageHeight / 1000);
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, pixelize(v)]));
      }
      return value;
    };
    const input = { ...pixelize(normalized), ...dimensions, coordinateSpace: "image_pixels" };
    const snapshot = structuredClone(input);
    const actual = compileRasterFloorplan(normalizeRasterPixelTrace(input, dimensions), dimensions);
    const expected = compileRasterFloorplan(normalized, dimensions);
    close(actual.width, expected.width); close(actual.depth, expected.depth);
    for (const key of ["rooms", "walls", "openings", "footprint"]) {
      assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected[key]));
    }
    assert.deepEqual(input, snapshot);
  }
});

test("wrong pixel frame and out-of-image points fail instead of silently rescaling", () => {
  const raw = { ...fixture(), ...size, coordinateSpace: "image_pixels" };
  for (const changes of [{ imageWidth: 900 }, { coordinateSpace: "normalized" }]) {
    assert.throws(() => normalizeRasterPixelTrace({ ...raw, ...changes }, size), (e) => e.code === "COORDINATE_FRAME_MISMATCH");
  }
  raw.openings = [opening({ end: p(1001, 100) })];
  assert.throws(() => normalizeRasterPixelTrace(raw, size), (e) => e.code === "INVALID_COORDINATE");
});

test("the actual rejected report stays rejected and exposes numerical diagnostic residuals", () => {
  const report = JSON.parse(readFileSync(new URL("fixtures/rejected-raster-20260916.json", import.meta.url), "utf8"));
  assert.throws(() => compileRasterFloorplan(report.trace, report), (e) => {
    assert.equal(e.code, "CONFLICTING_SCALE");
    assert.ok(e.details.scaleSkew > 0.10);
    assert.equal(e.details.measurements.length, 33);
    assert.ok(e.details.measurements.every((m) => Number.isFinite(m.tracedMeters) && Number.isFinite(m.errorMeters)));
    return true;
  });
  // Isolate topology from contradictory annotations in this test only.
  const topology = structuredClone(report.trace);
  topology.measurements = topology.measurements.slice(0, 1);
  assert.throws(() => compileRasterFloorplan(topology, report), (e) => e.code === "WALL_CROSSES_ROOM");
});

test("the former accepted fixture is rejected when its printed dimensions contradict one uniform image scale", () => {
  const report = JSON.parse(readFileSync(new URL("fixtures/accepted-raster-20260916.json", import.meta.url), "utf8"));
  const trace = normalizeRasterPixelTrace(report.rawPixelTrace, report);
  const before=JSON.stringify(trace);
  assert.throws(()=>compileRasterFloorplan(trace,report),error=>error.code==='CONFLICTING_SCALE'&&error.details.conflictingIds.length>0);
  assert.equal(JSON.stringify(trace),before);
});

test("strict schema requires every property recursively", () => {
  function visit(schema) {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
      Object.values(schema.properties).forEach(visit);
    }
    if (schema.items) visit(schema.items);
  }
  visit(rasterFloorplanSchema);
  visit(rasterPixelTraceSchema);
});

test("one printed dimension uses actual image pixel aspect, with one Y flip", () => {
  const raw = fixture(); raw.measurements[0].meters = 12;
  const scene = compileRasterFloorplan(raw, { imageWidth: 1200, imageHeight: 800 });
  close(scene.width, 12); close(scene.depth, 8);
  close(scene.walls[0].start.x, 0); close(scene.walls[0].start.y, 8);
  close(scene.walls[0].end.x, 12); close(scene.walls[0].end.y, 8);
  assert.deepEqual(scene.assets, []);
  assert.equal(scene.geometryValidation.imageAgreement, "requires_visual_review");
});

test("missing and contradictory scale evidence are not guessed", () => {
  const raw = fixture(); raw.measurements = [];
  rejectCode(raw, "MISSING_SCALE_EVIDENCE");
  raw.measurements = fixture().measurements;
  raw.measurements.push({ id: "m2", text: "8 m", axis: "horizontal", start: p(100, 50), end: p(500, 50), meters: 8 });
  rejectCode(raw, "CONFLICTING_DIMENSIONS");
});

test("both printed axes use one shared global transform", () => {
  const raw = fixture(); raw.measurements[0].meters = 8.16;
  raw.measurements.push({ id: "m2", text: "8 m", axis: "vertical", start: p(50, 100), end: p(50, 900), meters: 8 });
  const scene = compileRasterFloorplan(raw, size);
  close(scene.width, 8.08); close(scene.depth, 8.08);
  assert.equal(scene.geometryValidation.scaleMode,"uniform_pixel_scale_all_evidence");
  close(scene.rooms[0].polygon[1].x, scene.walls[0].end.x);
  raw.measurements[1].meters = 1;
  rejectCode(raw, "CONFLICTING_SCALE");
});

test("a concave footprint and its notch are preserved verbatim", () => {
  const poly = [p(100, 100), p(900, 100), p(900, 500), p(500, 500), p(500, 900), p(100, 900)];
  const raw = fixture(poly); const snapshot = structuredClone(raw);
  const scene = compileRasterFloorplan(raw, size);
  assert.equal(scene.footprint.length, 6);
  assert.deepEqual(scene.footprint, [p(0, 8), p(8, 8), p(8, 4), p(4, 4), p(4, 0), p(0, 0)]);
  assert.deepEqual(raw, snapshot, "compiler must not mutate source evidence");
  raw.walls.push({ id: "bridge", type: "external", start: p(500, 900), end: p(900, 100) });
  rejectCode(raw, "WALL_OUTSIDE_FOOTPRINT");
});

test("rotated walls are not rectified to horizontal or vertical", () => {
  const angle = Math.PI / 18;
  const rotate = ({ x, y }) => p(500 + (x - 500) * Math.cos(angle) - (y - 500) * Math.sin(angle), 500 + (x - 500) * Math.sin(angle) + (y - 500) * Math.cos(angle));
  const poly = [p(200, 200), p(800, 200), p(800, 800), p(200, 800)].map(rotate);
  const raw = fixture(poly);
  raw.measurements = [{ id: "a", text: "6 m", axis: "aligned", start: poly[0], end: poly[1], meters: 6 }];
  const scene = compileRasterFloorplan(raw, size), wall = scene.walls[0];
  close(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y), 6);
  close(Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x), -angle);
});

test("real polygon overlap permits concave adjacent rooms despite overlapping bounding boxes", () => {
  const raw = fixture();
  raw.rooms = [
    { id: "a", name: "A", type: "room", polygon: [p(100, 100), p(900, 100), p(900, 500), p(500, 500), p(500, 900), p(100, 900)] },
    { id: "b", name: "B", type: "room", polygon: [p(500, 500), p(900, 500), p(900, 900), p(500, 900)] },
  ];
  raw.walls.push({ id: "i1", type: "internal", start: p(500, 500), end: p(900, 500) }, { id: "i2", type: "internal", start: p(500, 500), end: p(500, 900) });
  assert.equal(compileRasterFloorplan(raw, size).rooms.length, 2);
});

test("identical room polygons cannot count as two real spaces", () => {
  const raw = fixture(); raw.rooms.push({ ...structuredClone(raw.rooms[0]), id: "r2" });
  rejectCode(raw, "OVERLAPPING_ROOMS");
});

test("self-intersection, missing exterior and walls across room interiors are rejected", () => {
  const raw = fixture(); raw.footprint = [p(100, 100), p(900, 850), p(100, 900), p(800, 100)];
  rejectCode(raw, "SELF_INTERSECTING_POLYGON");
  const missing = fixture(); missing.walls.pop();
  rejectCode(missing, "INCOMPLETE_EXTERIOR");
  const crossing = fixture(); crossing.walls.push({ id: "split", type: "internal", start: p(500, 100), end: p(500, 900) });
  rejectCode(crossing, "WALL_CROSSES_ROOM");
});

test("narrow and edge-adjacent openings keep both jambs and the measured width", () => {
  const raw = fixture(); raw.openings = [opening()];
  const scene = compileRasterFloorplan(raw, size), o = scene.openings[0];
  close(o.width, 0.35); close(o.offset, 0.034375);
  assert.equal(o.wallId, "w0");
});

test("openings are never reassigned, moved across rooms, clipped or overlapped", () => {
  const missing = fixture(); missing.openings = [opening({ wallId: "missing" })];
  rejectCode(missing, "OPENING_WALL_MISSING");
  const off = fixture(); off.openings = [opening({ start: p(110, 150), end: p(145, 150) })];
  rejectCode(off,'OPENING_OFF_WALL');
  const outside = fixture(); outside.openings = [opening({ start: p(50, 100) })];
  rejectCode(outside,'OPENING_OUTSIDE_WALL');
  const duplicate = fixture(); duplicate.openings = [opening(), opening({ id: "o2" })];
  rejectCode(duplicate,'OVERLAPPING_OPENINGS');

});

test("duplicate shared walls are removed and reversed parent hinge references are preserved", () => {
  const raw = fixture(); raw.walls.push({ ...structuredClone(raw.walls[0]), id: "w4", start: box[1], end: box[0] });
  raw.openings = [opening({ wallId: "w4", type: "door", hingeSide: "start", swingDirection: "counterclockwise" })];
  const scene = compileRasterFloorplan(raw, size);
  assert.equal(scene.walls.length, 4);
  assert.equal(scene.openings[0].wallId, "w0"); assert.equal(scene.openings[0].hinge, "end");
});

test("room clipping, point truncation and invented footprint repairs are forbidden", () => {
  const raw = fixture(); raw.rooms[0].polygon[0] = p(50, 100);
  rejectCode(raw, "ROOM_OUTSIDE_FOOTPRINT");
  const invalid = fixture(); invalid.walls[0].start.x = null;
  rejectCode(invalid, "INVALID_COORDINATE");
});

test("floor holes cannot erase valid room area", () => {
  const raw = fixture(); raw.holes = [{ id: "shaft", type: "shaft", polygon: [p(200, 200), p(300, 200), p(300, 300), p(200, 300)] }];
  rejectCode(raw, "HOLE_OVERLAPS_ROOM");
});

test("no reference-plan size limits or width fallback is applied", () => {
  const raw = fixture(); raw.measurements[0].meters = 120;
  const scene = compileRasterFloorplan(raw, size);
  close(scene.width, 120); close(scene.depth, 120);
});

test("a wall cannot cross a small room even when its whole-wall midpoint is elsewhere", () => {
  const raw = fixture();
  raw.rooms[0].polygon = [p(100, 100), p(900, 100), p(900, 300), p(100, 300)];
  raw.walls.push({ id: "lower", type: "internal", start: p(100, 300), end: p(900, 300) });
  raw.walls.push({ id: "crossing", type: "internal", start: p(200, 100), end: p(200, 900) });
  rejectCode(raw, "WALL_CROSSES_ROOM");
});

test("recompiling identical trace evidence produces identical geometry", () => {
  const raw = fixture(); raw.openings = [opening()];
  assert.deepEqual(compileRasterFloorplan(raw, size), compileRasterFloorplan(raw, size));
});

const controller = readFileSync(new URL("../src/app/projects/[id]/ProjectDrawingCenter.jsx", import.meta.url), "utf8");
const generationSource = controller.slice(controller.indexOf("async function generateImageSchematic3DUncoalesced("), controller.indexOf("\n  function validateFile(", controller.indexOf("async function generateImageSchematic3DUncoalesced(")));

test("a failed raster request stops quiet Analyze and leaves existing persistence untouched", async () => {
  const writes = [];
  const sandbox = {
    crypto:{randomUUID:()=> 'test-request'},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}, window: { dispatchEvent(){},localStorage: { setItem: (...args) => writes.push(args) } },
    projectId: "test-project", getFileExtension: () => "png", downloadProjectDocument: async () => ({ url: "https://example.invalid/fixture.png" }),
    ventraFetchWithTransientRetry: async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ error: "Opening is off its wall" }) }),
    console: { error() {}, warn() {} }, setMessage() {}, setErrorMessage() {}, setRasterReview() {}, updateRasterReview() {}, getRasterReview:()=>null,
  };
  vm.createContext(sandbox); vm.runInContext(generationSource, sandbox);
  await assert.rejects(sandbox.generateImageSchematic3DUncoalesced({ id: "d1", file_name: "fixture.png" }, { quiet: true }), /Opening is off its wall.*No new 3D scene was saved/);
  assert.deepEqual(writes, []);
});

test("successful raster Analyze commits scene and original before publishing the source event", async () => {
  const writes = [];
  const scene = compileRasterFloorplan(fixture(), size);
  const storage={setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem(){}};
  const sandbox = {
    applyDesignDefaults: (await import('../src/lib/designDefaults.mjs')).applyDesignDefaults,
    drawingSceneMatches:()=>true,
    saveSchematic:(id,scene,options)=>saveSchematic(id,scene,{...options,storage}),
    saveActiveSource:(id,source)=>saveActiveSource(id,source,{storage}),
    crypto:{randomUUID:()=> 'test-request'},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}, window: { dispatchEvent(){},localStorage: { setItem: (...args) => writes.push(args) } },
    projectId: "test-project", getFileExtension: () => "png", downloadProjectDocument: async () => ({ url: "https://example.invalid/fixture.png" }),
    ventraFetchWithTransientRetry: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ scene }) }),
    console: { error() {}, warn() {} }, setMessage() {}, setErrorMessage() {}, setRasterReview() {}, updateRasterReview() {}, getRasterReview:()=>null,
  };
  vm.createContext(sandbox); vm.runInContext(generationSource, sandbox);
  const result = await sandbox.generateImageSchematic3DUncoalesced({ id: "d1", file_name: "fixture.png" }, { quiet: true });
  assert.equal(result.rasterGeometryVersion, scene.rasterGeometryVersion);
  assert.deepEqual(await readSchematic("test-project","schematic3d",{storage}),JSON.parse(JSON.stringify(result)));
  assert.deepEqual(await readSchematic("test-project","schematic3d-base",{storage}),JSON.parse(JSON.stringify(result)));
  assert.ok(writes.every(([,value])=>value.length<200));
});


test("axis disagreement is rejected in both directions", () => {
  for (const meters of [6, 11]) {
    const raw = fixture();
    raw.measurements.push({ id: "m2", text: `${meters} m`, axis: "vertical", start: p(50, 100), end: p(50, 900), meters });
    rejectCode(raw, "CONFLICTING_SCALE");
  }
});

test("dimension conflicts retain every residual for reproducible diagnosis", () => {
  const raw = fixture();
  raw.measurements.push({ id: "m2", text: "8 m", axis: "horizontal", start: p(100, 50), end: p(500, 50), meters: 8 });
  assert.throws(() => compileRasterFloorplan(raw, size), (error) => {
    assert.equal(error.code, "CONFLICTING_DIMENSIONS");
    assert.equal(error.details.measurements.length, 2);
    assert.ok(error.details.conflictingIds.length > 0);
    assert.ok(error.details.measurements.every((m) => Number.isFinite(m.tracedMeters)));
    return true;
  });
});
