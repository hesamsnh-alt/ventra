VENTRA ARCHITECTURE V26

Fix: long internal wall extent is now clipped against actual raster wall guides.

If the source image contains only a short TV/nib wall, only that supported span is kept. Long unsupported corridor walls are rejected.

New diagnostics:
sourceGuideClippedWalls
sourceGuideRemovedWallMeters
sourceGuideUnsupportedLongWalls
sourceMetricGuideCount

Install: stop server, delete .next, replace both files, npm run dev, Analyze once.
Expected build: interactive-plan-scene-architecture-v26-20260921
