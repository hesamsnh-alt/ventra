# v139 — source opening recovery

The v138 live failure exposed an extraction problem: its source-gap hypotheses did not cover the real doors. The previous direction tests supplied jamb endpoints and therefore did not test automatic opening discovery.

## Implementation

- Fit source arc components, using deterministic robust fitting when a curve is connected to another stroke. Require a thin radial leaf, curved tangent support, a valid arc, and separation from continuous frame strokes. Text-like glyph groups and crossed storage must not become doors.
- Derive principal orientations from the source drawing; do not assume an unrotated sheet. No project-specific coordinates or expected door count enter production detection.
- Recover filled wall bands directly from source ink, including short jamb stubs omitted by long-line voting. Retain original boundary IDs so selecting a band and its overlapping face alternatives cannot duplicate a wall.
- Bind observed openings to measured wall axes and source jamb extents. This separates a swing symbol drawn on a wall face from the architectural centreline used for the wall cut. Preserve raw arc observations alongside attachment evidence.
- Allow a source door at a wall end or perpendicular junction. Both sides need not contain collinear wall runs. Require selected wall hosts before an observation becomes an architectural opening.
- Remove dangling branches only during bounded-face walking; retain those source walls and doors in geometry. Do not erase a valid enclosing floor face because a branch does not form another room.
- Pass measured door observations and labelled overlays into semantic classification. Each observation must be selected or explicitly reviewed with visible non-door evidence; silent omissions fail.
- Show source discovery counts and jamb spans in the review UI without presenting those counts as proof of a complete 3D model.

## Local evidence

The supplied apartment JPG was checked against independent annotations of architectural wall axes and visible jamb extents. Detection receives only image pixels and source segments, not these annotations. The private image and annotations are not committed.

| Variant | Expected doors | Detected doors | Maximum endpoint error in original pixels |
| --- | ---: | ---: | ---: |
| Original | 6 | 6 | 2.74 |
| 90-degree rotation | 6 | 6 | 3.60 |
| 17-degree rotation | 6 | 6 | 2.80 |
| 75% image size | 6 | 6 | 3.07 |

Reproduction entry point: `node scripts/check-raster-opening-discovery.mjs IMAGE ANNOTATIONS.json`. It makes zero API requests and checks matched positions and swing direction, not just counts.

Automated fixtures cover independent sizes and rotations, faint strokes, corner doors, missing arcs/leaves, crossed storage, room-label glyphs, short filled jambs, wall-end branches and a complete pixel-to-scene compiler path. Semantic responses in compiler integration tests are mocked; they do not prove live model classification.

Final offline suite: 1,561 passed, zero failures or skipped tests. Production build and zero-API handler bundling check passed.

The previous v138 production failure remains valid. A successful local opening check is not a verified full reconstruction of this JPG. Sliding, folding and double-leaf symbols still require additional recognizers or review. No public-source image or full diagnostic payload is included here.

## v139 live verification — not a complete reconstruction

Production commit `1ac47cd482593f554a5a0c970da3e962d2a9b619`, deploy `6af046987cb5c982253f5109`, published 8 November 2026 at 09:54:22 UTC (13:54:22 Dubai). One image-only test ran on the existing JPG in QA-07. No repeated paid test was made.

The server recovered 239 source segments and all six doors. The model selected all six measured door IDs with the expected swing directions, and reported two visible windows. It returned `complete:false`, confidence 0.47, because some wall/furniture/dimension classifications and exact window jamb mappings remained unresolved. The result was `INCOMPLETE_PIXEL_CLASSIFICATION`; no new 3D scene was saved and region classification was not reached.

One gpt-5.1 response completed, using 35,940 input and 5,612 output tokens (1,918 reasoning tokens), total 41,552. Server elapsed time: 73,003 ms. No monetary charge is asserted. The implemented door improvement was observed live, but the complete JPG-to-3D goal remains unresolved.
