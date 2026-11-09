# Single-assignment source classification v142

Status: local follow-up to the failed v141 preview test; not live-verified or deployed.

The real v141 response put one source ID (`solid_band5`) in both `walls` and `nonWalls`. Removing an entry automatically would choose its architectural meaning without evidence, so the rejected response is retained as a regression fixture.

The new wire format requires a `candidateRoles` object with every measured candidate ID exactly once and one scalar role per ID. A candidate cannot simultaneously occupy two independent semantic lists. An explicit `unresolved` role still prevents acceptance. The server derives disjoint wall/non-wall collections without changing any returned role or source coordinate. Legacy saved diagnostic selections retain their original validation behavior, including rejection of the real contradictory response.

The shared role enum uses a root `$defs` reference rather than repeating an enum for each candidate. Official Structured Outputs guidance permits definitions and limits the total enum value count to 1,000: https://developers.openai.com/api/docs/guides/structured-outputs . The maximum 700-candidate/700-gap schema is checked locally against this limit.

Tests cover the actual contradictory response, incomplete/invented/multivalued roles, mixed response formats, unresolved roles, schema size, and a role-map response going through the full local graph and scene compiler. The background bundle and request/worker version are regenerated. The existing topology, opening and image-support checks remain active.

This prevents one response-shape contradiction. It does not prove that a model's chosen role is semantically correct or that this user's floor plan now reconstructs successfully. No new paid generation request was made after the v141 result.
