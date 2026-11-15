import assert from 'node:assert/strict';
import test from 'node:test';
import {clickPoint, editorState, snappedPoint, startCommand, submit} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {EPS, validPolygon} from '../src/lib/planStudio/geometry.mjs';
import {SECTION_DEFAULTS} from '../src/lib/planStudio/sections.mjs';
import {stairStations, projectedStairSection, railingElevation} from '../src/lib/planStudio/stairDetails.mjs';

const p = (x, y) => ({x, y});
const tread = (x, id = String(x), layer = 'architecture') =>
  ({id, type: 'line', layer, role: 'line', a: p(x, 0), b: p(x, 1)});
const run = [tread(0), tread(.24), tread(.58), tread(.88)];
const click = (state, x, y) => clickPoint(state, p(x, y), {raw: true});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < EPS, `${actual} != ${expected}`);
const settings = patch => ({...SECTION_DEFAULTS, ...patch});

test('LXTB measures unequal stations and omits hidden, coincident, oblique and section lines', () => {
  const doc = newDocument();
  doc.layers.find(l => l.id === 'notes').visible = false;
  doc.entities = [...run, tread(.241, 'duplicate'), tread(.4, 'hidden', 'notes'),
    {...tread(.65), role: 'section'}, {...tread(.15), b: p(1.15, 1)},
    {...tread(0, 'border'), a: p(-1, .5), b: p(2, .5)}];
  const result = stairStations(doc, p(-.1, .45), p(1, .45));
  assert.equal(result.length, 4);
  result.forEach((value, i) => near(value, [0, .24, .58, .88][i]));
});

test('rotation and reversal preserve actual spacings in the selected direction', () => {
  const rotate = ({x, y}) => p((x-y)*Math.SQRT1_2, (x+y)*Math.SQRT1_2);
  const doc = {...newDocument(), entities: run.map(e => ({...e, a: rotate(e.a), b: rotate(e.b)}))};
  const result = stairStations(doc, rotate(p(1,.5)), rotate(p(-.1,.5)));
  assert.equal(result.length, 4);
  result.forEach((value, i) => near(value, [0, .30, .64, .88][i]));
});

test('guide that misses the flight or crosses too many edges is rejected', () => {
  const doc = {...newDocument(), entities: Array.from({length: 41}, (_, i) => tread(i / 10))};
  assert.throws(() => stairStations(doc, p(-.1, .5), p(5, .5)), /2–40/);
  assert.throws(() => stairStations(doc, p(-1, 1.5), p(5, 1.5)), /2–40/);
  assert.throws(() => stairStations(doc, p(0, 0), p(0, 0)), /different points/);
});

for (const stepDirection of ['up','down']) {
  for (const stepStartLanding of [0, .9]) {
    for (const stepEndLanding of [0, .9]) {
      test(`closed concrete waist with ${stepDirection}, start ${stepStartLanding} and end ${stepEndLanding}`, () => {
        const [profile] = projectedStairSection([0, .24, .58, .88], p(0, 0),
          settings({stepDirection, stepStartLanding, stepEndLanding, stepRun: 'left'}));
        assert.ok(profile.closed && validPolygon(profile.points));
        assert.equal(profile.hatch, 'concrete');
        near(Math.min(...profile.points.map(a => a.x)), -.88 - stepEndLanding);
        near(Math.max(...profile.points.map(a => a.x)), stepStartLanding);
      });
    }
  }
}

test('total rise and per-riser rise produce exact levels and leave unequal going intact', () => {
  const at = p(10, 2);
  const stations = [0, .24, .58, .88];
  const [up] = projectedStairSection(stations, at, settings({stepWaist: 0, stepRiseMode: 'total', stepTotal: .8}));
  const [down] = projectedStairSection(stations, at, settings({stepWaist: 0, stepRun: 'left', stepDirection: 'down', stepRise: .16}));
  assert.deepEqual(up.points.at(-1), p(10.88, 2.8));
  near(down.points.at(-1).x, 9.12);
  near(down.points.at(-1).y, 1.36);
  near(up.points[2].x - up.points[1].x, .24);
  near(up.points[4].x - up.points[3].x, .34);
  assert.equal(up.closed, false);
});

test('LXTB inserts away from the plan with ORTHO, exports its hatch and can be undone', () => {
  const original = editorState({...newDocument(), entities: run});
  let state = submit(original, 'LXTB');
  state = click(click(state, -.1, .5), 1, .5);
  assert.deepEqual(state.doc, original.doc);
  assert.match(state.log.at(-1), /4 tread lines/);
  assert.deepEqual(snappedPoint({...state, ortho: true}, p(3, 4)), p(3, 4));
  state = click(state, 3, 4);
  assert.deepEqual(state.doc.entities.slice(0, 4), run);
  assert.ok(state.doc.entities.slice(4).every(e => e.role === 'section'));
  assert.match(exportDXF(state.doc), /HATCH\n[\s\S]+section-details/);
  assert.deepEqual(startCommand(state, 'U').doc, original.doc);
});

for (const heightDifference of [-1.2, 0, 1.2]) {
  test(`LG generates a railing with baseline rise ${heightDifference}`, () => {
    const a = p(0, 1), b = p(2.5, 1 + heightDifference);
    const options = settings({handrailExtension: .1, railHeight: 1});
    const parts = railingElevation(a, b, options);
    assert.deepEqual(parts, railingElevation(b, a, options));
    const handrail = parts[0].points;
    near(handrail[0].x, -.1);
    near(handrail[1].x, 2.6);
    near((handrail[1].y - handrail[0].y) / 2.7, heightDifference / 2.5);
    assert.ok(parts.every(e => validPolygon(e.points)));
    assert.equal(railingElevation(a, b, {...options, railEndPosts: 'no'}).length, parts.length - 2);
  });
}

test('rail commits as one edit and rejects a vertical or invalid rail', () => {
  const state = click(startCommand(editorState(), 'LG'), 0, 0);
  assert.throws(() => click(state, 0, 3), /railing span/);
  assert.throws(() => railingElevation(p(0, 0), p(1, 0), settings({railBottomGap: .95})), /railing span/);
  const placed = click(state, 2, 1);
  assert.equal(placed.history.length, 1);
  assert.ok(placed.doc.entities.length > 4);
  assert.ok(placed.doc.entities.every(e => e.role === 'section'));
});
