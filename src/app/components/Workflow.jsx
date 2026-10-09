
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
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
    title: "Review Cost Rates",
    text: "Confirm rates, scope and allowances",
  },
  {
    icon: FileText,
    title: "Branded Quotation Builder",
    text: "Edit items, review totals and export PDF",
  },
  {
    icon: CalendarRange,
    title: "BOQ-Based Project Planning",
    text: "Timeline, Activities & Dependencies",
  },
  {
    icon: Calculator,
    title: "Reported Project Progress",
    text: "Checklists, milestones and delays",
  },
  {
    icon: LayoutDashboard,
    title: "Executive Dashboard",
    text: "Analytics, Reports & Cash Flow",
  },
];
export default function Workflow() {
  return (
    <LocalizedElement as="section" className="workflow" id="workflow">
      <LocalizedElement as="div" className="workflow-bg"></LocalizedElement>

      <LocalizedElement as="div" className="workflow-header">

        <LocalizedElement as="span" className="workflow-tag">
          AI WORKFLOW
        </LocalizedElement>

        <LocalizedElement as="h2">
From Scope to Proposal.
<LocalizedElement as="span"> Supported by Your Review.</LocalizedElement>
</LocalizedElement>

<LocalizedElement as="p">
Upload drawings, generate BOQs, estimate UAE costs,
create quotations, plan activities,
track progress and monitor payments
inside one intelligent platform.
</LocalizedElement>

      </LocalizedElement>

      <LocalizedElement as="div" className="workflow-grid">

        {steps.map((step, index) => {

          const Icon = step.icon;

          return (

            <LocalizedElement as="div"
              className="workflow-card"
              key={step.title}
            >

              <LocalizedElement as="div" className="workflow-number">

                {String(index + 1).padStart(2, "0")}

              </LocalizedElement>

              <LocalizedElement as="div" className="workflow-icon">

                <Icon size={28} />

              </LocalizedElement>

              <LocalizedElement as="h3">

                {step.title}

              </LocalizedElement>

              <LocalizedElement as="p">

                {step.text}

              </LocalizedElement>

            </LocalizedElement>

          );

        })}

      </LocalizedElement>
    </LocalizedElement>
  );
}