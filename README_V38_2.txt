VENTRA V38.2 - STRICT SCHEMA GUARD

Built from the user's latest full project ZIP: ventra(20260911-194530).zip

Fixes:
400 Invalid schema for response_format 'ventra_floorplan_geometry_v15':
'required' must include every key in properties.

Changed file only:
src/app/api/ai/design-3d/route.js

What changed:
1. Added recursive strict schema normalization.
2. Added local strict schema validation before OpenAI calls.
3. Geometry/assets calls use strictified schemas.
4. Schema names bumped to v38_2.
5. Geometry prompt no longer requests footprint/holes when the stable schema does not expose them.
6. Keeps async/API stability behavior.

Validation:
- node --check route.js: PASS

Expected route version:
generic-floorplan-engine-v38.2-strict-schema-guard

Expected log:
[VENTRA STRICT SCHEMA READY v38.2]
