import test from "node:test";
import assert from "node:assert/strict";
import { calculateTool } from "../src/lib/engineeringTools.mjs";
test("quantity calculations and exact unit conversions", () => {
  assert.equal(calculateTool("concrete", { length: 5, width: 4, depth: 0.2, waste: 5 }), 4.2);
  assert.equal(calculateTool("volume", { length: 5, width: 4, depth: 3 }), 60);
  assert.ok(Math.abs(calculateTool("steel", { diameter: 16, length: 12, count: 10 }) - 189.4003378996) < 0.00001);
  assert.equal(calculateTool("units", { length: 0.3048 }), 1);
  assert.equal(calculateTool("area", { area: 0.3048 ** 2 }), 1);
  assert.equal(calculateTool("mep", { volume: 60, ach: 6 }), 360);
});
test("invalid and nonfinite inputs cannot produce a quote quantity", () => {
  for (const length of ["", -1, 0, Infinity, "invalid"]) assert.throws(() => calculateTool("units", { length }));
  assert.throws(() => calculateTool("steel", { diameter: 16, length: 12, count: 1.5 }));
  assert.throws(() => calculateTool("unknown", {}));
});
