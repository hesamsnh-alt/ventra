# Ventra Interactive Preview V2 — 2026-09-19

Base: the user's original `ventra(20260919-135138).zip`, not any previous ChatGPT patch.

## Scope lock
Only the JPG/PNG/WebP interactive preview path changed.

- Added `src/app/api/ai/design-3d-preview/route.js`
- Minimally changed `src/app/projects/[id]/ProjectDrawingCenter.jsx`
- `src/app/projects/[id]/Project3DViewer.jsx` is byte-for-byte the original file.
- Existing `/api/ai/design-3d` remains untouched.
- APS/DWG/DXF/IFC/RVT code is untouched.
- Supabase/Auth/BOQ/Estimate/Quotation/Dashboard are untouched.

## Why V1 failed
V1 used GPT-5.1 with medium reasoning and max_output_tokens=8000. In the reported run all 8000 output tokens became reasoning tokens, leaving no scene JSON. V2 uses `reasoning.effort = none`, a smaller structured schema, and local deterministic furnishing.

## Runtime behavior
Image -> one OpenAI structured-vision request -> footprint/rooms/partitions/openings -> local normalization -> local furniture -> existing Three.js schematic viewer.

There is no automatic paid retry. APS remains the separate engineering source for CAD/BIM files and BOQ/quantities.
