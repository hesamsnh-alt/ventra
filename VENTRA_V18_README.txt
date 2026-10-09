VENTRA INTERACTIVE 3D PREVIEW V18

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

WHY V18
The V17 diagnostic finally made the furnishing failure measurable:
- bedroom1: bed only
- bedroom2: bed only
- living: sofa + coffee table, no TV
- kitchen/dining: dining table only, no kitchen run
- storage: zero assets
- bath2: only two fixtures

So V17 was still rejecting too many essential objects even after wall-aware placement.

V18 adds GENERAL essential room profiles:
- Bedroom: wardrobe is guaranteed when a contained compact placement exists
- Living: TV unit is retried on alternate supported room edges
- Kitchen/Kitchen-Dining: compact wall-run fallback, then sink/stove/fridge
- Storage: at least one cabinet when the room can contain it
- Bathroom: missing toilet/sink gets a compact contained fallback
- Severe overlaps are still rejected
- No object may leave the room polygon
- Normal collision-aware placement remains the first choice
- Fallbacks are tagged essentialFallback for diagnostics

New diagnostics:
build: interactive-plan-scene-v18-20260921
furnishing.version: essential_profile_furnishing_v18
furnishing.essentialFallbackCount
furnishing.byRoom[].assetTypes

Validation:
node --check: PASS

NOT TOUCHED:
- Project3DViewer.jsx
- ProjectDrawingCenter.jsx
- projects/[id]/page.js
- next.config.mjs
- APS / DWG
- Supabase/Auth
- BOQ/Estimate/Quotation
