# Room spatial matching fix

- Extracts per-object fragment bounds and centroids from Autodesk Viewer.
- Normalizes label coordinates using the APS model-unit meter factor.
- Cleans MTEXT labels and spatially matches each label to the closed room polygon containing it.
- Falls back to a bounded nearest-centroid match only when a label is close enough.
- Prevents title-block and schedule labels outside room polygons from being counted.
- Deduplicates multiple text fragments inside the same polygon by keeping the closest label.
- Preserves unmatched geometry rooms as `Unlabeled Space` rather than inventing names.
- Room count now follows the actual schedule rows, and matched rooms carry real area/perimeter.

Validation:
- `node --check src/services/apsPropertyExtractor.js` passed.
- `node --check src/services/apsTakeoffBuilder.js` passed.
- Full Next.js build could not run because dependencies are not installed (`next: not found`).
