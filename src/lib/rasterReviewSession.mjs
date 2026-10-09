// In-memory diagnostics only. Never writes to project or scene persistence.
const reports = new Map();
const listeners = new Set();
export const getRasterReview = (projectId) => reports.get(projectId) || null;
export function subscribeRasterReview(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function updateRasterReview(projectId, review) {
  if (!projectId) return;
  reports.delete(projectId);
  if (review) reports.set(projectId, review);
  while (reports.size > 8) reports.delete(reports.keys().next().value);
  for (const listener of listeners) listener();
}

// Keep the review in this module rather than component state so a route/tab
// remount can observe a request that is still running.
