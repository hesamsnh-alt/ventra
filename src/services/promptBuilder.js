export function buildTakeoffPrompt({
  pageNumber = null,
  projectName = "",
  discipline = "",
} = {}) {
  return `
You are a construction quantity surveyor.

Analyze the uploaded architectural or construction drawing.

Extract only quantities that are clearly visible or can be reasonably inferred from the drawing.

Important rules:

1. Do not invent dimensions.
2. If no usable scale or dimensions are visible, return zero for measurements that cannot be calculated.
3. Count rooms, doors and windows only when they are clearly visible.
4. Length units must be meters.
5. Area units must be square meters.
6. Confidence must be between 0 and 100.
7. Explain uncertainty inside notes.
8. detected_items must include useful visible construction items.
9. Ignore title blocks, logos, stamps, borders and revision tables.
10. This is a preliminary AI takeoff and must be reviewed by a quantity surveyor.

Project name:
${projectName || "Unknown"}

Discipline:
${discipline || "Unknown"}

Page number:
${pageNumber ?? "Unknown"}

Return only valid JSON matching the provided schema.
  `.trim();
}