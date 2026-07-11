import "./Workflow.css";
import {
  Upload,
  Brain,
  Calculator,
  DollarSign,
  FileText,
  CalendarRange,
  LayoutDashboard,
} from "lucide-react";
const steps = [
  {
    icon: Upload,
    title: "Upload Drawings",
    text: "PDF, DWG, IFC, Images",
  },
  {
    icon: Brain,
    title: "AI BOQ Generation",
    text: "Rooms, Walls, Concrete, Steel",
  },
  {
    icon: DollarSign,
    title: "Live UAE Cost Database",
    text: "Materials, Labour & Equipment",
  },
  {
    icon: FileText,
    title: "AI Quotation Builder",
    text: "Generate branded quotations instantly",
  },
  {
    icon: CalendarRange,
    title: "AI Project Planning",
    text: "Timeline, Activities & Dependencies",
  },
  {
    icon: Calculator,
    title: "Construction Monitoring",
    text: "Progress, Payments & Delay Risk",
  },
  {
    icon: LayoutDashboard,
    title: "Executive Dashboard",
    text: "Analytics, Reports & Cash Flow",
  },
];
export default function Workflow() {
  return (
    <section className="workflow" id="workflow">
      <div className="workflow-bg"></div>

      <div className="workflow-header">

        <span className="workflow-tag">
          AI WORKFLOW
        </span>

        <h2>
Everything Your Project Needs.
<span> Powered by AI.</span>
</h2>

<p>
Upload drawings, generate BOQs, estimate UAE costs,
create quotations, plan activities,
track progress and monitor payments
inside one intelligent platform.
</p>

      </div>

      <div className="workflow-grid">

        {steps.map((step, index) => {

          const Icon = step.icon;

          return (

            <div
              className="workflow-card"
              key={step.title}
            >

              <div className="workflow-number">

                {String(index + 1).padStart(2, "0")}

              </div>

              <div className="workflow-icon">

                <Icon size={28} />

              </div>

              <h3>

                {step.title}

              </h3>

              <p>

                {step.text}

              </p>

            </div>

          );

        })}

      </div>
    </section>
  );
}