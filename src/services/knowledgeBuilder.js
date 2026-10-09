export function buildKnowledge(pageResults) {
  const knowledge = {
    project: {
      name: "",
      disciplines: [],
      sheetIndex: [],
    },

    rooms: [],
    walls: [],
    slabs: [],
    columns: [],

    doors: [],
    windows: [],

    finishes: [],
    schedules: [],
    legends: [],
    notes: [],
    specifications: [],

    conflicts: [],
    missingInformation: [],
  };

  for (const page of pageResults) {
    if (!page) continue;

    knowledge.rooms.push(...(page.rooms || []));
    knowledge.walls.push(...(page.walls || []));
    knowledge.slabs.push(...(page.slabs || []));
    knowledge.columns.push(...(page.columns || []));

    knowledge.doors.push(...(page.doors || []));
    knowledge.windows.push(...(page.windows || []));

    knowledge.finishes.push(...(page.finishes || []));
    knowledge.schedules.push(...(page.schedules || []));
    knowledge.legends.push(...(page.legends || []));
    knowledge.notes.push(...(page.notes || []));
    knowledge.specifications.push(...(page.specifications || []));
  }

  return knowledge;
}