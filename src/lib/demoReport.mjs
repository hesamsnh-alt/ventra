export const demoBoqRows = [
  ['Concrete & rebar', 'Structural', 'm³', '184', 'AED 214,880', '92%'],
  ['Blockwork & plaster', 'Envelope', 'm²', '1,240', 'AED 148,800', '61%'],
  ['Electrical first fix', 'MEP', 'point', '168', 'AED 57,120', '38%'],
  ['Flooring & joinery', 'Finishes', 'm²', '710', 'AED 192,940', '24%'],
];
export const demoReport = {
  sample: true, projectName: 'AL NOOR VILLA RENOVATION',
  note: 'Illustrative sample only. No project was analyzed, no quantities/specifications/rates were verified and no payment was approved.',
  contractValueAED: 1240000, reportedProgressPercent: 46,
  scheduleMode: 'sequential', reportedMepProgressPercent: 38,
  boq: demoBoqRows.map(([description, section, unit, quantity, amount, progress]) => ({
    description, section, unit, quantity: Number(quantity.replaceAll(',', '')),
    amountAED: Number(amount.replace(/[^\d.]/g, '')), reportedProgress: progress, verification: 'sample_unreviewed',
  })),
  scopeComplete: false,
};
demoReport.boqSubtotalAED = demoReport.boq.reduce((sum, row) => sum + row.amountAED, 0);

export function downloadDemoReport(report = demoReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'ventra-sample-report.json';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
