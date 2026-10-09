# APS Viewer Token Route Fix

- The Viewer now requests `/api/aps/token` as the primary token endpoint.
- `/api/aps/token` now returns a client-safe APS token scoped only to `viewables:read`.
- `/api/aps/viewer-token` remains available as a compatibility fallback.
- Both routes are forced dynamic and return `Cache-Control: no-store`.
- Viewer clients no longer blindly parse HTML error pages as JSON.
- If the primary route fails, the Viewer tries the compatibility route once and reports a readable error.
