export const calculators = {
  concrete: { title: "Concrete Volume", fields: [["length", "Length (m)", 5], ["width", "Width (m)", 4], ["depth", "Thickness (m)", 0.2], ["waste", "Waste (%)", 5]], unit: "m3" },
  steel: { title: "Round Steel Bar Weight", fields: [["diameter", "Diameter (mm)", 16], ["length", "Length per bar (m)", 12], ["count", "Number of bars", 10]], unit: "kg" },
  area: { title: "Area Converter", fields: [["area", "Area (m2)", 100]], unit: "ft2" },
  volume: { title: "Rectangular Volume", fields: [["length", "Length (m)", 5], ["width", "Width (m)", 4], ["depth", "Height (m)", 3]], unit: "m3" },
  units: { title: "Length Converter", fields: [["length", "Length (m)", 1]], unit: "ft" },
  mep: { title: "Ventilation Flow Calculator", fields: [["volume", "Room volume (m3)", 60], ["ach", "Specified air changes per hour", 6]], unit: "m3/h" },
};
export function calculateTool(id, values) {
  const tool = calculators[id];
  if (!tool) throw new Error("Unknown calculator.");
  for (const [key] of tool.fields) {
    const value = values[key];
    if (value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || (key !== "waste" && Number(value) === 0)) throw new Error("Enter finite positive values; waste may be zero.");
  }
  if (id === "steel" && !Number.isInteger(Number(values.count))) throw new Error("Bar count must be a whole number.");
  const v = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
  const results = {
    concrete: () => v.length * v.width * v.depth * (1 + v.waste / 100),
    steel: () => Math.PI * (v.diameter / 1000) ** 2 / 4 * v.length * v.count * 7850,
    area: () => v.area / 0.3048 ** 2,
    volume: () => v.length * v.width * v.depth,
    units: () => v.length / 0.3048,
    mep: () => v.volume * v.ach,
  };
  const result = results[id]();
  if (!Number.isFinite(result)) throw new Error("Input is too large.");
  return result;
}
