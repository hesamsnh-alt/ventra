# Ventra V50 validation

Base: V49 full project, itself produced from the authoritative full Ventra source.

Changed source file only:
- `src/app/api/ai/design-3d/route.js`

V50 changes:
- independent topology evidence now includes room adjacencies, structural junctions, and expected door/window centers;
- candidate scoring weights spatial invariants above cosmetic/statistical plausibility;
- hard-evidence pass/fail gate added;
- third recovery vision pass runs only when trace and verifier both fail hard evidence;
- deterministic graph fallback may replace the selected candidate only if it passes hard evidence and materially improves score;
- low-evidence scenes remain renderable but are explicitly marked for manual review rather than silently claiming success.

Validation performed:
- `node --check src/app/api/ai/design-3d/route.js` PASS
- source diff against V49 confirms only `route.js` changed
- strict structured-output schema was updated with all new properties included in `required`
- no V41 hardcoded reference-regression logic or V43 independent room rectification was introduced

Not claimed:
- live OpenAI vision end-to-end run was not possible in this sandbox because the user's API credentials/billing are not available here.
