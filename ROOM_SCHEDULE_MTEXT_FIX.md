# Room Schedule MTEXT Fix

- Cleans Autodesk MTEXT formatting codes before displaying room names.
- Removes sheet-title noise such as `Bathroom - Plan` and object identifiers.
- Prevents geometry placeholders and text labels from being counted as separate rooms.
- Keeps genuine repeated room labels when they belong to separate Autodesk objects.
- Shows `N/A` instead of false `0.00` area/perimeter values when a label cannot be safely matched to a measured polygon.
- Uses measured geometry only when a safe one-to-one label-to-polygon match exists.
