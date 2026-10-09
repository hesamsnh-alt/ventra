
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
export default function EngineeringToolbox() {
  const tools = [
    {
      title: "AI Estimation",
      description: "Generate accurate cost estimations in minutes."
    },
    {
      title: "BOQ Generator",
      description: "Create professional Bills of Quantities automatically."
    },
    {
      title: "Quotation Builder",
      description: "Build clean quotations with your company branding."
    },
    {
      title: "Drawing Analysis",
      description: "Extract information from PDF drawings using AI."
    },
    {
      title: "Project Management",
      description: "Organize clients, files and project progress."
    },
    {
      title: "Cloud Storage",
      description: "Access your documents securely from anywhere."
    }
  ];

  return (
    <LocalizedElement as="section" className="toolbox-section">
      <LocalizedElement as="div" className="toolbox-container">

        <LocalizedElement as="div" className="toolbox-title">
          <LocalizedElement as="span">Engineering Toolbox</LocalizedElement>

          <LocalizedElement as="h2">
            Every tool an estimator needs.
          </LocalizedElement>

          <LocalizedElement as="p">
            Everything is designed to help engineers prepare faster,
            smarter and more accurate quotations.
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="toolbox-grid">

          {tools.map((tool, index) => (
            <LocalizedElement as="div" className="tool-card" key={index}>

              <LocalizedElement as="div" className="tool-icon">⚡</LocalizedElement>

              <LocalizedElement as="h3">{tool.title}</LocalizedElement>

              <LocalizedElement as="p">{tool.description}</LocalizedElement>

            </LocalizedElement>
          ))}

        </LocalizedElement>

      </LocalizedElement>
    </LocalizedElement>
  );
}