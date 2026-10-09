// Optional renderer check against the same Three.js r71 geometry API used by APS.
// Usage: node scripts/verify-raster-renderer.mjs /absolute/path/to/three/three.js
// Optional second argument: directory containing the untouched baseline source.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import parser from "@babel/parser";
import { compileRasterFloorplan } from "../src/lib/rasterFloorplanGeometry.mjs";

const require = createRequire(import.meta.url);
if (!process.argv[2]) throw new Error("Pass the local path to the Three.js r71 module.");
const THREE = require(process.argv[2]);
assert.equal(String(THREE.REVISION), "71");
const viewerPath = "src/app/projects/[id]/Project3DViewer.jsx";
const source = readFileSync(new URL(`../${viewerPath}`, import.meta.url), "utf8");
function loadViewer(code) {
  const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx"] });
  const functions = ast.program.body.filter((n) => n.type === "FunctionDeclaration").map((n) => code.slice(n.start, n.end)).join("\n");
  const sandbox = { THREE, console: { log() {}, warn() {}, error() {} }, VENTRA_SCHEMATIC_ROOT_NAME: "raster-test" };
  vm.createContext(sandbox); vm.runInContext(functions, sandbox);
  sandbox.getThree = () => THREE;
  sandbox.clearSchematicOverlay = () => {};
  // Textures/finish patterns require a browser canvas, but do not set geometry.
  sandbox.ventraCreateRoomFloorMaterial = () => new THREE.MeshBasicMaterial();
  sandbox.ventraAddVisibleFloorPattern = () => {};
  return sandbox;
}
const context = loadViewer(source);
const p = (x, y) => ({ x, y });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const material = new THREE.MeshBasicMaterial();
function meshArea(mesh) {
  const { vertices, faces } = mesh.geometry;
  return faces.reduce((total, f) => {
    const a = vertices[f.a], b = vertices[f.b], c = vertices[f.c];
    return total + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }, 0);
}
const concave = [p(0, 0), p(8, 0), p(8, 4), p(4, 4), p(4, 8), p(0, 8)];
close(meshArea(context.ventraBuildTracedRasterFloor({ THREE, polygon: concave, material }).mesh), 48);
const footprint = [p(0, 0), p(8, 0), p(8, 8), p(0, 8)];
close(meshArea(context.ventraBuildTracedRasterFloor({ THREE, polygon: footprint, holes: [[p(2, 2), p(4, 2), p(4, 4), p(2, 4)]], material }).mesh), 60);

const points = [p(100, 100), p(900, 100), p(900, 900), p(100, 900)];
const raw = {
  title: "Renderer fixture", confidence: 0.9, wallHeightMeters: 4.1,
  measurements: [{ id: "m", text: "8m", axis: "horizontal", start: p(100, 50), end: p(900, 50), meters: 8 }],
  footprint: points, holes: [], rooms: [{ id: "a", name: "A", type: "room", polygon: points }],
  walls: points.map((start, i) => ({ id: `w${i}`, type: "external", start, end: points[(i + 1) % points.length] })),
  openings: [
    { id: "window", type: "window", wallId: "w0", start: p(101, 100), end: p(136, 100), heightMeters: 0.3, sillHeightMeters: 0.2, hingeSide: "unknown", swingDirection: "unknown" },
    { id: "door", type: "door", wallId: "w1", start: p(900, 300), end: p(900, 500), heightMeters: 2.7, sillHeightMeters: 0, hingeSide: "end", swingDirection: "counterclockwise" },
  ],
};
const scene = compileRasterFloorplan(raw, { imageWidth: 1000, imageHeight: 1000 });
const world = new THREE.Scene();
const rendered = context.renderStructuredSchematicScene({ impl: { sceneAfter: world, invalidate() {} } }, scene);
close(rendered.height, 4.1); close(rendered.width, 8); assert.equal(rendered.openingCount, 2);
const found = {};
world.traverse((mesh) => { if (mesh.userData?.ventraType) (found[mesh.userData.ventraType] ||= []).push(mesh); });
const glass = found.schematic_window_glass[0];
close(glass.geometry.parameters.width, 0.35);
close(glass.geometry.parameters.depth, 0.3);
close(glass.position.x, -3.815);
close(glass.position.z, 0.35);
const door = found.schematic_door_panel[0];
close(door.geometry.parameters.depth, 2.7);
close(door.rotation.z, Math.PI / 2 + Math.PI / 3);

const smallGap = context.splitWallByOpenings({ start: p(0, 0), end: p(1, 0), minimumWallPiece: 0.001, preserveRasterTrace: true, openings: [{ width: 0.08, wallPosition: p(0.06, 0) }] });
close(smallGap[0].end.x, 0.02); close(smallGap[1].start.x, 0.10);
assert.equal(context.ventraCreateDoorLeafVisual({ THREE, material, opening: { preserveRasterTrace: true, start: p(0, 0), end: p(1, 0), height: 2.1, hinge: "unknown", swing: "unknown" } }), null);

let legacyComparison = "not_requested";
if (process.argv[3]) {
  const baseline = loadViewer(readFileSync(`${process.argv[3]}/${viewerPath}`, "utf8"));
  for (const width of [0.05, 0.35, 0.9, 2.4]) for (const center of [0, 0.1, 1, 2]) {
    const args = { start: p(0, 0), end: p(2, 0), openings: [{ width, wallPosition: p(center, 0) }] };
    assert.equal(JSON.stringify(context.splitWallByOpenings(args)), JSON.stringify(baseline.splitWallByOpenings(args)));
  }
  const digest = (mesh) => mesh ? JSON.stringify({ parameters: mesh.geometry.parameters, position: mesh.position }) : null;
  for (const sillHeight of [0, 0.04, 0.06, 0.9]) {
    const args = { THREE, material, thickness: 0.18, wallHeight: 2.8, zBase: 0, opening: { type: "window", start: p(0, 0), end: p(1, 0), sillHeight, height: 1.2 } };
    assert.equal(digest(context.buildWindowSillWallMesh(args)), digest(baseline.buildWindowSillWallMesh(args)));
    assert.equal(digest(context.buildHeaderWallMesh(args)), digest(baseline.buildHeaderWallMesh(args)));
  }
  legacyComparison = "passed_24_legacy_cases";
}
console.log(JSON.stringify({ threeRevision: THREE.REVISION, concaveArea: 48, floorAreaWithHole: 60, narrowOpeningAndOffset: "passed", windowVerticalDimensions: "passed", tallDoorAndCounterclockwiseSwing: "passed", smallWallJamb: "passed", unknownSwingNotInvented: "passed", legacyComparison }));
