# BOQ and Estimate complete correction

Implemented in this build:

- BOQ item numbering is now sequential and automatically rebuilt after add/delete/reorder-by-generation.
- Window measurement uses m² only when a real total window area is available; otherwise it uses `nos` and the detected count.
- Door measurement uses detected count in `nos`.
- Paint and plaster use net wall area when opening dimensions/areas exist. When they do not exist, the UI explicitly identifies the quantity as gross wall area rather than inventing a deduction.
- Description fields are multiline, expandable, and expose full measurement/source details in a tooltip.
- Line amounts use a neutral readable color. Yellow is reserved for the final grand total.
- Local fallback BOQ now creates separate plaster and painting items and applies the same opening rules.
- Estimate now reads the latest saved BOQ instead of using hard-coded sample costs.
- Estimate supports editable overhead, contingency, profit, discount, and VAT percentages and calculates the final tender price.

Validation:

- JavaScript service files passed `node --check`.
- JSX delimiter counts were checked and balanced.
- The final ZIP was integrity-tested with `unzip -t`.
- A full Next.js build was not run because dependencies are not bundled in the uploaded project.
