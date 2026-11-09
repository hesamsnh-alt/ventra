# Per-document 3D model retention

## Reproduced shared failure

The project stored one schematic scene/base and one engineering record. Saving a second drawing replaced the first drawing's saved model. Source-identity guards correctly refused the mismatched record, leaving the original drawing without an accessible model. This affects JPG/PDF scene switching and DXF/DWG engineering switching independently of reconstruction quality.

A new regression suite first reproduced three failures: JPG/PDF model recovery after saving another document, retention of each document's original scene, and selection of the requested CAD record instead of the latest different CAD record. It also preserved the negative check that an unbuilt document must not borrow a different document's model.

## Repair

Schematic scenes and their local original/base records are now archived by document ID alongside the backward-compatible project pointer. Existing identified legacy current/base data is archived before replacement. Engineering records retain document archives and an index so explicit clearing removes them too. Document-scoped reads do not change the general latest engineering pointer or merge geometry from different drawings.

Cloud model saves keep per-document schematic/engineering objects in the authenticated project-owner namespace and retain legacy project pointers for older clients. Reads can request a document and reject mismatched legacy fallbacks. Before replacing a legacy project record of a different document, the old identified model is preserved without overwriting an existing archive. Existing owner/member checks and APS access checks remain in place; no database schema or policies changed.

The viewer subscribes to selected-document changes, loads that document's cloud/local model, and filters engineering candidates by document before choosing a record. This prevents a newer unrelated file from masking the selected file's older valid geometry. Existing control handlers remain unchanged.

## Verification and limits

All 1,630 offline tests passed after integration, including PDF scene generation, CAD reconstruction/recovery, source identity, storage failure/quota behavior, cloud access and existing viewer controls. The final archive guard passed its 26 focused tests; the production build passed. No OpenAI request, APS translation, production deployment or database mutation was performed during this investigation.

This fixes retention and selection of existing models; it does not establish successful reconstruction of arbitrary JPG, DXF, DWG or PDF inputs. Already overwritten historical models cannot be recovered by adding archives afterward. Cloud snapshots preserve current scenes; original/base architecture is retained locally, not as a separate cloud base version.

Production remained on Netlify deploy `6af07ad02962c86a489c6667`. The existing isolated v140 preview still reports `aiKeyStatus: unusable_header` through its non-sensitive configuration endpoint; no secret values were read. Its JPG classification remains blocked by unusable preview configuration. Production JPG logs independently contain incomplete classification and graph-budget failures. The native PDF compiler currently accepts specific dimensioned/vector plan conventions and is not a general PDF reconstruction engine. No live full-format success is claimed.
