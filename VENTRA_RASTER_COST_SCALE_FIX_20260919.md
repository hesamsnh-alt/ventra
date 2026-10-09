# Ventra Raster Cost + Scale Guard — 2026-09-19

Changed only the raster 3D path.

## Changes
- Default raster Vision attempts reduced from 2 to 1. A single Analyze no longer automatically pays for a second correction pass.
- `VENTRA_RASTER_TRACE_MAX_ATTEMPTS=2` can be set explicitly for a deliberate second pass.
- Dense dimension sets (6+ measurements) now use a robust uniform-scale consensus. Mislocated room-label spans are kept as diagnostics instead of poisoning the global scale.
- Sparse dimension sets remain fail-closed and strict.
- One uniform X/Y metric transform is still enforced. No independent axis stretching was introduced.
- Structural validators remain strict. Bad walls/footprints/openings are still rejected rather than converted into misleading 3D.

## Report 13 finding
The supplied report's second trace moves past the previous scale-only failure with robust scaling, but is still structurally invalid (`WALL_OUTSIDE_FOOTPRINT` / topology defect). Therefore the validator must not be weakened further to accept that trace.

## Validation
- Syntax checks pass for modified server/modules.
- Focused raster tests: 24 pass / 5 fail.
- Those same five failures are legacy/current-suite issues unrelated to this patch family (reference fixture self-intersection, axis fixture expectation, opening fixture, and two persistence harness failures).
