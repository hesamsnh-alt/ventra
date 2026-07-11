import "./Toolbox.css";
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
    title: "AI Scheduler",
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
    title: "AI Assistant",
    desc: "Construction AI",
  },
  {
    icon: Building2,
    title: "Dashboard",
    desc: "Project analytics",
  },
];

export default function Toolbox() {
  return (
    <section className="toolbox">

      <div className="toolbox-header">

        <span>ENGINEERING TOOLBOX</span>

        <h2>
          Everything Engineers Need.
          <strong> One Platform.</strong>
        </h2>

        <p>
          More than just BOQ.
          Ventra provides intelligent engineering tools
          for every stage of construction.
        </p>

      </div>

      <div className="toolbox-grid">

        {tools.map((tool) => {

          const Icon = tool.icon;

          return (
            <div
              className="tool-card"
              key={tool.title}
            >

              <div className="tool-icon">
                <Icon size={28}/>
              </div>

              <h3>{tool.title}</h3>

              <p>{tool.desc}</p>

            </div>
          );

        })}

      </div>

    </section>
  );
}