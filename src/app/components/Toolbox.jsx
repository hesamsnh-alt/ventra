
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import "./Toolbox.css";
import Link from "next/link";
import {
  Calculator,
  Ruler,
  Square,
  Cuboid,
  FileSpreadsheet,
  FileText,
  DollarSign,
  CalendarDays,
  Bot,
  Building2,
  Hammer,
  Wrench,
} from "lucide-react";

const tools = [
  {
    icon: FileSpreadsheet,
    title: "AI BOQ",
    desc: "Automatic quantity takeoff",
  },
  {
    icon: FileText,
    title: "Quotation",
    desc: "Professional proposals",
  },
  {
    icon: DollarSign,
    title: "Cost Database",
    desc: "UAE material prices",
  },
  {
    icon: CalendarDays,
    title: "Project Schedule",
    desc: "Construction timeline",
  },
  {
    icon: Calculator,
    title: "Concrete",
    desc: "Concrete calculator",
  },
  {
    icon: Hammer,
    title: "Steel",
    desc: "Steel weight",
  },
  {
    icon: Square,
    title: "Area",
    desc: "Area converter",
  },
  {
    icon: Cuboid,
    title: "Volume",
    desc: "Volume calculator",
  },
  {
    icon: Ruler,
    title: "Unit Converter",
    desc: "Metric / Imperial",
  },
  {
    icon: Wrench,
    title: "MEP",
    desc: "Engineering tools",
  },
  {
    icon: Bot,
    title: "Cost Estimate",
    desc: "Project cost planning",
  },
  {
    icon: Building2,
    title: "Dashboard",
    desc: "Project analytics",
  },
];
const destinations = ["boq", "quotation", "catalog", "schedule", "concrete", "steel", "area", "volume", "units", "mep", "estimate", "dashboard"];

export default function Toolbox() {
  return (
    <LocalizedElement as="section" className="toolbox">

      <LocalizedElement as="div" className="toolbox-header">

        <LocalizedElement as="span">ENGINEERING TOOLBOX</LocalizedElement>

        <LocalizedElement as="h2">
          Everything Engineers Need.
          <LocalizedElement as="strong"> One Platform.</LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="p">
          More than just BOQ.
          Ventra provides intelligent engineering tools
          for every stage of construction.
        </LocalizedElement>

      </LocalizedElement>

      <LocalizedElement as="div" className="toolbox-grid">

        {tools.map((tool, index) => {

          const Icon = tool.icon;

          return (
            <LocalizedLink 
              href={destinations[index] === "dashboard" ? "/dashboard" : `/tools/${destinations[index]}`}
              style={{ color: "inherit", textDecoration: "none" }}
              className="tool-card"
              key={tool.title}
            >

              <LocalizedElement as="div" className="tool-icon">
                <Icon size={28}/>
              </LocalizedElement>

              <LocalizedElement as="h3">{tool.title}</LocalizedElement>

              <LocalizedElement as="p">{tool.desc}</LocalizedElement>

            </LocalizedLink>
          );

        })}

      </LocalizedElement>

    </LocalizedElement>
  );
}
