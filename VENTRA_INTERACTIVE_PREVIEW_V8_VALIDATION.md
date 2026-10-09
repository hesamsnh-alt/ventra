# V8 validation

- `node --check src/app/api/ai/design-3d-preview/route.js`: PASS
- Synthetic bedroom 3.6 x 3.8: bed + wardrobe; no generic cabinet: PASS
- Synthetic living 4.2 x 4.7: sofa + TV + coffee table: PASS
- Synthetic kitchen+dining 3.7 x 4.0: counter + sink + stove + dining table: PASS
- Synthetic bathroom 1.6 x 2.5: shower + toilet + sink: PASS
- Room containment test: a room polygon protruding outside footprint is pulled inside: PASS
- `Project3DViewer.jsx` SHA-256 matches V7: PASS
- `ProjectDrawingCenter.jsx` SHA-256 matches V7: PASS
- `next.config.mjs` SHA-256 matches V7: PASS

Full Next production build was not run in the artifact environment because the available copied node_modules tree is incomplete.
