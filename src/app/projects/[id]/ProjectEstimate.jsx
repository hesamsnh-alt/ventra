"use client";

import { useState } from "react";
import "./ProjectEstimate.css";

export default function ProjectEstimate() {

  const [estimate, setEstimate] = useState({

    material:250000,

    labour:120000,

    equipment:35000,

    subcontractor:60000,

    overhead:30000,

    contingency:25000,

  });

  const subtotal=

    estimate.material+

    estimate.labour+

    estimate.equipment+

    estimate.subcontractor+

    estimate.overhead+

    estimate.contingency;

  function update(field,value){

    setEstimate(current=>({

      ...current,

      [field]:Number(value)

    }));

  }

  return(

<section className="estimate-panel">

<div className="estimate-header">

<div>

<span>COST ESTIMATE</span>

<h2>Project Estimate</h2>

</div>

</div>

<div className="estimate-grid">

{Object.entries(estimate).map(([key,value])=>(

<div
className="estimate-card"
key={key}
>

<label>

{key.replace("_"," ")}

</label>

<input

type="number"

value={value}

onChange={(e)=>update(key,e.target.value)}

/>

</div>

))}

</div>

<div className="estimate-total">

<span>Total Estimated Cost</span>

<strong>

AED {subtotal.toLocaleString()}

</strong>

</div>

</section>

  );

}