# Raster input and CAD view selection repair — v140

## Observed problems

The user's JPG review rejected `INCOMPLETE_PIXEL_CLASSIFICATION`, reported five source doors, and displayed zero regions even though region assembly had not run. Their later DXF screenshot showed a loaded Autodesk paper sheet with no visible drawing. Neither screenshot is evidence of successful 3D reconstruction.

## Changes

- Pixel graph and door-symbol scale thresholds now use the measured visible ink extent instead of unused export paper. All pixel coordinates and image dimensions retain their original frame.
- The line classifier receives compact source geometry plus separate detail crops that label face-pair and fragment IDs. Previously its overview labelled only raw strokes and solid bands, leaving selectable alternatives invisible.
- A complete semantic selection confirms all unused alternatives are redundant/non-architectural. It no longer has to emit hundreds of negative classifications. Unrepresented thick measured bands still require explicit non-wall reasons. Complete=false, unresolved features, unknown/duplicate IDs, missing observed doors, invalid topology, room inventory, scale and image-support failures still block saving.
- Review UI says region assembly has not run instead of misleadingly reporting zero enclosed regions before that stage.
- CAD view selection now prioritizes named Model space over earlier paper layouts. The SDK default is considered even when a partial search already returned a layout. IFC/RVT retain 3D-first priority; sheet-only drawings remain loadable.

## Zero-API evidence

The associated original `Untitled plan(1).jpg` and DXF were retrieved for local inspection; these are not asserted to be byte-identical to the user's latest upload, whose downloaded diagnostic report is unavailable. On that JPG, v140 finds six doors. All six match the DXF's independently stored ARC centers/radii after registration to visible dimension references: maximum center error 2.05 px and maximum radius error 1.62 px. A controlled v139 local replay on this associated original found seven hypotheses, including a false extra hypothesis; the user's screenshot reported five on their uploaded copy. Do not conflate these different observations.

The earlier beige-background JPG still yields the same six door observations as v139; its largest disagreement with the associated DXF center is 7.70 px, unchanged from that baseline. This is not claimed as a new accuracy improvement.

The DXF compatibility copy passes ezdxf 1.4.4 audit with zero errors/fixes and contains 199 entities in Model and zero in Layout1. This proves that the source contains geometry and a blank layout exists; it does not establish the actual view GUID selected in the user's screenshot.

On the associated source graph, compact source-data JSON shrank from 84,803 to 62,326 characters (27%). Detail images are additional vision input, so total token/cost savings are not asserted. Two semantic tasks remain the maximum; no automatic paid correction loop was added.

## Validation and limits

All 1,592 offline tests passed with no failures/skips, including three paper-padding variants, measured thick-band coverage, candidate detail labels, CAD Model/Layout ordering, source identity and APS isolation. The production build passed. No OpenAI request or new APS translation was executed for these local checks.

Full live JPG wall/room classification and 3D output remain unverified. A successfully rendered CAD model is also unverified in the cloud browser, where WebGL was previously disabled. Do not treat this patch's tests or door matches as a completed end-to-end acceptance.

## Isolated preview

PR #3 contains these fixes; production main was not changed. Preview deploy `6af083a10fbb00878bd2b226` is ready on commit `f1474eea385d29d771350554a3ca2fecbe9f1f35`. The actual project 3D initializer also uses the Model-space selection helper; 33 focused CAD/source/control tests passed after that integration, and the final build passed.

Secure sign-in on the preview was submitted but the site returned `Invalid login credentials`. Public compiled auth configuration on production and preview points to the same Supabase project. No credential values were read, retained or printed. Live image analysis did not start, and no OpenAI request/new APS translation was executed during this repair attempt. Authentication must be completed before live acceptance; do not merge this PR as a proven end-to-end fix.

## Live attempt after sign-in and worker isolation correction

After successful secure sign-in, a single explicit image-only attempt on QA-07's `Untitled-plan-2.jpg` returned `INCOMPLETE_PIXEL_CLASSIFICATION`. Its diagnostic **build was v139**, not the v140 frontend. It reported 149 ink segments and seven door hypotheses. One semantic task completed with 31,583 input and 4,138 output tokens (35,721 total); no scene was saved. This does not validate or invalidate v140 geometry: the intended engine did not run.

The queue selected its background origin from deploy/site environment variables, allowing a preview request to reach a published worker. Dispatch now stays on the requesting origin only when it is a declared origin or a Netlify alias belonging to this exact site; arbitrary origins cannot receive the authorization header. Image jobs are isolated by origin and engine version. A non-sensitive `preview-build` function is checked before insertion/dispatch; mismatched deployments stop before AI. The executing worker independently checks the expected engine version before invoking commercial analysis. Existing actor/nonce/atomic-claim and BOQ behavior remain tested.

The tracked background bundle was regenerated and is tested to contain the same raster build as the application. All 1,609 offline tests pass, including existing recovery, duplicate dispatch, BOQ, CAD identity and viewer controls; the final Next build passed. A genuine v140 live geometry result is still pending.

## Genuine v140 attempt

After verifying the preview's non-sensitive build endpoint, the genuine v140 attempt used the same image hash `c354ec6eac46d320`. It extracted 177 ink segments and six local door observations, matching the local associated-file result. It stopped before a provider response: `TypeError` constructing a ByteString header at index 7 (U+2022), with zero stream events, no response ID and no usage returned. No new scene was saved. Geometry classification and complete 3D therefore remain unverified.

A request to list all Netlify environment variables was rejected by automatic review because it could expose deployment secrets. It was not retried or bypassed. The safer alternative exposes only `missing`, `unusable_header` or `header_ready` configuration state through the existing non-sensitive preview-build endpoint. It never returns a key, length, prefix or headers. `header_ready` establishes syntax only, not provider authentication. Image preflight and the raster handler reject unusable configuration before an AI call with an explicit setup message.

The final configuration checks passed all 1,622 offline tests; an additional preflight-negative case passed in the 30-test focused run, and the final production build passed. No production merge has been made. A valid preview deployment credential is required before full geometry acceptance can continue.
