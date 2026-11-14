export const LOWER_CABINETS = [-2.82, -2.02, -1.22, -0.42, 0.38, 1.18, 1.98];
export const UPPER_CABINETS = [-2.82, -2.02, 1.18, 1.98];
export const ISLAND_CABINETS = [
  { x: -0.86, width: 0.61 }, { x: -0.24, width: 0.61 },
  { x: 0.55, width: 0.88 }, { x: 1.13, width: 0.30 },
];

export const STORAGE_GROUPS = [
  {
    label: "کابینت‌های بالا",
    items: UPPER_CABINETS.map((_, index) => ["upper" + index, "درِ بالا " + (index + 1).toLocaleString("fa")]),
  },
  {
    label: "کابینت‌های پایین",
    items: LOWER_CABINETS.map((_, index) => [
      "lower" + index, index === 4 ? "کشوی زیر فر" : "درِ پایین " + (index + 1).toLocaleString("fa"),
    ]),
  },
  {
    label: "کابینت‌ها و کشوهای جزیره",
    items: [...ISLAND_CABINETS.map((_, index) => ["island" + index, "درِ جزیره " + (index + 1).toLocaleString("fa")]),
      ["drawer", "کشوی قاشق و چنگال"]],
  },
];

export const STORAGE_ACTIONS = new Set(STORAGE_GROUPS.flatMap(group => group.items.map(([action]) => action)));
