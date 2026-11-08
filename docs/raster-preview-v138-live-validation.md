# v138 production JPG verification — failed

Verified on 8 November 2026 after the owner explicitly requested deployment and a real test.

- Production commit: `52e25083b0e7db1141922b39a029f573e50c4980`.
- Netlify deploy: `6af038f23e9371686750f866`, published at 08:56:11 UTC (12:56:11 Dubai).
- Route version observed in the downloaded report: `pixel-graph-preview-v138-contrast-20261108`.
- Test-only project: QA-07, `a6855321-5155-4146-9bde-ad75e36015e6`.
- Source: existing `Ventra-JPG-Geometry-Test.jpg`, the supplied apartment plan. No duplicate upload.
- Action: image-only Build 3D, once. General BOQ analysis was not requested.

## Actual result

**Failed. No new 3D model was saved.** The UI displayed `INCOMPLETE_PIXEL_CLASSIFICATION` and the source-line overlay. Server elapsed time was 74,655 ms; the UI stopped at approximately 1:28 including the asynchronous job flow.

Local source extraction on the server's prepared image produced 202 ink segments, 325 candidate lines and 94 opening hypotheses. The model returned `complete:false`, confidence 0.32, 36 proposed wall records, 313 non-wall records and no selected openings. These returned classifications were not accepted or verified.

The model listed the labels LIVING ROOM, B.R, ROOM, MASTER ROOM, BALCONY and LANDRY, but stated that it could not reliably derive door/window openings from the supplied gap hypotheses and stroke context. It also flagged potentially incomplete interior topology. Region classification, floor/wardrobe interpretation, final door-direction application and scene compilation were therefore not reached.

One `gpt-5.1` response completed: 28,017 input tokens and 7,562 output tokens (including 3,490 reasoning tokens), total 35,579. No second semantic call, paid correction or repeat test was made. No exact monetary charge is asserted.

## Implication

The 1,544 offline passing tests and successful build did not establish real recognition. Source-line recovery is observable; automatic selection of the physical wall/opening topology remains the blocker. Do not describe this production version as a successfully reconstructed JPG model. Preserve this failure rather than loosening validation to produce an unsupported scene.

The original image, downloaded diagnostic JSON and browser screenshot were not added to the public repository.
