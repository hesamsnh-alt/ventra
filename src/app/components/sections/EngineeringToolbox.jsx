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
    <section className="toolbox-section">
      <div className="toolbox-container">

        <div className="toolbox-title">
          <span>Engineering Toolbox</span>

          <h2>
            Every tool an estimator needs.
          </h2>

          <p>
            Everything is designed to help engineers prepare faster,
            smarter and more accurate quotations.
          </p>
        </div>

        <div className="toolbox-grid">

          {tools.map((tool, index) => (
            <div className="tool-card" key={index}>

              <div className="tool-icon">⚡</div>

              <h3>{tool.title}</h3>

              <p>{tool.description}</p>

            </div>
          ))}

        </div>

      </div>
    </section>
  );
}