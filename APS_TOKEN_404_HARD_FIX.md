# APS Token 404 hard fix

This build preserves both explicit token routes and adds a dynamic fallback:

- `/api/aps/token`
- `/api/aps/viewer-token`
- fallback: `src/app/api/aps/[action]/route.js`

No room analysis, OpenAI prompt, geometry, BOQ, database, auth, or UI logic was modified.
