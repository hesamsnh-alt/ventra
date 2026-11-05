import { partitionEstimateItems } from './estimateClassification.mjs';
import {boqLineAmount} from './boqBudget.mjs';
import {currencySum,currencyPercentage} from './commercialDocument.mjs';

const nonNegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const percent = value => Math.min(100, nonNegative(value));
const sum = rows => currencySum(rows.map(boqLineAmount));

export function calculateProjectEstimate({items = [], basis = 'benchmark', includeProvisional = true,
  floorArea = 0, ratePerSqm = 0, contingencyPct = 0, profitPct = 0, vatPct = 0, scenarioPct = 10} = {}) {
  const mode = basis === 'boq' ? 'boq' : 'benchmark';
  // Invalid prices or quantities must remain unresolved rather than silently cost zero.
  const classified = items.map(row => Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0 &&
    Number.isFinite(Number(row.rate)) && Number(row.rate) > 0 ? row : {...row, verification:'pending'});
  const groups = partitionEstimateItems(classified);
  const measuredCost = sum(groups.verified);
  const provisionalDerivedCost = sum(groups.provisional);
  const coveredBoqCost = currencySum([measuredCost,provisionalDerivedCost]);
  const includedProvisionalCost = includeProvisional ? provisionalDerivedCost : 0;
  const boqBasisCost = currencySum([measuredCost,includedProvisionalCost]);
  const benchmarkAvailable = nonNegative(floorArea) > 0 && nonNegative(ratePerSqm) > 0;
  const benchmarkBase = boqLineAmount({quantity:nonNegative(floorArea),rate:nonNegative(ratePerSqm)});
  const expectedDirectCost = mode === 'benchmark' ? benchmarkBase : boqBasisCost;
  const benchmarkDifference = benchmarkAvailable ? benchmarkBase - coveredBoqCost : null;
  const contingency = currencyPercentage(expectedDirectCost,percent(contingencyPct));
  const profit = currencyPercentage(currencySum([expectedDirectCost,contingency]),percent(profitPct));
  const tenderBeforeVat = currencySum([expectedDirectCost,contingency,profit]);
  const vat = currencyPercentage(tenderBeforeVat,percent(vatPct));
  const finalTender = currencySum([tenderBeforeVat,vat]);
  const sections = new Map();
  for (const [kind, rows] of Object.entries(groups)) for (const row of rows) {
    const name = String(row.section || row.category || 'Unclassified');
    if (!sections.has(name)) sections.set(name, {name, verified:0, provisional:0, pending:0, count:0});
    const section = sections.get(name);
    section.count++;
    if (kind === 'pending') section.pending++;
    else section[kind] = currencySum([section[kind],boqLineAmount(row)]);
  }
  return {basis:mode, groups, measuredCost, provisionalDerivedCost, coveredBoqCost,
    includedProvisionalCost, boqBasisCost, benchmarkBase, benchmarkAvailable, benchmarkDifference,
    expectedDirectCost, contingency, profit, tenderBeforeVat, vat, finalTender,
    low:boqLineAmount({quantity:Math.max(0,finalTender-currencyPercentage(finalTender,percent(scenarioPct))),rate:1}),
    high:currencySum([finalTender,currencyPercentage(finalTender,percent(scenarioPct))]),
    ready:mode === 'benchmark' ? benchmarkAvailable : boqBasisCost > 0,
    sections:[...sections.values()]};
}
