import { partitionEstimateItems } from './estimateClassification.mjs';

const nonNegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const percent = value => Math.min(100, nonNegative(value));
const sum = rows => rows.reduce((total, row) => total + Number(row.quantity) * Number(row.rate), 0);

export function calculateProjectEstimate({items = [], basis = 'benchmark', includeProvisional = true,
  floorArea = 0, ratePerSqm = 0, contingencyPct = 0, profitPct = 0, vatPct = 0, scenarioPct = 10} = {}) {
  const mode = basis === 'boq' ? 'boq' : 'benchmark';
  // Invalid prices or quantities must remain unresolved rather than silently cost zero.
  const classified = items.map(row => Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0 &&
    Number.isFinite(Number(row.rate)) && Number(row.rate) > 0 ? row : {...row, verification:'pending'});
  const groups = partitionEstimateItems(classified);
  const measuredCost = sum(groups.verified);
  const provisionalDerivedCost = sum(groups.provisional);
  const coveredBoqCost = measuredCost + provisionalDerivedCost;
  const includedProvisionalCost = includeProvisional ? provisionalDerivedCost : 0;
  const boqBasisCost = measuredCost + includedProvisionalCost;
  const benchmarkAvailable = nonNegative(floorArea) > 0 && nonNegative(ratePerSqm) > 0;
  const benchmarkBase = nonNegative(floorArea) * nonNegative(ratePerSqm);
  const expectedDirectCost = mode === 'benchmark' ? benchmarkBase : boqBasisCost;
  const benchmarkDifference = benchmarkAvailable ? benchmarkBase - coveredBoqCost : null;
  const contingency = expectedDirectCost * percent(contingencyPct) / 100;
  const profit = (expectedDirectCost + contingency) * percent(profitPct) / 100;
  const tenderBeforeVat = expectedDirectCost + contingency + profit;
  const vat = tenderBeforeVat * percent(vatPct) / 100;
  const finalTender = tenderBeforeVat + vat;
  const sections = new Map();
  for (const [kind, rows] of Object.entries(groups)) for (const row of rows) {
    const name = String(row.section || row.category || 'Unclassified');
    if (!sections.has(name)) sections.set(name, {name, verified:0, provisional:0, pending:0, count:0});
    const section = sections.get(name);
    section.count++;
    if (kind === 'pending') section.pending++;
    else section[kind] += Number(row.quantity) * Number(row.rate);
  }
  return {basis:mode, groups, measuredCost, provisionalDerivedCost, coveredBoqCost,
    includedProvisionalCost, boqBasisCost, benchmarkBase, benchmarkAvailable, benchmarkDifference,
    expectedDirectCost, contingency, profit, tenderBeforeVat, vat, finalTender,
    low:finalTender * (1 - percent(scenarioPct) / 100), high:finalTender * (1 + percent(scenarioPct) / 100),
    ready:mode === 'benchmark' ? benchmarkAvailable : boqBasisCost > 0,
    sections:[...sections.values()]};
}
