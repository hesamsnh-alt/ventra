# JPG geometry correction — deployed, live extraction failed

Based on main commit `c5d5687`. Version: `verified-raster-preview-v136-20261108`.

## Live result — 8 November 2026, UAE

Production deployment succeeded after explicit authorization to deploy and test:

- Source commit: `21743718b2460cf862176183d6af1d1287ee4fe4`.
- Netlify deploy: `6aef91ca80155c20d1151af0`; ready and published at `2026-11-07T21:03:01.523Z` (01:03 UAE on 8 November).
- The deployed Git tree exactly matches the locally built/tested tree: `50c89f8824741e93694b93714fa63df6cf198ec7`.
- Supplied `Untitled plan(3).jpg` was uploaded as `Ventra-JPG-Geometry-Test.jpg` to the existing TEST ONLY project QA-07. Image preparation used 2048 x 632 pixels.
- Exactly one image-build job was started: `022f7386-a26e-31b8-e223-2de632c959fb`. It made two completed `gpt-5.1` model requests (initial extraction plus the one allowed correction); total server elapsed time was 50,404 ms. No further paid test was run.
- Final status: HTTP 422 / `TRACE_IMAGE_MISMATCH`; no new scene accepted or saved.
- The corrected trace stayed inside the image frame but returned only four exterior walls, zero rooms and zero openings. It also omitted the balcony from the apparent outer extent. This is incomplete recognition, not a usable 3D reconstruction.
- The final image-support check rejected an unsupported bottom-wall span. Weakening that check would still leave an empty interior and is not a fix.
- The browser displayed the completed rejection, both attempts and the source overlay. It did not remain stuck polling.
- Both provider responses completed well below the output-token cap. This observed failure was not a transport timeout or output truncation.
- Provider usage: 10,590 input tokens (3,712 cached) and 4,829 output tokens across both requests. No currency cost is asserted; account billing was not read.

Conclusion: deployment and request lifecycle are verified, but JPG-to-3D recognition remains unresolved. Do not describe this release or its offline test count as evidence of correct architectural extraction.

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
- These offline checks made no paid model requests. The separately authorized live test and production deployment are recorded above. No production configuration or database schema was changed.

## Remaining work

The real test proves that bounding coordinates and adding a correction ruler are insufficient. The extractor must recover physical interior walls, all visible room zones, openings and the complete outer extent from image evidence. A whole-plan pixel trace produced by the current model cannot yet be treated as reliable. Synthetic tests and a successful build do not establish recognition quality for this or arbitrary projects.

Retain this failure as an extraction regression. Compare future extracted geometry with independent source annotations and varied real plans; do not loosen image/structural validation to accept the current four-wall skeleton. Avoid additional paid retries without a concrete extractor change and an agreed test budget.
