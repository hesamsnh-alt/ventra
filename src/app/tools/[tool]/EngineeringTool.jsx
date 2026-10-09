"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import { useEffect, useState } from "react";
import Link from "next/link";
import { calculators, calculateTool } from "@/lib/engineeringTools.mjs";
import { getProjects } from "@/lib/database";
import "./tools.css";

export default function EngineeringTool({ toolId, workflow }) {
  const tool = calculators[toolId];
  const [values, setValues] = useState(() => Object.fromEntries((tool?.fields || []).map(([key, , value]) => [key, String(value)])));
  const [projects, setProjects] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    if (!workflow) return;
    let active = true;
    if (toolId === "catalog") {
      fetch("/api/boq/catalog").then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error("Catalog unavailable");
        if (active) { setCatalog(payload.catalog.sections || []); setStatus("ready"); }
      }).catch(() => { if (active) setStatus("error"); });
      return () => { active = false; };
    }
    getProjects().then(({ data, error }) => { if (active) { setProjects(data); setStatus(error ? "error" : "ready"); } }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [workflow, toolId]);
  let result, error;
  if (tool) { try { result = calculateTool(toolId, values); } catch (cause) { error = cause.message; } }
  return <LocalizedElement as="main" className="engineering-tool">
    <LocalizedElement as="nav"><LocalizedLink  href="/">Ventra</LocalizedLink><LocalizedLink  href="/dashboard">Dashboard</LocalizedLink></LocalizedElement>
    <LocalizedElement as="h1">{tool?.title || workflow[0]}</LocalizedElement>
    <OriginalText>{tool ? <>
      <LocalizedElement as="div" className="engineering-fields">{tool.fields.map(([key, label]) => <LocalizedElement as="label" key={key}>{label}<LocalizedElement as="input" type="number" min={key === "waste" ? 0 : 0.000001} step={key === "count" ? 1 : "any"} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></LocalizedElement>)}</LocalizedElement>
      {error ? <LocalizedElement as="p" role="alert">{error}</LocalizedElement> : <LocalizedElement as="output" aria-live="polite">{result.toLocaleString("en", { maximumFractionDigits: 4 })} {tool.unit}</LocalizedElement>}
      <LocalizedElement as="p" className="engineering-note">Quantity calculation only, not structural or code-compliance design. {toolId === "steel" && "Solid round steel bars; assumed density 7850 kg/m3."}{toolId === "mep" && "Air changes are supplied by you; this tool does not prescribe ventilation requirements."}</LocalizedElement>
    </> : toolId === "catalog" ? <>
      {status === "loading" && <LocalizedElement as="p" role="status">Loading catalog...</LocalizedElement>}
      {status === "error" && <LocalizedElement as="p" role="alert">Price catalog could not be loaded.</LocalizedElement>}
      {status === "ready" && !catalog.length && <LocalizedElement as="p">No published price items.</LocalizedElement>}
      <LocalizedElement as="p">Published catalog rates in AED. Confirm rate date and scope before tendering.</LocalizedElement>
      {catalog.map((section) => <LocalizedElement as="section" key={section.sectionCode}><LocalizedElement as="h2">{section.sectionName}</LocalizedElement><LocalizedElement as="div" style={{ overflowX: "auto" }}><LocalizedElement as="table"><LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Item</LocalizedElement><LocalizedElement as="th">Unit</LocalizedElement><LocalizedElement as="th">Standard AED</LocalizedElement><LocalizedElement as="th">Source</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="tbody">{section.items.map((item) => <LocalizedElement as="tr" key={item.itemCode}><LocalizedElement as="td">{item.description}</LocalizedElement><LocalizedElement as="td">{item.unit}</LocalizedElement><LocalizedElement as="td">{item.standardRate}</LocalizedElement><LocalizedElement as="td">{item.sourceName || "Not supplied"}</LocalizedElement></LocalizedElement>)}</LocalizedElement></LocalizedElement></LocalizedElement></LocalizedElement>)}
    </> : <>
      <LocalizedElement as="h2">Select Project</LocalizedElement>
      {status === "loading" && <LocalizedElement as="p" role="status">Loading projects...</LocalizedElement>}
      {status === "error" && <LocalizedElement as="p" role="alert">Projects could not be loaded. <LocalizedLink  href="/login">Sign in</LocalizedLink> and try again.</LocalizedElement>}
      {status === "ready" && !projects.length && <LocalizedElement as="p">No accessible projects. <LocalizedLink  href="/projects/new">Create project</LocalizedLink></LocalizedElement>}
      <LocalizedElement as="ul"><OriginalText>{projects.map((project) => <LocalizedElement as="li" key={project.id}><LocalizedLink  href={`/projects/${encodeURIComponent(project.id)}?tab=${workflow[1]}`}>{project.name || "Untitled project"}</LocalizedLink></LocalizedElement>)}</OriginalText></LocalizedElement>
    </>}</OriginalText>
  </LocalizedElement>;
}
