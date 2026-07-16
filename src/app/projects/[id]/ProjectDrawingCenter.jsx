"use client";

import {
  UploadCloud,
  ScanSearch,
  FileSpreadsheet,
  Brain,
  FileStack,
} from "lucide-react";

import "./ProjectDrawingCenter.css";

export default function ProjectDrawingCenter() {

  const aiTools = [

    {
      icon: UploadCloud,
      title: "Upload Drawing",
      text: "Upload PDF, DWG or IFC files",
    },

    {
      icon: ScanSearch,
      title: "AI Quantity Takeoff",
      text: "Detect walls, slabs, doors and windows",
    },

    {
      icon: FileSpreadsheet,
      title: "Generate BOQ",
      text: "Automatic quantity schedule",
    },

    {
      icon: Brain,
      title: "AI Cost Estimate",
      text: "Calculate project cost instantly",
    },

    {
      icon: FileStack,
      title: "Quotation Builder",
      text: "Generate professional quotation",
    },

  ];

  return (

<section className="drawing-center">

<div className="drawing-header">

<span>AI CONSTRUCTION ENGINE</span>

<h2>Drawing Center</h2>

</div>

<div className="drawing-grid">

{aiTools.map((tool)=>{

const Icon=tool.icon;

return(

<div
className="drawing-card"
key={tool.title}
>

<div className="drawing-icon">

<Icon size={30}/>

</div>

<h3>{tool.title}</h3>

<p>{tool.text}</p>

<button>

Open

</button>

</div>

);

})}

</div>

</section>

  );

}