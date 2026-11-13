import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/app/projects/[id]/ProjectDrawingCenter.jsx', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('  async function handleOpenSaved3D('), source.indexOf('  async function handleAnalyzeDrawing('));
const current = {documentId: 'current', documentName: 'current.jpg', width: 5, depth: 4, rooms: []};
const previous = {...current, documentId: 'previous', documentName: 'previous.jpg'};

function setup({local = null, cloud = null, changeSelection = false} = {}) {
  const calls = [];
  const state = {
    projectId: 'project', language: 'en', analyzing: false, generatingBoq: false, uploading: false,
    analysisInFlightRef: {current: false}, analysisSelectionRef: {current: {projectId: 'project', documentId: 'current'}},
    selectedDocumentForPreview: {id: 'current'}, clearMessages() {},
    setOpeningSavedModel(value) { state.opening = value; },
    setErrorMessage(value) { state.error = value; },
    async loadModule(name) {
      if (name.endsWith('schematicStorage.mjs')) return {readSchematic: async () => local};
      return {restoreCloud3DState: async (...args) => {
        calls.push(['cloud', ...args]);
        if (changeSelection) state.analysisSelectionRef.current = {projectId: 'project', documentId: 'other'};
        return {schematic: cloud};
      }};
    },
    async saveSchematic(id, scene, options) { calls.push(['save', id, scene.documentId, options.syncCloud]); return scene; },
    async saveActiveSource(id, mode, options) { calls.push(['mode', id, mode, options.syncCloud]); },
    selectDrawingDocument(id, drawingId, _storage, name) { calls.push(['select', id, drawingId, name]); },
    window: {dispatchEvent() {}}, CustomEvent: class {},
    onOpen3D() { calls.push(['open']); },
  };
  vm.createContext(state);
  vm.runInContext(handler.replaceAll('import(', 'loadModule(') + '\nthis.open = handleOpenSaved3D;', state);
  return {state, calls};
}

test('a fresh browser restores the same drawing from the cloud before opening the viewer', async () => {
  const {state, calls} = setup({cloud: current});
  await state.open();
  assert.deepEqual(calls, [['cloud', 'project', 'schematic', 'current'], ['save', 'project', 'current', false], ['mode', 'project', 'schematic', false], ['open']]);
  assert.equal(state.analysisInFlightRef.current, false);
});

test('an unrelated saved cloud model is never shown as the selected drawing', async () => {
  const {state, calls} = setup({cloud: previous});
  await state.open();
  assert.deepEqual(calls, [['cloud', 'project', 'schematic', 'current']]);
  assert.match(state.error, /no saved 3D model/i);
});

test('the explicit latest-model action opens the older model under its original drawing identity', async () => {
  const {state, calls} = setup({cloud: previous});
  await state.open({latest: true});
  assert.deepEqual(calls, [['cloud', 'project', 'schematic', null], ['save', 'project', 'previous', false], ['select', 'project', 'previous', 'previous.jpg'], ['mode', 'project', 'schematic', false], ['open']]);
});

test('a late cloud reply does not open a model after the user switches drawings', async () => {
  const {state, calls} = setup({cloud: current, changeSelection: true});
  await state.open();
  assert.deepEqual(calls, [['cloud', 'project', 'schematic', 'current']]);
  assert.equal(state.opening, false);
});
