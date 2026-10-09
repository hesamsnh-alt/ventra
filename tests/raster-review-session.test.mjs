import test from 'node:test';
import assert from 'node:assert/strict';
import { getRasterReview, updateRasterReview, subscribeRasterReview } from '../src/lib/rasterReviewSession.mjs';

test('report survives leaving Drawings and a late response reaches the remounted tab', () => {
  const id = 'review-test';
  let originalNotifications = 0;
  const leave = subscribeRasterReview(() => originalNotifications++);
  leave();
  const report = { report: { accepted: false, trace: { rooms: [] } } };
  updateRasterReview(id, report);
  assert.equal(originalNotifications, 0);
  assert.equal(getRasterReview(id), report);
  let visible = getRasterReview(id);
  const unsubscribe = subscribeRasterReview(() => visible = getRasterReview(id));
  const later = { report: { accepted: false, failure: { code: 'UNSUPPORTED_ROOM_BOUNDARY' } } };
  updateRasterReview(id, later);
  assert.equal(visible, later);
  assert.equal(getRasterReview('other-project'), null);
  unsubscribe();
  updateRasterReview(id, null);
});

test('session cache is bounded and can clear a report without persistent storage', () => {
  for (let i=0; i<9; i++) updateRasterReview(`cache-${i}`, { report: { id: i } });
  assert.equal(getRasterReview('cache-0'), null);
  assert.equal(getRasterReview('cache-8').report.id, 8);
  for (let i=0; i<9; i++) updateRasterReview(`cache-${i}`, null);
});
