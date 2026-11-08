# Pixel classification evidence v141

Status: local implementation and offline validation complete; live image-to-3D acceptance is unverified. Do not promote this change as a completed reconstruction fix.

The authorized v140 live test authenticated successfully but returned `complete: false` and three missing-feature explanations. No scene was saved. Replaying its selected source IDs through the local topology assembler independently rejects overlapping alternatives (`solid_band1` and `pair103_109`). Both use the same source face, but the prior compact request omitted `sourceIds` for solid bands.

Changes:

- Send source provenance for every candidate and explicit measured-band alternative relationships. The mapping describes measured overlap; it does not classify an unknown line as a wall.
- Separate strokes, solid bands, face pairs and fragments in evidence crops, capped at nine detail images. Retain the original image and source coordinates. Detail metadata records the source viewport and candidate IDs.
- Place a long segment's ID within every crop it intersects. Keep labels within crop bounds and avoid already placed labels when space allows.
- Preserve the classifier's missing-feature reasons and required-band coverage in rejection diagnostics.
- Regenerate the tracked background bundle and version the shared request/worker contract as v141.

The source fixture retains only geometry and the failed semantic selection, without API credentials, signed image URLs, response identifiers or token transport logs. Regression checks verify every one of its 330 candidates has visible evidence, the known duplicate relationship is supplied to classification, and the incomplete response still cannot be accepted. Existing topology, scale, opening-inventory and image-support checks remain active.

Validation: `npm run test:offline` and `npm run build`. No new OpenAI or APS request was submitted for this revision. A future live acceptance test must inspect the generated geometry and source agreement; passing the offline suite alone does not establish reconstruction accuracy. Evidence crop changes may affect input-token usage, despite the image-count cap.
