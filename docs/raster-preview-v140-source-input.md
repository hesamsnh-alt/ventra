# Raster input and CAD view selection repair — v140

## Observed problems

The user's JPG review rejected `INCOMPLETE_PIXEL_CLASSIFICATION`, reported five source doors, and displayed zero regions even though region assembly had not run. Their later DXF screenshot showed a loaded Autodesk paper sheet with no visible drawing. Neither screenshot is evidence of successful 3D reconstruction.

## Changes

- Pixel graph and door-symbol scale thresholds now use the measured visible ink extent instead of unused export paper. All pixel coordinates and image dimensions retain their original frame.
- The line classifier receives compact source geometry plus separate detail crops that label face-pair and fragment IDs. Previously its overview labelled only raw strokes and solid bands, leaving selectable alternatives invisible.
- A complete semantic selection confirms all unused alternatives are redundant/non-architectural. It no longer has to emit hundreds of negative classifications. Unrepresented thick measured bands still require explicit non-wall reasons. Complete=false, unresolved features, unknown/duplicate IDs, missing observed doors, invalid topology, room inventory, scale and image-support failures still block saving.
- Review UI says region assembly has not run instead of misleadingly reporting zero enclosed regions before that stage.
- CAD view selection now prioritizes named Model space over earlier paper layouts. The SDK default is considered even when a partial search already returned a layout. IFC/RVT retain 3D-first priority; sheet-only drawings remain loadable.

## Zero-API evidence

The associated original `Untitled plan(1).jpg` and DXF were retrieved for local inspection; these are not asserted to be byte-identical to the user's latest upload, whose downloaded diagnostic report is unavailable. On that JPG, v140 finds six doors. All six match the DXF's independently stored ARC centers/radii after registration to visible dimension references: maximum center error 2.05 px and maximum radius error 1.62 px. A controlled v139 local replay on this associated original found seven hypotheses, including a false extra hypothesis; the user's screenshot reported five on their uploaded copy. Do not conflate these different observations.

The earlier beige-background JPG still yields the same six door observations as v139; its largest disagreement with the associated DXF center is 7.70 px, unchanged from that baseline. This is not claimed as a new accuracy improvement.

The DXF compatibility copy passes ezdxf 1.4.4 audit with zero errors/fixes and contains 199 entities in Model and zero in Layout1. This proves that the source contains geometry and a blank layout exists; it does not establish the actual view GUID selected in the user's screenshot.

On the associated source graph, compact source-data JSON shrank from 84,803 to 62,326 characters (27%). Detail images are additional vision input, so total token/cost savings are not asserted. Two semantic tasks remain the maximum; no automatic paid correction loop was added.

## Validation and limits

All 1,592 offline tests passed with no failures/skips, including three paper-padding variants, measured thick-band coverage, candidate detail labels, CAD Model/Layout ordering, source identity and APS isolation. The production build passed. No OpenAI request or new APS translation was executed for these local checks.

Full live JPG wall/room classification and 3D output remain unverified. A successfully rendered CAD model is also unverified in the cloud browser, where WebGL was previously disabled. Do not treat this patch's tests or door matches as a completed end-to-end acceptance.
