# APS Fix

This package is based directly on the original `ventra(4).zip`.

Changed only:
- `src/app/components/ApsViewer.jsx`
- `src/services/apsTakeoffBuilder.js`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx`

Fixes:
- Runs the existing `detectLayers` service in the active APS Viewer.
- Uses APS object classification when explicit DWG layer metadata is unavailable.
- Converts unlabelled APS measurements using the model `meterFactor`.
- Prevents inch values such as `43000 in` from being treated as `43000 m`.
- Restores Wall Length, Wall Area, and Floor Area cards in the Autodesk summary.
- Shows source model units as `source → m` because takeoff quantities are normalized to metric.

No database, API, upload, translation, Supabase, BOQ engine, or layer detector file was replaced.
