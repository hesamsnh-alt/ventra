"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import { useState } from "react";

const validPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 1000;
const points = (polygon) => Array.isArray(polygon) && polygon.every(validPoint) ? polygon.map((p) => `${p.x},${p.y}`).join(" ") : "";
const collection = (value) => Array.isArray(value) ? value : [];

export default function RasterTraceReview({ report, imageUrl, fileName }) {
  const [showTrace, setShowTrace] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(true);
  if (!report) return null;
  const trace = report.trace || {};
  const residuals = report.validation?.measurements || report.failure?.details?.measurements || [];
  const imageEvidence = report.imageEvidence && typeof report.imageEvidence === "object" && !Array.isArray(report.imageEvidence)
    ? report.imageEvidence
    : null;
  const evidence = [...residuals];
  const attempts = Array.isArray(report.attempts) ? report.attempts : [];
  const alignmentEvidence = [
    ...(imageEvidence ? [imageEvidence] : []),
    ...attempts.map((attempt) => attempt?.imageEvidence).filter((value) => value && typeof value === "object" && !Array.isArray(value)),
  ];
  const analyzing = report.status === "analyzing" || report.accepted === null;
  function downloadReport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "ventra-raster-report.json";
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <LocalizedElement as="details" open style={{ padding: 16, border: "1px solid #a58a36", borderRadius: 12, marginBottom: 16 }}>
      <LocalizedElement as="summary">Image geometry review — <OriginalText>{fileName}</OriginalText></LocalizedElement>
      <LocalizedElement as="p">{analyzing ? "Analysis in progress. The report will update when the request completes." : report.accepted ? "Geometry checks passed. Image agreement still requires visual review; this is a schematic model." : "Analysis rejected. No new 3D model was saved."}</LocalizedElement>
      {report.failure && <LocalizedElement as="p" role="alert">{report.failure.code}: {report.failure.message}</LocalizedElement>}
      {attempts.length > 0 && <LocalizedElement as="p" role="status">Attempts: {attempts.map((attempt) => `#${attempt.attempt ?? "?"} ${attempt.accepted === true ? "accepted" : attempt.accepted === false ? "rejected" : "in progress"}`).join(", ")}</LocalizedElement>}
      {analyzing && report.trace && <LocalizedElement as="p" role="status">The overlay below is from the previous completed report while this request runs.</LocalizedElement>}
      {alignmentEvidence.length > 0 && <LocalizedElement as="div" role="status" style={{ padding: "8px 10px", border: "1px solid #d4b45c", borderRadius: 8 }}>
        <LocalizedElement as="strong">Source-image alignment</LocalizedElement>
        {alignmentEvidence.map((alignment, i) => <LocalizedElement as="div" key={i}>
          {alignment.status === "passed" ? "Passed" : alignment.status === "rejected" ? "Rejected" : "Not evaluated"}
          {alignment.status === "rejected" && Array.isArray(alignment.unsupportedWallIds) && alignment.unsupportedWallIds.length > 0 && <> · Failed wall IDs: {alignment.unsupportedWallIds.join(", ")}</>}
          {Number.isFinite(alignment.guideCount) && <> · Guides: {alignment.guideCount}</>}
          {alignment.meaning && <> · {String(alignment.meaning)}</>}
        </LocalizedElement>)}
      </LocalizedElement>}
      {report.accepted && report.validation?.omittedOpeningCount > 0 && <LocalizedElement as="p" role="status">{report.validation.omittedOpeningCount} uncertain opening(s) were omitted because their traced jambs did not lie on the stated wall. They were not moved or guessed.</LocalizedElement>}
      {!report.trace && <LocalizedElement as="p">No complete geometry was received. Download the report below for request timing and error details.</LocalizedElement>}
      <LocalizedElement as="div" style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0" }}>
        {report.trace && <><LocalizedElement as="label"><LocalizedElement as="input" type="checkbox" checked={showTrace} onChange={(e) => setShowTrace(e.target.checked)} /> Show extracted geometry</LocalizedElement>
        <LocalizedElement as="label"><LocalizedElement as="input" type="checkbox" checked={showMeasurements} onChange={(e) => setShowMeasurements(e.target.checked)} /> Show dimension reference spans</LocalizedElement></>}
        <LocalizedElement as="button" type="button" onClick={downloadReport}>Download analysis report</LocalizedElement>
      </LocalizedElement>
      {report.trace && <><LocalizedElement as="p">Magenta: footprint · Cyan: walls · Green: openings · Orange: dimension references. These are the AI&apos;s observations, including any rejected geometry.</LocalizedElement>
      <svg role="img" aria-label="Extracted geometry over the original floor plan" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ width: "100%", aspectRatio: `${report.imageWidth} / ${report.imageHeight}`, background: "#fff" }}>
        <image href={imageUrl} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" />
        {showTrace && <g fill="none" strokeWidth="2">
          <polygon points={points(trace.footprint)} stroke="#ff00c8" />
          {collection(trace.rooms).map((r, i) => <polygon key={i} points={points(r.polygon)} stroke="#0088ee" fill="#0088ee" fillOpacity="0.05" />)}
          {collection(trace.walls).filter((w) => validPoint(w.start) && validPoint(w.end)).map((w, i) => <line key={i} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} stroke="#00bcd4"><LocalizedElement as="title">{String(w.id)}</LocalizedElement></line>)}
          {collection(trace.openings).filter((o) => validPoint(o.start) && validPoint(o.end)).map((o, i) => <line key={i} x1={o.start.x} y1={o.start.y} x2={o.end.x} y2={o.end.y} stroke="#00a040" strokeWidth="5"><LocalizedElement as="title">{String(o.id)} — {String(o.wallId)}</LocalizedElement></line>)}
        </g>}
        {showMeasurements && collection(trace.measurements).filter((m) => validPoint(m.start) && validPoint(m.end)).map((m, i) => <g key={i} fill="#d65c00" stroke="#d65c00">
          <line x1={m.start.x} y1={m.start.y} x2={m.end.x} y2={m.end.y} strokeWidth="2" />
          <circle cx={m.start.x} cy={m.start.y} r="4" /><circle cx={m.end.x} cy={m.end.y} r="4" />
          <text x={(m.start.x + m.end.x) / 2} y={(m.start.y + m.end.y) / 2 - 6} fontSize="12" stroke="none">{String(m.id)}: {String(m.text)}</text>
        </g>)}
      </svg></>}
      {report.failure?.details?.measurementScaleMode === "diagnostic_uniform_fit_not_accepted" && <LocalizedElement as="p">The values below use a trial uniform scale to show the conflict. This scale was rejected and was not used to create a model.</LocalizedElement>}
      {evidence.length > 0 && <LocalizedElement as="div" style={{ overflowX: "auto" }}><LocalizedElement as="table" style={{ width: "100%", textAlign: "left" }}>
        <LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Dimension</LocalizedElement><LocalizedElement as="th">Printed (m)</LocalizedElement><LocalizedElement as="th">From trace (m)</LocalizedElement><LocalizedElement as="th">Difference (m)</LocalizedElement><LocalizedElement as="th">Review</LocalizedElement></LocalizedElement></LocalizedElement>
        <LocalizedElement as="tbody">{evidence.map((m, i) => <LocalizedElement as="tr" key={`${m.id || "dimension"}-${i}`}><LocalizedElement as="td">{String(m.id)}: {String(m.text)}</LocalizedElement><LocalizedElement as="td">{m.printedMeters ?? m.meters ?? "—"}</LocalizedElement><LocalizedElement as="td">{Number.isFinite(m.tracedMeters) ? m.tracedMeters.toFixed(3) : "—"}</LocalizedElement><LocalizedElement as="td">{Number.isFinite(m.errorMeters) ? m.errorMeters.toFixed(3) : "—"}</LocalizedElement><LocalizedElement as="td">{m.accepted === false ? (m.reason || m.rejectionReason || "Rejected by validation") : m.accepted === true ? "Accepted" : "Not evaluated"}</LocalizedElement></LocalizedElement>)}</LocalizedElement>
      </LocalizedElement></LocalizedElement>}
    </LocalizedElement>
  );
}
