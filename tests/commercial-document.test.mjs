import test from "node:test";
import assert from "node:assert/strict";
import { quotationTotals, brandingHtml } from "../src/lib/commercialDocument.mjs";
test("edited line totals use rounded amounts and configured VAT", () => {
  assert.deepEqual(quotationTotals([{ quantity: 3, rate: 10.115 }, { quantity: 2, rate: 20 }], 5), { subtotal: 70.35, vat: 3.52, total: 73.87 });
  assert.deepEqual(quotationTotals([{ quantity: 2, rate: 50 }], 0), { subtotal: 100, vat: 0, total: 100 });
});
test("invalid commercial inputs are rejected", () => {
  for (const rate of ["", -1, Infinity, "invalid"]) assert.throws(() => quotationTotals([{ quantity: 1, rate }], 5));
  for (const vat of ["", -1, 101, Infinity]) assert.throws(() => quotationTotals([], vat));
});
test("spreadsheet branding escapes user text and excludes arbitrary image URLs", () => {
  const html = brandingHtml({ companyName: '<script>alert(1)</script>', logo: 'https://example.com/image.png' });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('https://'));
});
