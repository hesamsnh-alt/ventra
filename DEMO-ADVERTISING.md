# Ventra product demo

`/demo` is a labelled, self-contained sample presentation. It does not upload or analyze files, run the actual 3D viewer, certify progress, assess cost certainty, or approve payments.

The tour shows upload review, an animated 3D illustration, four sample BOQ rows, contract stages, sequential scheduling, reported site records, and a sample report.

Download sample report exports JSON. Copy demo link copies the public sample URL only, never a private project report. Open workspace links take users to project creation.

The real BOQ Schedule calculates a conservative finish-to-start sequence from reviewed quantities, method output, crews, working hours, holidays and waiting times. It is not a CPM or resource optimisation engine.

Shared scheduling installation requires both migrations in order: `20261006_project_control.sql`, then `20261007_boq_schedule_plans.sql`. Verify installation using `scripts/Ventra-Database-Check.sql`.

Drawing text evidence is preserved when Autodesk exposes text properties. DWG schedule cells and specifications are not automatically reconciled into verified BOQ rows; the real workspace requires review.
