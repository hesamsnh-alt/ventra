# Pixel graph raster preview v137

Status: implemented locally; no v137 deployment or live model classification has been verified.

## Extraction changes

- Derive wall candidates, junctions, enclosed faces and opening hypotheses from image pixels. Semantic classification selects source IDs rather than inventing coordinates.
- Reject incomplete selections, unclassified spaces, missing visible features and unsupported topology. Preserve source overlays on rejection.
- Recognize both blank wall gaps and sparse window frames between solid wall bands. No bounding rectangle fallback.
- Limit semantic processing to two tasks with no paid correction loop.

## Room and hatch conventions

Source labels take priority over furniture. Under this project's explicit convention, `B.R` and `BR` mean bathroom; `ROOM` remains a room and a bed can refine it to bedroom. Furniture supplies a fallback when labels are missing.

Enclosed marked core regions without details can become voids with no floor. A marked bedroom storage region becomes a wardrobe and retains the bedroom floor. Explicit room labels and detailed fixtures prevent a generic hatch rule from deleting rooms. Furniture-only symbol enclosures cannot remove architectural floor.

## Door evidence and rendering

The local detector requires both a source door leaf and swing arc. It records the hinge endpoint, clockwise/counterclockwise swing in source image coordinates, observed angle, and inward/outward direction per adjacent room. Reversing an owning wall preserves the physical hinge. Ambiguous or unsupported symbols remain unresolved rather than receiving a guessed swing. The review overlay and 3D viewer preserve this metadata, including the source-image Y-axis reflection.

Single-leaf arc symbols are covered. Sliding, folding and double doors do not yet have dedicated pixel direction recognizers.

## Validation boundary

- Final offline suite: 1,538 passing tests, zero failures; production build passed.
- The focused graph, compiler, door and review run also passed all 35 tests after the sparse-frame hypothesis addition.
- Tests cover both hinges, both swing directions, horizontal/vertical source walls, wall reversal, missing leaf/arc, floor holes, wardrobes, labels, rotated source contours, and source window-frame transitions.
- On the supplied 2048x632 JPG, local extraction yields 154 ink segments, 272 candidate lines and 126 opening hypotheses. These are hypotheses, not a verified architectural model.
- A separate source-image check with manually supplied opening endpoints read hinge and swing evidence for six doors. This validates symbol reading at known openings; it does not establish automatic endpoint discovery or end-to-end recognition.
- Local handler bundling check passed with zero API requests.
- No paid semantic call was made for v137 in this implementation. Mock classifier tests cannot establish model recognition of the supplied JPG. The previous live v136 failure remains documented in `raster-preview-v136-validation.md`.
