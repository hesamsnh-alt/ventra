export const BOQ_SECTIONS = [
  {
    id: "preliminaries",
    name: "Preliminaries",
    code: "PRE",
    color: "#64748b",
  },
  {
    id: "demolition",
    name: "Demolition",
    code: "DEM",
    color: "#ef4444",
  },
  {
    id: "earthworks",
    name: "Earthworks",
    code: "EAR",
    color: "#92400e",
  },
  {
    id: "concrete",
    name: "Concrete",
    code: "CON",
    color: "#6b7280",
  },
  {
    id: "reinforcement",
    name: "Reinforcement",
    code: "REB",
    color: "#dc2626",
  },
  {
    id: "formwork",
    name: "Formwork",
    code: "FRM",
    color: "#a16207",
  },
  {
    id: "masonry",
    name: "Masonry",
    code: "MAS",
    color: "#ea580c",
  },
  {
    id: "plaster",
    name: "Plaster",
    code: "PLS",
    color: "#d97706",
  },
  {
    id: "flooring",
    name: "Flooring",
    code: "FLR",
    color: "#0f766e",
  },
  {
    id: "ceiling",
    name: "Ceiling",
    code: "CEL",
    color: "#0ea5e9",
  },
  {
    id: "painting",
    name: "Painting",
    code: "PNT",
    color: "#7c3aed",
  },
  {
    id: "doors",
    name: "Doors",
    code: "DOR",
    color: "#2563eb",
  },
  {
    id: "windows",
    name: "Windows",
    code: "WIN",
    color: "#06b6d4",
  },
  {
    id: "electrical",
    name: "Electrical",
    code: "ELE",
    color: "#f59e0b",
  },
  {
    id: "mechanical",
    name: "Mechanical",
    code: "MEC",
    color: "#475569",
  },
  {
    id: "plumbing",
    name: "Plumbing",
    code: "PLB",
    color: "#2563eb",
  },
  {
    id: "fire_fighting",
    name: "Fire Fighting",
    code: "FF",
    color: "#b91c1c",
  },
  {
    id: "external",
    name: "External Works",
    code: "EXT",
    color: "#16a34a",
  },
  {
    id: "landscape",
    name: "Landscape",
    code: "LAN",
    color: "#15803d",
  },
  {
    id: "other",
    name: "Other",
    code: "OTH",
    color: "#64748b",
  },
];

export const DEFAULT_SECTION = "other";

export function getSection(id) {
  return (
    BOQ_SECTIONS.find((section) => section.id === id) ??
    BOQ_SECTIONS.find((section) => section.id === DEFAULT_SECTION)
  );
}