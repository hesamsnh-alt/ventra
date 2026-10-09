# BOQ And Quotation Editing - 2026-10-06

This source snapshot includes the previous engineering tools patch plus company branding and quotation item editing. No geometry changes were made.

## Use

- In either BOQ or Quotation, open `Company logo and letterhead`.
- Enter company name, address, contact and tax registration number. Upload PNG/JPG/WebP logo and optional header image, each up to 2 MB. The header image is not a full-page stationery background.
- Branding is shared between BOQ and Quotation for this project in the same browser.
- Existing BOQ row editing remains intact. Measured quantities retain the existing unlock mechanism.
- In Quotation, choose `Edit quotation items` to start from the current estimate subtotal as one lot item, or create manual items without an estimate. Edit descriptions, units, quantities and rates; add/remove rows; set VAT. This does not edit Estimate or automatically import all BOQ rows.
- `Use estimate total` discards manual quotation items and returns to the estimate total. `Save Draft` retains the manual items/VAT and a branding snapshot. Print/PDF includes the visible company header and item amounts.
- BOQ CSV includes textual company details. BOQ Excel HTML export includes logo/header; it remains the existing HTML-based .xls export, not a native XLSX workbook.

## Validation And Limits

Five calculation/validation tests pass. Webpack production build passes using available Next 16.2.10 dependencies; manifest remains 16.3.8. Existing unrelated lint errors remain. Browser/PDF visual testing was not possible without Chromium.

Branding and quotation drafts are stored locally, not synchronized to company accounts or cloud storage. This patch does not resolve the launch blockers in the commercial audit. Keep private `.env.local` separately and test this source in a new folder before replacing your working project.
