VENTRA ARCHITECTURE V22 — 2026-09-21

Replaces exactly two files:
- src/app/api/ai/design-3d-preview/route.js
- src/app/projects/[id]/Project3DViewer.jsx

Core architecture changes:
- room polygon edges now synthesize missing interior walls
- open-plan filtering still removes false living/kitchen zone dividers
- enclosed rooms (bedroom, bathroom, storage, office, separate kitchen) are normalized to one internal access door
- duplicate/extra internal doors are removed
- missing access doors are synthesized on a valid internal wall
- exterior entry doors are preserved
- wall gap cleanup remains active
- relationship-based door hints still have priority

Visual changes:
- darker warm furniture
- stronger bedroom wood
- warm beige/stone main floor
- white bathroom ceramic remains
- Modern / Minimal / Typical / Luxury presets remain distinct

Validation:
- route.js: node --check PASS
- Project3DViewer.jsx: TypeScript JSX parser PASS

After installing:
1) Stop npm dev
2) Delete .next
3) npm run dev
4) Analyze once
5) Confirm build: interactive-plan-scene-architecture-v22-20260921
