# Ventra 3D network/cost safety patch — 2026-09-19

Scope: raster schematic 3D request transport only. No database, Supabase, Auth, BOQ, Estimate, Quotation, APS credentials, or persistence schema changes.

## Fixed
- Rebuilds a fresh fetch request init for every client retry so JSON body/headers are not reused in a possibly consumed/mutated state.
- Reduces schematic network retries from 5 to 3.
- Adds safe empty-body and invalid-JSON handling in `/api/ai/design-3d` instead of throwing an unhandled `Unexpected end of JSON input`.
- Adds server-side request coalescing/idempotency keyed by the existing `requestId` for 90 seconds. If a client retry reaches the server after the first request already started, the same in-flight/result response is reused instead of starting another expensive Vision call.

## Important finding
The raster Analyze flow still performs two separate AI operations by design:
1. `/api/ai/design-3d` (default model gpt-5.1) for schematic geometry.
2. `/api/ai/analyze-drawing` (default model gpt-5) for takeoff.

This patch does NOT remove the second operation because it feeds the existing takeoff/BOQ workflow and the requested scope was to avoid changing those systems.
