# Preview Map synchronization fix

- Added an explicit active/selected drawing state.
- Analyze Drawing now processes the selected drawing instead of always `documents[0]`.
- A newly uploaded drawing becomes active and clears the stale preview.
- Selecting another drawing clears an unrelated old preview until that drawing is analyzed.
- Deleting the drawing currently shown in Preview Map clears its takeoff/URN and selects the next available drawing.
- The APS viewer is keyed by document ID and URN so React fully remounts it when the active translated model changes.
- Download/Delete action clicks no longer accidentally select the row.
