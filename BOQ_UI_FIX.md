# BOQ UI and export fix

Updated `src/app/projects/[id]/ProjectBOQ.jsx` and `ProjectBOQ.css`.

## Implemented
- Section dropdown with normalized section names.
- Unit dropdown with common BOQ units.
- Automatic item numbering by section after generate, add, delete, or section change.
- Non-negative quantity and rate handling.
- Live amount, subtotal, VAT, and grand total calculations.
- Wider description column, right-aligned numeric columns, and sticky table header.
- CSV export retained.
- Excel-compatible `.xls` export added.
- Print/PDF export added through the browser print dialog.
- Print-specific BOQ layout added.
- Empty BOQ state now persists to local storage after deleting all rows.
- VAT value of 0 is now restored correctly from local storage.

## Validation
- Source was manually reviewed after modification.
- Full Next.js build could not be run because the configured npm registry returned 404 for `zustand@5.0.14` during dependency installation.
