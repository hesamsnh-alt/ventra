# V7 validation

- `design-3d-preview/route.js`: `node --check` PASS
- `Project3DViewer.jsx`: unchanged from V6
- `next.config.mjs`: unchanged from V6
- Scope: preview geometry route only

V7 specifically removes the room-union exterior-footprint reconstruction that caused V6 to produce 40 footprint vertices and 48 walls on the reference test.
