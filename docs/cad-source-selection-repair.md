# CAD source selection repair

## Reproduced issue

On the published v139 site, selecting `Untitled-plan-2.dxf` in QA-07 exposed the APS-only build button correctly. Opening the 3D tab initially selected Engineering, then the asynchronous restore changed the selected mode to Image and displayed a missing-model message. No CAD conversion or paid AI request was started during this reproduction.

The binding treated absent or mismatched engineering data as a reason to choose the image workflow. Selection persistence retained only a document ID, so the viewer could not distinguish a newly selected CAD drawing from an image while cloud state was restored.

## Change

Persist the selected file's name alongside its document ID. Pass this identity from Drawing Center selections, remounts, build actions and explicit Engineering switches into both viewer refresh and asynchronous restore. CAD stays on APS even when its model is not yet available; an older image preference cannot change that file's workflow. Images/PDF stay on their own workflow. Geometry from another document remains blocked. Matching DWG interior geometry remains supported.

Missing CAD geometry now receives an APS-specific action message. This repair neither fabricates a missing CAD model nor demonstrates that APS translation or JPG reconstruction succeeds.

## Verification

39 focused source-selection, persistence and scene tests passed, including the actual viewer refresh function with stale image preference and no engineering snapshot. The final offline suite passed all 1,575 tests with no failures/skips; the production build passed. The reviewed viewer-control snapshot was updated only to recognize the CAD selection call's new filename argument; the other control handlers remain covered by the existing checksum.

## Published verification — 2026-11-08

Production commit `4d92a8a4c976621daeffc21f5d8a144e06ee8421`, Netlify deploy `6af07ad02962c86a489c6667`, was published at 13:37:11 UTC. Selecting the same DXF and opening 3D now retained Engineering after asynchronous restore and displayed the CAD-specific missing-model action.

One APS-only build then completed Autodesk translation of that DXF in approximately 55 seconds. The cloud browser could not initialize Autodesk Viewer: error 10 explicitly reported WebGL disabled on this device. Consequently geometry extraction and a usable 3D result were not verified. This browser limitation has not been established on the user's device. No OpenAI request was executed during this source-selection repair and APS-only test.

JPG reconstruction remains unresolved: the preceding v139 live run failed `INCOMPLETE_PIXEL_CLASSIFICATION`; it did not produce a new 3D model. Translation success and passing offline tests must not be presented as complete end-to-end conversion success.
