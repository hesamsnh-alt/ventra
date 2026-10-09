VENTRA ARCHITECTURE V27

Purpose: fix V26 over-pruning.

V26 correctly removed unsupported long open/corridor walls, but the same source-guide clipping was also deleting legitimate bathroom/storage/bedroom enclosure walls.

V27:
- preserves adjacency segments that bound enclosed labeled rooms
- lets bathroom/storage/office polygons restore missing enclosure edges
- still clips/removes unsupported living/circulation walls
- keeps corridor mouths open
- keeps V26 renderer/presets unchanged

Diagnostics:
- protectedEnclosureWalls
- sourceGuideClippedWalls
- sourceGuideRemovedWallMeters
- sourceGuideUnsupportedLongWalls

Build: interactive-plan-scene-architecture-v27-20260921
