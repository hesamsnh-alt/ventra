import { notFound } from "next/navigation";
import EngineeringTool from "./EngineeringTool";
import { calculators } from "@/lib/engineeringTools.mjs";

const workflows = { boq: ["BOQ Generator", "boq"], quotation: ["Quotation Builder", "quotation"], schedule: ["Project Schedule", "schedule"], estimate: ["Cost Estimate", "estimate"], catalog: ["Cost Database", "boq"], drawings: ["Drawing Analysis / Upload", "drawings"], documents: ["Project Documents", "documents"], reports: ["Daily Reports", "reports"], model3d: ["3D Model", "model3d"] };
export default async function ToolPage({ params }) {
  const { tool } = await params;
  if (!calculators[tool] && !workflows[tool]) notFound();
  return <EngineeringTool toolId={tool} workflow={workflows[tool] || null} />;
}
