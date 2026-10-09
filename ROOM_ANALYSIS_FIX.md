# Room analysis aggregation fix

This patch changes the room summary so it no longer relies only on the number of closed geometry polygons.

- Reads semantic room labels from APS object properties and drawing text.
- Recognizes bedroom, living room, kitchen, dining room, bathroom, office/study, corridor, laundry, closet/dressing room, entrance/foyer, storage, parking, and balcony/terrace.
- Uses the highest supported count from geometry rooms, model rooms, and semantic drawing labels.
- Merges semantic labels into the Room Schedule without duplicating room types already represented by geometry/model objects.
- Preserves measured areas and perimeters; label-only spaces are not given invented measurements.

No BOQ, Estimate, APS preview-selection, or layout code was changed in this patch.
