# JPG geometry correction candidate — not deployed

Based on main commit `c5d5687`. Candidate version: `verified-raster-preview-v136-20261108`.

The observed JPG response contained a dimension endpoint at x=2214 in a 2200-pixel image. It also contained incorrectly located walls. Fixing the endpoint exception alone does not establish correct recognition of this plan.

Changes:

- Build the structured trace schema from the exact prepared image dimensions. Every point is constrained to its own image frame, including measurement endpoints; echoed image dimensions are fixed by enum. Runtime source-image and geometry validation remain in place.
- Identify an invalid point by collection/path, coordinates and frame dimensions. Permit at most one correction of a completed invalid trace; never clamp or silently drop evidence to obtain a scene.
- Supply a pixel-ruler reference only on the correction pass. The original image alone remains the ink-validation source. Successful first passes receive no extra image. A correction does have additional image input tokens if eventually executed.
- Include the geometry engine version in preview job identity. Return the actual existing job state/result instead of reporting every duplicate as queued.
- Mark persisted terminal job failures. The browser stops polling a terminal 502/503, while transient service 502/503 responses remain resumable. Failed duplicate lookups cannot overwrite another queued job.

Validation:

- `npm run test:offline`: 1468 passed; 0 failed, skipped or canceled.
- `npm run build`: successful.
- Tests cover the observed out-of-frame response, all point-bearing schema collections, landscape/portrait/square images, bounded correction, eight distinct generated layouts, duplicate job recovery, version changes and terminal-versus-transient polling errors.
- The coordinate-reference image was generated and visually inspected for the supplied JPG. This checks image preparation, not model recognition.
- No paid model request, database write, deployment, or production configuration change was performed for this candidate.

## Unverified and required before deployment

The actual JPG has not been re-extracted with the modified model request. Its reconstructed walls, room boundaries, openings and measured scale must be compared against the source before accepting this candidate. Synthetic tests and a successful build are not evidence that this plan, or every arbitrary project, is now recognized correctly.

Next gate: one explicitly authorized, bounded local API extraction on the supplied JPG, with the trace and validation report retained for review. No deployment is needed for this test. Do not merge or deploy this branch before that gate passes.
