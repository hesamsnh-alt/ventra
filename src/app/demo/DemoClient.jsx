"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { downloadDemoReport, demoReport, demoBoqRows } from "@/lib/demoReport.mjs";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Layers3,
  Lightbulb,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";

const steps = [
  { id: "capture", label: "Upload & analyze", kicker: "01", icon: Upload },
  { id: "model", label: "Interactive 3D", kicker: "02", icon: Layers3 },
  { id: "quantities", label: "BOQ & estimate", kicker: "03", icon: BarChart3 },
  { id: "contract", label: "Contract control", kicker: "04", icon: FileCheck2 },
  { id: "schedule", label: "Smart schedule", kicker: "05", icon: Clock3 },
  { id: "progress", label: "Site progress", kicker: "06", icon: Activity },
  { id: "report", label: "Client-ready output", kicker: "07", icon: FileText },
];

const metrics = [
  { label: "Project value", value: "AED 1.24M", change: "+8.4%", icon: CircleDollarSign },
  { label: "Reported progress", value: "46%", change: "on plan", icon: Activity },
  { label: "Schedule mode", value: "Sequential", change: "review sequence", icon: Clock3 },
  { label: "Open actions", value: "04", change: "2 urgent", icon: Zap },
];

const boqRows = demoBoqRows;

const scheduleRows = [
  ["Mobilisation & setting out", "May 07 — May 11", 100, "done"],
  ["Structure / concrete", "May 12 — Jun 08", 72, "active"],
  ["MEP rough-in", "Jun 09 — Jun 23", 38, "active"],
  ["Finishes & handover", "Jun 24 — Jul 18", 8, "planned"],
];

function MetricCard({ metric }) {
  const Icon = metric.icon;
  return (
    <LocalizedElement as="div" className="demo-metric-card">
      <LocalizedElement as="div" className="demo-metric-icon"><Icon size={17} /></LocalizedElement>
      <LocalizedElement as="div">
        <LocalizedElement as="span">{metric.label}</LocalizedElement>
        <LocalizedElement as="strong">{metric.value}</LocalizedElement>
        <LocalizedElement as="small">{metric.change}</LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}

function MiniPlan({ variant = "plan" }) {
  return (
    <LocalizedElement as="div" className={`demo-mini-plan demo-mini-plan--${variant}`} aria-label="Demo floor plan preview">
      <LocalizedElement as="div" className="demo-plan-wall demo-plan-wall--top" />
      <LocalizedElement as="div" className="demo-plan-wall demo-plan-wall--left" />
      <LocalizedElement as="div" className="demo-plan-wall demo-plan-wall--right" />
      <LocalizedElement as="div" className="demo-plan-wall demo-plan-wall--bottom" />
      <LocalizedElement as="div" className="demo-plan-room demo-plan-room--one"><LocalizedElement as="span">BED 01</LocalizedElement></LocalizedElement>
      <LocalizedElement as="div" className="demo-plan-room demo-plan-room--two"><LocalizedElement as="span">LIVING</LocalizedElement></LocalizedElement>
      <LocalizedElement as="div" className="demo-plan-room demo-plan-room--three"><LocalizedElement as="span">BED 02</LocalizedElement></LocalizedElement>
      <LocalizedElement as="div" className="demo-plan-room demo-plan-room--four"><LocalizedElement as="span">KITCHEN</LocalizedElement></LocalizedElement>
      <LocalizedElement as="div" className="demo-plan-window demo-plan-window--one" />
      <LocalizedElement as="div" className="demo-plan-window demo-plan-window--two" />
      <LocalizedElement as="div" className="demo-plan-window demo-plan-window--three" />
      <LocalizedElement as="div" className="demo-plan-door demo-plan-door--one" />
      <LocalizedElement as="div" className="demo-plan-door demo-plan-door--two" />
      <LocalizedElement as="div" className="demo-plan-pulse">AI TRACE</LocalizedElement>
    </LocalizedElement>
  );
}

function FloorModel() {
  return (
    <LocalizedElement as="div" className="demo-floor-model" aria-label="Animated sample model illustration">
      <LocalizedElement as="div" className="demo-model-shadow" />
      <LocalizedElement as="div" className="demo-model-house">
        <LocalizedElement as="div" className="demo-model-wall demo-model-wall--back" />
        <LocalizedElement as="div" className="demo-model-wall demo-model-wall--left" />
        <LocalizedElement as="div" className="demo-model-wall demo-model-wall--right" />
        <LocalizedElement as="div" className="demo-model-wall demo-model-wall--front" />
        <LocalizedElement as="div" className="demo-model-floor demo-model-floor--left" />
        <LocalizedElement as="div" className="demo-model-floor demo-model-floor--center" />
        <LocalizedElement as="div" className="demo-model-floor demo-model-floor--right" />
        <LocalizedElement as="div" className="demo-model-sofa" />
        <LocalizedElement as="div" className="demo-model-table" />
        <LocalizedElement as="div" className="demo-model-bed demo-model-bed--left" />
        <LocalizedElement as="div" className="demo-model-bed demo-model-bed--right" />
        <LocalizedElement as="div" className="demo-model-kitchen" />
      </LocalizedElement>
      <LocalizedElement as="div" className="demo-model-label demo-model-label--one">LIVING + KITCHEN</LocalizedElement>
      <LocalizedElement as="div" className="demo-model-label demo-model-label--two">BEDROOM 01</LocalizedElement>
      <LocalizedElement as="div" className="demo-model-label demo-model-label--three">MEP ZONE</LocalizedElement>
      <LocalizedElement as="div" className="demo-model-toolbar"><LocalizedElement as="span">Animated illustration</LocalizedElement><LocalizedElement as="span">Open workspace for viewer controls</LocalizedElement></LocalizedElement>
    </LocalizedElement>
  );
}

function UploadPanel({ onNext }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [complete, setComplete] = useState(false);

  function startAnalysis() {
    setAnalyzing(true);
    window.setTimeout(() => {
      setAnalyzing(false);
      setComplete(true);
    }, 1100);
  }

  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--capture">
      <LocalizedElement as="div" className="demo-stage-copy">
        <LocalizedElement as="span" className="demo-eyebrow"><Sparkles size={15} /> AI drawing intelligence</LocalizedElement>
        <LocalizedElement as="h2">Turn any plan into a project workspace.</LocalizedElement>
        <LocalizedElement as="p">Upload supported image and engineering drawings in the real workspace. Review extracted rooms, walls, openings, units and specifications against the source. This demo runs a sample simulation.</LocalizedElement>
        <LocalizedElement as="div" className="demo-dropzone">
          <LocalizedElement as="div" className="demo-dropzone-icon"><Upload size={24} /></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="strong">2-bedroom-apartment.dwg</LocalizedElement><LocalizedElement as="span">12.4 MB · illustrative sample file</LocalizedElement></LocalizedElement>
          <LocalizedElement as="button" type="button" onClick={startAnalysis} disabled={analyzing}>
            {analyzing ? "Analyzing…" : complete ? "Analysis complete" : "Play sample analysis"}
            {complete ? <Check size={16} /> : <ArrowRight size={16} />}
          </LocalizedElement>
        </LocalizedElement>
        <LocalizedElement as="div" className="demo-trust-row"><LocalizedElement as="span"><Check size={14} /> Review source geometry</LocalizedElement><LocalizedElement as="span"><Check size={14} /> Review drawing evidence</LocalizedElement></LocalizedElement>
        {complete && <LocalizedElement as="div" className="demo-success"><Check size={16} /> Sample result: 7 rooms · 28 walls · 9 openings. No file was analyzed here.</LocalizedElement>}
        <LocalizedElement as="button" type="button" className="demo-text-button" onClick={onNext}>See the 3D result <ArrowRight size={16} /></LocalizedElement>
      </LocalizedElement>
      <LocalizedElement as="div" className="demo-visual-card demo-visual-card--plan">
        <LocalizedElement as="div" className="demo-card-topline"><LocalizedElement as="span">Source drawing</LocalizedElement><LocalizedElement as="span" className="demo-status-dot">sample trace</LocalizedElement></LocalizedElement>
        <MiniPlan />
        <LocalizedElement as="div" className="demo-plan-legend"><LocalizedElement as="span"><LocalizedElement as="i" className="legend-yellow" /> AI trace</LocalizedElement><LocalizedElement as="span"><LocalizedElement as="i" className="legend-blue" /> opening</LocalizedElement><LocalizedElement as="span"><LocalizedElement as="i" className="legend-green" /> verified</LocalizedElement></LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}

function ModelPanel({ onNext }) {
  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--model">
      <LocalizedElement as="div" className="demo-stage-copy">
        <LocalizedElement as="span" className="demo-eyebrow"><Layers3 size={15} /> Interactive 3D preview</LocalizedElement>
        <LocalizedElement as="h2">Inspect a preview alongside the source plan.</LocalizedElement>
        <LocalizedElement as="p">This animated illustration introduces the 3D workflow. In a real workspace, inspect supported engineering models or schematic image previews. Verify dimensions against the original drawing.</LocalizedElement>
        <LocalizedElement as="div" className="demo-feature-list"><LocalizedElement as="span"><Check size={15} /> Room-by-room navigation</LocalizedElement><LocalizedElement as="span"><Check size={15} /> Furniture and finish layers</LocalizedElement><LocalizedElement as="span"><Check size={15} /> Dimensions require source review</LocalizedElement></LocalizedElement>
        <LocalizedElement as="button" type="button" className="demo-text-button" onClick={onNext}>Generate quantities <ArrowRight size={16} /></LocalizedElement>
      </LocalizedElement>
      <LocalizedElement as="div" className="demo-visual-card demo-visual-card--model"><FloorModel /></LocalizedElement>
    </LocalizedElement>
  );
}

function QuantitiesPanel({ onNext }) {
  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--wide">
      <LocalizedElement as="div" className="demo-stage-copy">
        <LocalizedElement as="span" className="demo-eyebrow"><BarChart3 size={15} /> Quantities + cost</LocalizedElement>
        <LocalizedElement as="h2">From detected geometry to a commercial answer.</LocalizedElement>
        <LocalizedElement as="p">Quantities, unit rates and scope status stay together. Teams can edit line items, validate assumptions and export a BOQ that is ready for client review.</LocalizedElement>
        <LocalizedElement as="div" className="demo-kpi-strip"><LocalizedElement as="div"><LocalizedElement as="strong">AED 613,740</LocalizedElement><LocalizedElement as="span">illustrative BOQ budget</LocalizedElement></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="strong">1,240 m²</LocalizedElement><LocalizedElement as="span">tracked quantity</LocalizedElement></LocalizedElement></LocalizedElement>
        <LocalizedElement as="button" type="button" className="demo-text-button" onClick={onNext}>Check contract milestones <ArrowRight size={16} /></LocalizedElement>
      </LocalizedElement>
      <LocalizedElement as="div" className="demo-table-card"><LocalizedElement as="div" className="demo-card-topline"><LocalizedElement as="span">BOQ illustration · sample data</LocalizedElement><LocalizedElement as="span" className="demo-pill">Editable</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-boq-table"><LocalizedElement as="div" className="demo-boq-head"><LocalizedElement as="span">Scope item</LocalizedElement><LocalizedElement as="span">Qty</LocalizedElement><LocalizedElement as="span">Value</LocalizedElement><LocalizedElement as="span">Progress</LocalizedElement></LocalizedElement>{boqRows.map((row) => <LocalizedElement as="div" className="demo-boq-row" key={row[0]}><LocalizedElement as="div"><LocalizedElement as="strong">{row[0]}</LocalizedElement><LocalizedElement as="small">{row[1]} · {row[2]}</LocalizedElement></LocalizedElement><LocalizedElement as="span">{row[3]}</LocalizedElement><LocalizedElement as="span">{row[4]}</LocalizedElement><LocalizedElement as="div" className="demo-row-progress"><LocalizedElement as="i" style={{ width: row[5] }} /><LocalizedElement as="small">{row[5]}</LocalizedElement></LocalizedElement></LocalizedElement>)}</LocalizedElement><LocalizedElement as="div" className="demo-table-footer"><LocalizedElement as="span">4 illustrative rows · review quantities, specifications and rates</LocalizedElement><LocalizedLink  href="/projects/new">Open workspace <ArrowRight size={14} /></LocalizedLink></LocalizedElement></LocalizedElement>
    </LocalizedElement>
  );
}

function ContractPanel({ onNext }) {
  const milestones = [["Mobilisation", "30%", "paid", "May 07"], ["Structure to slab", "10%", "paid", "Jun 08"], ["MEP rough-in", "20%", "pending", "Jun 23"], ["Handover", "40%", "forecast", "Jul 18"]];
  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--contract">
      <LocalizedElement as="div" className="demo-stage-copy"><LocalizedElement as="span" className="demo-eyebrow"><FileCheck2 size={15} /> Contract intelligence</LocalizedElement><LocalizedElement as="h2">Know what is due, why, and when.</LocalizedElement><LocalizedElement as="p">Enter contract terms and payment milestones, then review supporting evidence and reported progress. Payment approval and settlement remain manual.</LocalizedElement><LocalizedElement as="div" className="demo-contract-callout"><WalletCards size={18} /><LocalizedElement as="div"><LocalizedElement as="strong">AED 372,000 planned milestone · sample</LocalizedElement><LocalizedElement as="span">Next milestone: MEP rough-in · 20%</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="button" type="button" className="demo-text-button" onClick={onNext}>Build the delivery plan <ArrowRight size={16} /></LocalizedElement></LocalizedElement>
      <LocalizedElement as="div" className="demo-contract-card"><LocalizedElement as="div" className="demo-card-topline"><LocalizedElement as="span">Payment schedule</LocalizedElement><LocalizedElement as="span" className="demo-pill demo-pill--green">100% allocated</LocalizedElement></LocalizedElement>{milestones.map((item, index) => <LocalizedElement as="div" className="demo-milestone" key={item[0]}><LocalizedElement as="div" className={`demo-milestone-node demo-milestone-node--${item[2]}`}>{item[2] === "paid" ? <Check size={13} /> : index + 1}</LocalizedElement><LocalizedElement as="div" className="demo-milestone-copy"><LocalizedElement as="strong">{item[0]}</LocalizedElement><LocalizedElement as="span">{item[3]} · {item[2]}</LocalizedElement></LocalizedElement><LocalizedElement as="b">{item[1]}</LocalizedElement></LocalizedElement>)}</LocalizedElement>
    </LocalizedElement>
  );
}

function SchedulePanel({ onNext }) {
  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--schedule"><LocalizedElement as="div" className="demo-stage-copy"><LocalizedElement as="span" className="demo-eyebrow"><Clock3 size={15} /> Timeline + alerts</LocalizedElement><LocalizedElement as="h2">Plan the sequence and compare reported progress.</LocalizedElement><LocalizedElement as="p">BOQ Schedule proposes dates from quantities, crew output, productive hours and the working calendar. The current plan is sequential; review order, waiting periods and missing scope before saving a baseline.</LocalizedElement><LocalizedElement as="div" className="demo-alert"><LocalizedElement as="span" className="demo-alert-icon"><Zap size={16} /></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="strong">1 risk detected</LocalizedElement><LocalizedElement as="span">MEP rough-in is 3 days behind the baseline.</LocalizedElement></LocalizedElement><LocalizedLink  href="/projects/new">Review in workspace <ArrowRight size={14} /></LocalizedLink></LocalizedElement><LocalizedElement as="button" type="button" className="demo-text-button" onClick={onNext}>Review site evidence <ArrowRight size={16} /></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-schedule-card"><LocalizedElement as="div" className="demo-card-topline"><LocalizedElement as="span">Master programme</LocalizedElement><LocalizedElement as="span" className="demo-pill">Week 08</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-week-row"><LocalizedElement as="span">May 07</LocalizedElement><LocalizedElement as="span">May 21</LocalizedElement><LocalizedElement as="span">Jun 04</LocalizedElement><LocalizedElement as="span">Jun 18</LocalizedElement><LocalizedElement as="span">Jul 02</LocalizedElement></LocalizedElement>{scheduleRows.map((row) => <LocalizedElement as="div" className="demo-schedule-row" key={row[0]}><LocalizedElement as="div"><LocalizedElement as="strong">{row[0]}</LocalizedElement><LocalizedElement as="small">{row[1]}</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-schedule-track"><LocalizedElement as="i" className={`demo-schedule-bar demo-schedule-bar--${row[3]}`} style={{ width: `${Math.max(row[2], 12)}%` }} /><LocalizedElement as="span" style={{ left: `${Math.min(row[2], 88)}%` }}>{row[2]}%</LocalizedElement></LocalizedElement></LocalizedElement>)}</LocalizedElement></LocalizedElement>
  );
}

function ProgressPanel({ onNext }) {
  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--progress"><LocalizedElement as="div" className="demo-stage-copy"><LocalizedElement as="span" className="demo-eyebrow"><Activity size={15} /> Site progress</LocalizedElement><LocalizedElement as="h2">Field updates become accountable progress.</LocalizedElement><LocalizedElement as="p">Record daily reports and supporting photos or documents. Teams review progress separately; a photo does not verify completion and schedule updates do not approve payments.</LocalizedElement><LocalizedElement as="div" className="demo-progress-hero"><LocalizedElement as="strong">46%</LocalizedElement><LocalizedElement as="div"><LocalizedElement as="span">Reported overall progress</LocalizedElement><LocalizedElement as="small">+6.2% this week · 2 approvals waiting</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="button" type="button" className="demo-text-button" onClick={onNext}>Create the client report <ArrowRight size={16} /></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-progress-card"><LocalizedElement as="div" className="demo-card-topline"><LocalizedElement as="span">Illustrative site records</LocalizedElement><LocalizedElement as="span" className="demo-pill demo-pill--green">Sample data</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-photo-grid"><LocalizedElement as="div" className="demo-photo demo-photo--concrete"><LocalizedElement as="span">Structure</LocalizedElement><LocalizedElement as="b">72%</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-photo demo-photo--mep"><LocalizedElement as="span">MEP rough-in</LocalizedElement><LocalizedElement as="b">38%</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-photo demo-photo--finish"><LocalizedElement as="span">Finishes</LocalizedElement><LocalizedElement as="b">24%</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-review-row"><UsersRound size={16} /><LocalizedElement as="span">Illustrative review record · not a real site approval</LocalizedElement><Check size={16} /></LocalizedElement></LocalizedElement></LocalizedElement>
  );
}

function ReportPanel() {
  const [shareMessage, setShareMessage] = useState("");
  async function copyPreview() {
    const url = `${window.location.origin}/demo#tour`;
    try { await navigator.clipboard.writeText(url); setShareMessage("Demo link copied. It contains sample data only."); }
    catch { setShareMessage(`Demo link: ${url}`); }
  }
  return (
    <LocalizedElement as="div" className="demo-stage-grid demo-stage-grid--report"><LocalizedElement as="div" className="demo-stage-copy"><LocalizedElement as="span" className="demo-eyebrow"><FileText size={15} /> Client-ready output</LocalizedElement><LocalizedElement as="h2">Turn project data into confidence.</LocalizedElement><LocalizedElement as="p">Share a clear, branded snapshot of scope, budget, schedule and decisions. No spreadsheet archaeology required.</LocalizedElement><LocalizedElement as="div" className="demo-report-actions"><LocalizedElement as="button" type="button" className="demo-primary-button" onClick={() => downloadDemoReport(demoReport)}><FileText size={16} /> Download sample report (JSON)</LocalizedElement><LocalizedElement as="button" type="button" className="demo-secondary-button" onClick={copyPreview}><ArrowRight size={16} /> Copy demo link</LocalizedElement></LocalizedElement>{shareMessage && <LocalizedElement as="p" role="status">{shareMessage}</LocalizedElement>}<LocalizedElement as="div" className="demo-trust-row"><LocalizedElement as="span"><ShieldCheck size={14} /> Sample report only</LocalizedElement><LocalizedElement as="span"><Check size={14} /> Branded output</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-report-card"><LocalizedElement as="div" className="demo-report-brand"><LocalizedElement as="span" className="demo-report-logo">V</LocalizedElement><LocalizedElement as="div"><LocalizedElement as="strong">VENTRA</LocalizedElement><LocalizedElement as="small">PROJECT CONTROL REPORT</LocalizedElement></LocalizedElement><LocalizedElement as="span" className="demo-report-code">VC-2048</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-report-title"><LocalizedElement as="span">AL NOOR VILLA RENOVATION</LocalizedElement><LocalizedElement as="strong">Weekly executive snapshot</LocalizedElement><LocalizedElement as="small">Week ending 18 Jun 2026 · sample demo data</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-report-bars"><LocalizedElement as="div"><LocalizedElement as="span">Progress</LocalizedElement><LocalizedElement as="strong">46%</LocalizedElement><LocalizedElement as="i"><LocalizedElement as="b" style={{ width: "46%" }} /></LocalizedElement></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="span">Budget committed</LocalizedElement><LocalizedElement as="strong">58%</LocalizedElement><LocalizedElement as="i"><LocalizedElement as="b" style={{ width: "58%" }} /></LocalizedElement></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="span">Reported MEP progress</LocalizedElement><LocalizedElement as="strong">38%</LocalizedElement><LocalizedElement as="i"><LocalizedElement as="b" style={{ width: "38%" }} /></LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-report-note"><Lightbulb size={16} /><LocalizedElement as="span">Decision needed: approve MEP rough-in variation before 23 Jun.</LocalizedElement></LocalizedElement></LocalizedElement></LocalizedElement>
  );
}

export default function DemoClient() {
  const [activeId, setActiveId] = useState("capture");
  const [playing, setPlaying] = useState(false);
  const activeIndex = steps.findIndex((step) => step.id === activeId);
  const activeStep = steps[activeIndex];
  const ActiveIcon = activeStep.icon;

  function startGuidedTour() {
    setActiveId("capture");
    setPlaying(true);
    // The CTA lives above the workflow. Move the user to the actual tour so
    // the state change is visible immediately instead of feeling like a dead
    // button on a long marketing page.
    window.requestAnimationFrame(() => {
      document.getElementById("tour")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  const goTo = (index) => setActiveId(steps[(index + steps.length) % steps.length].id);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => goTo(activeIndex + 1), 5600);
    return () => window.clearInterval(timer);
  }, [playing, activeIndex]);

  const panel = useMemo(() => {
    const next = () => goTo(activeIndex + 1);
    if (activeId === "capture") return <UploadPanel onNext={next} />;
    if (activeId === "model") return <ModelPanel onNext={next} />;
    if (activeId === "quantities") return <QuantitiesPanel onNext={next} />;
    if (activeId === "contract") return <ContractPanel onNext={next} />;
    if (activeId === "schedule") return <SchedulePanel onNext={next} />;
    if (activeId === "progress") return <ProgressPanel onNext={next} />;
    return <ReportPanel />;
  }, [activeId, activeIndex]);

  return (
    <LocalizedElement as="div" className="demo-shell">
      <LocalizedElement as="section" className="demo-hero"><LocalizedElement as="div" className="demo-hero-copy"><LocalizedElement as="span" className="demo-demo-badge"><LocalizedElement as="span" className="demo-live-dot" /> Interactive product demo · sample workspace</LocalizedElement><LocalizedElement as="h1">Construction intelligence that moves at the speed of a project.</LocalizedElement><LocalizedElement as="p">From the first drawing to the final payment, Ventra connects geometry, quantities, cost, contract, schedule and field evidence in one calm command center.</LocalizedElement><LocalizedElement as="div" className="demo-hero-actions"><LocalizedElement as="button" type="button" className="demo-primary-button" onClick={startGuidedTour}><Play size={17} fill="currentColor" /> Play guided tour</LocalizedElement><LocalizedLink  href="/register" className="demo-secondary-button">Start a real workspace <ArrowRight size={17} /></LocalizedLink></LocalizedElement><LocalizedElement as="div" className="demo-hero-proof"><LocalizedElement as="span"><Building2 size={15} /> Built for contractors, consultants and owners</LocalizedElement><LocalizedElement as="span"><ShieldCheck size={15} /> Evidence-led decisions</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-hero-visual"><LocalizedElement as="div" className="demo-orbit demo-orbit--one" /><LocalizedElement as="div" className="demo-orbit demo-orbit--two" /><LocalizedElement as="div" className="demo-hero-dashboard"><LocalizedElement as="div" className="demo-dashboard-top"><LocalizedElement as="span">VENTRA / COMMAND CENTER</LocalizedElement><LocalizedElement as="span" className="demo-dashboard-live"><LocalizedElement as="i" /> sample demo</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-dashboard-title"><LocalizedElement as="div"><LocalizedElement as="small">AL NOOR VILLA RENOVATION</LocalizedElement><LocalizedElement as="strong">Sample project overview</LocalizedElement></LocalizedElement><LocalizedElement as="span">46%</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-dashboard-chart"><LocalizedElement as="div" className="demo-chart-line demo-chart-line--one" /><LocalizedElement as="div" className="demo-chart-line demo-chart-line--two" /><LocalizedElement as="div" className="demo-chart-dot demo-chart-dot--one" /><LocalizedElement as="div" className="demo-chart-dot demo-chart-dot--two" /><LocalizedElement as="div" className="demo-chart-axis"><LocalizedElement as="span">W1</LocalizedElement><LocalizedElement as="span">W4</LocalizedElement><LocalizedElement as="span">W8</LocalizedElement><LocalizedElement as="span">W12</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-dashboard-grid"><LocalizedElement as="div"><LocalizedElement as="span">Budget</LocalizedElement><LocalizedElement as="strong">AED 1.24M</LocalizedElement><LocalizedElement as="small" className="good">on track</LocalizedElement></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="span">Schedule</LocalizedElement><LocalizedElement as="strong">Jun 18</LocalizedElement><LocalizedElement as="small" className="warn">1 risk</LocalizedElement></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="span">Evidence</LocalizedElement><LocalizedElement as="strong">38 files</LocalizedElement><LocalizedElement as="small" className="good">sample records</LocalizedElement></LocalizedElement><LocalizedElement as="div"><LocalizedElement as="span">Team</LocalizedElement><LocalizedElement as="strong">12 users</LocalizedElement><LocalizedElement as="small">active</LocalizedElement></LocalizedElement></LocalizedElement></LocalizedElement></LocalizedElement></LocalizedElement>

      <LocalizedElement as="section" className="demo-metrics" aria-label="Demo project metrics">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</LocalizedElement>

      <LocalizedElement as="section" className="demo-tour" id="tour"><LocalizedElement as="div" className="demo-tour-heading"><LocalizedElement as="div"><LocalizedElement as="span" className="demo-eyebrow">The Ventra workflow</LocalizedElement><LocalizedElement as="h2">One connected story for every project.</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-tour-controls"><LocalizedElement as="button" type="button" aria-label="Previous demo step" onClick={() => goTo(activeIndex - 1)}><ChevronLeft size={18} /></LocalizedElement><LocalizedElement as="span">{String(activeIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</LocalizedElement><LocalizedElement as="button" type="button" aria-label="Next demo step" onClick={() => goTo(activeIndex + 1)}><ChevronRight size={18} /></LocalizedElement><LocalizedElement as="button" type="button" className={`demo-play-toggle ${playing ? "is-playing" : ""}`} onClick={() => setPlaying((value) => !value)}>{playing ? <X size={15} /> : <Play size={15} fill="currentColor" />} {playing ? "Pause" : "Auto tour"}</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-tour-nav">{steps.map((step, index) => { const Icon = step.icon; return <LocalizedElement as="button" key={step.id} type="button" className={step.id === activeId ? "is-active" : ""} onClick={() => { setActiveId(step.id); setPlaying(false); }}><LocalizedElement as="span">{step.kicker}</LocalizedElement><Icon size={16} /><LocalizedElement as="b">{step.label}</LocalizedElement>{index < activeIndex && <Check size={13} className="demo-step-check" />}</LocalizedElement>; })}</LocalizedElement><LocalizedElement as="div" className="demo-panel-wrap"><LocalizedElement as="div" className="demo-panel-head"><LocalizedElement as="div"><LocalizedElement as="span" className="demo-panel-index"><ActiveIcon size={15} /> {activeStep.kicker}</LocalizedElement><LocalizedElement as="strong">{activeStep.label}</LocalizedElement></LocalizedElement><LocalizedElement as="span" className="demo-sample-label">Illustrative sample data · no live project analysis or approvals</LocalizedElement></LocalizedElement>{panel}</LocalizedElement></LocalizedElement>

      <LocalizedElement as="section" className="demo-cta"><LocalizedElement as="div"><LocalizedElement as="span" className="demo-eyebrow">Ready for the full workflow?</LocalizedElement><LocalizedElement as="h2">Make every drawing, dollar and decision count.</LocalizedElement><LocalizedElement as="p">Bring your next project into a single, evidence-led workspace.</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="demo-cta-actions"><LocalizedLink  href="/projects/new" className="demo-primary-button">Create a project <ArrowRight size={17} /></LocalizedLink><LocalizedLink  href="/pricing" className="demo-secondary-button">See plans</LocalizedLink></LocalizedElement></LocalizedElement>
    </LocalizedElement>
  );
}
