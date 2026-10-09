import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import parser from '@babel/parser';

const require = createRequire(import.meta.url);
const THREE = require(process.env.VENTRA_THREE_TEST_MODULE || 'three-test');
const source = readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx', import.meta.url), 'utf8');
const ast = parser.parse(source, {sourceType:'module', plugins:['jsx']});
const declarations = ast.program.body.filter(node => node.type === 'FunctionDeclaration' ||
  (node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'VENTRA_SCHEMATIC_ASSET_DEFAULTS')));
const context = {THREE, console};
vm.createContext(context);
vm.runInContext(declarations.map(node => source.slice(node.start, node.end)).join('\n'), context);

const assetMeshes = (type, extra = {}) => context.buildSchematicAssetMeshes({
  THREE, asset: {type, width: 2, depth: 1, height: 0.9, xMeters: 4, yMeters: 4, ...extra},
  palette: {}, roomWidth: 8, roomDepth: 8,
});

test('upholstered sofa has rounded solid cushions inside its declared footprint', () => {
  const meshes = assetMeshes('sofa');
  assert.ok(meshes.filter(mesh => mesh.geometry instanceof THREE.ExtrudeGeometry).length >= 5);
  const bounds = new THREE.Box3();
  meshes.forEach(mesh => {mesh.updateMatrix(); bounds.union(new THREE.Box3().setFromObject(mesh));});
  assert.ok(bounds.min.x >= -1.001 && bounds.max.x <= 1.001, `${bounds.min.x}, ${bounds.max.x}`);
  assert.ok(bounds.min.y >= -0.501 && bounds.max.y <= 0.501, `${bounds.min.y}, ${bounds.max.y}`);
});

test('embedded sink and stove render surface fixtures without overlapping full-height cabinetry', () => {
  for (const type of ['sink', 'stove']) {
    const meshes = assetMeshes(type, {embeddedInCounter:true});
    assert.ok(meshes.length >= 2);
    const bounds = new THREE.Box3();
    meshes.forEach(mesh => {mesh.updateMatrix(); bounds.union(new THREE.Box3().setFromObject(mesh));});
    assert.ok(bounds.min.z > 0.7, `${type} starts at ${bounds.min.z}`);
  }
});

test('lamp shade and wardrobe handles stand on scene Z in actual THREE r71', () => {
  const shade = assetMeshes('nightstand').find(mesh => mesh.geometry instanceof THREE.CylinderGeometry && mesh.geometry.parameters.radiusTop === .1);
  assert.ok(shade);
  assert.ok(Math.abs(shade.rotation.x - Math.PI / 2) < 1e-8);
  const handles = assetMeshes('wardrobe').filter(mesh => mesh.geometry instanceof THREE.CylinderGeometry);
  assert.equal(handles.length, 2);
  assert.ok(handles.every(mesh => Math.abs(mesh.rotation.x - Math.PI / 2) < 1e-8));
});

test('legacy shadow camera properties used by r71 are configured', () => {
  const light = new THREE.DirectionalLight(0xffffff);
  assert.equal(light.shadow, undefined);
  assert.equal(typeof light.shadowCameraLeft, 'number');
  for (const property of ['shadowCameraLeft', 'shadowCameraRight', 'shadowCameraTop', 'shadowCameraBottom', 'shadowCameraNear', 'shadowCameraFar', 'shadowMapWidth', 'shadowMapHeight']) {
    assert.match(source, new RegExp(`keyLight\\.${property}\\s*=`));
  }
});
