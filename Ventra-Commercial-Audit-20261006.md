# Ventra Commercial Readiness Audit

Date: 2026-10-06. Source: supplied `ventra .zip`, extracted separately; original untouched.

## Verdict

NOT READY for an unrestricted paid commercial launch. Suitable for a supervised pilot only after the critical security and billing issues are fixed. A successful build is not an accuracy certification.

## Critical Findings

1. **Cross-project BOQ modification without authentication.** `src/app/api/ai/generate-boq/route.js:16,5359,7370-7446` creates a service-role database client, accepts a caller-supplied projectId, deletes project BOQ rows and inserts replacements without validating user identity or project ownership. RLS does not protect service-role requests. Authenticate and authorize before any catalog processing/write; use an atomic transaction and revision guard.
2. **Public paid-provider endpoints.** `src/app/api/ai/design-3d-preview/route.js:3165`, `design-3d/route.js:3564`, `aps/upload/route.js:8`, `aps/viewer-token/route.js:7` have no route-level account/ownership/quota checks; no middleware/proxy security gate was found in this archive. Public users can consume resources; APS token issuance is not tied to an authorized document. Add authentication, document ownership, quotas, input limits and rate limiting.
3. **Unrestricted remote image fetch.** `design-3d-preview/route.js:2882-2888` fetches caller imageUrl and buffers the entire response without host validation, a timeout or a byte limit. This presents SSRF/resource-exhaustion risk, including redirects. Resolve authorized storage object IDs server-side; reject private/reserved addresses and enforce redirect, time and size limits.

## High Findings

4. **Stripe webhook is not a webhook.** `src/app/api/stripe/webhook/route.js:7,70,156` requires a browser bearer token and creates a checkout session. It does not verify stripe-signature or handle signed subscription/payment events. No durable entitlement processing was identified here. Implement signed events, idempotency and subscription reconciliation before charging users.
5. **Wrong-project takeoff recovery.** `src/services/takeoffService.js:174-225` sorts all local takeoffs and selects the first even if no project matches. An empty project can inherit another project's quantities and prices. Never recover unmatched project data; use explicit verified migration mappings.
6. **Core outputs are browser-local.** `ProjectDrawingCenter.jsx:1980`, `ProjectEstimate.jsx:188`, `ProjectQuotation.jsx:281` persist scene/estimate/quotation in localStorage. No corresponding durable output revision was found on these paths. Browser clearing/device changes and shared browser users threaten continuity/isolation. Persist tenant/user-scoped versioned snapshots with document hash, units, provenance, calculation version and approval status.
7. **BOQ replacement is not atomic.** `generate-boq/route.js:7370-7446` deletes then inserts in separate calls. Failure after deletion loses existing engine rows; simultaneous generations can race. Use transactional revision replacement.
8. **JPG output is a visual approximation, not an engineering metric model.** `design-3d-preview/route.js:215,2588,2705-2721,3115` includes default/clamped dimensions and heuristic opening attachment. The implementation explicitly warns that preview is separate from engineering BOQ. Never market this path as guaranteed measured geometry or use its inferred furniture/fixtures as verified quantities. Require scale evidence, overlay review and accepted measurement residuals for metric use.
9. **Release gates fail.** Full lint reports 15 errors and 13 warnings, including parse errors in duplicate legacy `src/app/components/ProjectDrawingCenter.jsx:2135` and `src/src/...`. Existing tests: 12 of 15 test files pass; three fail. Material invariance fails for tv_unit; raster geometry has conflicting fixture/test expectations; observed request tests disagree on error/status contracts. Some failures are stale harnesses rather than demonstrated production bugs; they still invalidate a clean regression gate.

## Workflow Assessment

| Workflow | Assessment | Required Commercial Gate |
| --- | --- | --- |
| JPG to 3D | Visual preview implemented; no universal accuracy guarantee | Diverse benchmark plans, dimension/overlay checks, topology and clearance acceptance |
| DWG to 3D | APS translation/extraction and interior presentation implemented | Real DWG corpus, mm/m/ft conversion, layouts/layers/blocks/xrefs and provider failure tests |
| BOQ | Extensive rules/catalog mapping; verified and provisional handling exists | Authorized server inputs, quantity provenance, transactional storage, independent quantity reconciliation |
| Estimate | Verified + provisional + area benchmark envelope; contingency/profit/VAT | Dated regional price sources, scope/version approvals, precision and tax configuration validation |
| Quotation | Generated from browser-saved estimate, draft/PDF flow | Durable immutable issued revisions, permissions, numbering, expiry, exclusions and approval trail |
| Billing | Checkout present; webhook implementation incorrect | Signed webhook tests, duplicate event replay, cancellation/refund/failed-payment cases |
| Engineering Toolbox | Previously non-clickable cards | Functional routes/calculations and explicit limitations; patch included |
| Data Security | Database RLS deployment not supplied | Verify policies with two independent accounts, storage access and tenant separation |

## Estimate Caveats

`ProjectEstimate.jsx:155-181` sets expectedDirectCost to max(measured+provisional, area*rate), then adds contingency and profit and applies VAT. The displayed +/-10% range is a fixed multiplier, not an empirically calibrated uncertainty interval. This is budget planning, not a complete tender estimate. VAT/default assumptions have not been legally validated in this audit.

## Changes Included

Only engineering tools/navigation were changed; no architecture, wall, opening or existing 3D geometry logic was modified.

- Concrete volume including user-specified waste, solid round steel bar mass at stated density, rectangular volume, metric-to-imperial area/length conversion, ventilation arithmetic from user-supplied ACH.
- Project selection for BOQ, quotation, schedule and estimate; supported `?tab=` deep links.
- Published cost catalog page with source fields and error/empty/loading states.
- Replaced unsupported AI scheduler/assistant labels with actual project schedule/cost estimate functionality.
- Calculator validation tests added. MEP tool is arithmetic only, not a design/code-compliance recommendation.

## Verification And Limits

- Calculator tests pass. Changed calculator/tool components pass focused ESLint.
- Existing full suite: 12/15 test files pass after reusing available local dependencies. No clean install was performed.
- Webpack production build succeeds using available Next 16.2.10 dependencies, although supplied manifest requests 16.3.8. This is not a clean-install verification of 16.3.8.
- No live paid AI/APS/Stripe calls, production database writes or real DWG translations were executed. Production RLS, secrets configuration, billing activation and provider accuracy remain unverified.
- Browser automation was attempted but the Chromium executable is unavailable; desktop/mobile visual and interaction verification could not be completed. Calculator arithmetic and server build were checked separately.
- Existing archive includes environment configuration; delivery excludes secrets, caches, dependencies and duplicate `src/src` tree.

## Release Order

1. Fix authorization, SSRF, quota enforcement and signed billing events.
2. Eliminate cross-project takeoff fallback; implement durable revisioned outputs and atomic BOQ updates.
3. Restore clean test/lint gates; clean-install locked dependencies and build in production-equivalent CI.
4. Run JPG/DWG benchmark corpus and two-account security tests; reconcile BOQ/estimate against independently checked reference quantities.
5. Run mobile/desktop browser workflows, payment lifecycle tests, backup/restore and monitoring drills; then launch a bounded supervised pilot.

This audit identifies launch blockers; the included tool patch does not fix those unrelated security/billing issues and must not be advertised as a commercial-ready release.

## Subsequent Requested Patch

Company logo/header editing is now shared between BOQ and Quotation for the current project in this browser. Quotation has manually editable line items, add/remove actions, VAT recalculation and saved draft item snapshots. BOQ's existing row editor is preserved. Print/PDF includes branding; CSV includes textual company data and the existing HTML-based Excel export includes branding. This remains browser-local and does not resolve durable multi-user storage or commercial approval controls. See `BRANDING_QUOTATION_PATCH.md`.
