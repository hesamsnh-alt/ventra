"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import CommercialSync from "./CommercialSync";
import { defaultEstimateShares, eightSectionEstimate } from "@/lib/estimateSections.mjs";
import { calculateProjectEstimate } from "@/lib/projectEstimate.mjs";

import { useEffect, useMemo, useState, useEffectEvent } from "react";
import { Calculator, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import "./ProjectEstimate.css";

function money(value) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function firstPositive(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function getFloorArea(takeoff) {
  return firstPositive(
    takeoff?.floor_area,
    takeoff?.floorArea,
    takeoff?.statistics?.floorArea,
    takeoff?.statistics?.floor_area,
    takeoff?.gross_floor_area,
    takeoff?.grossFloorArea
  );
}

export default function ProjectEstimate({ projectId }) {
  const [shares,setShares]=useState(defaultEstimateShares);
  const [boq, setBoq] = useState(null);
  const [basis, setBasis] = useState("benchmark");
  const [includeProvisional, setIncludeProvisional] = useState(true);
  const [scenarioPct, setScenarioPct] = useState(10);
  const [quality, setQuality] = useState("standard");
  const [ratePerSqm, setRatePerSqm] = useState(4200);
  const [contingencyPct, setContingencyPct] = useState(7.5);
  const [profitPct, setProfitPct] = useState(12);
  const [vatPct, setVatPct] = useState(5);
  const [message, setMessage] = useState("");
  const [loadedProject,setLoadedProject]=useState(null);

  function loadBoq(manual = false) {
    if (!projectId || typeof window === "undefined") return;
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(`ventra:project-boq:${projectId}`) || "null"
      );
      if (parsed !== null && (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items))) {
        throw new Error("Invalid saved BOQ");
      }
      const unchanged = JSON.stringify(parsed) === JSON.stringify(boq);
      setBoq(parsed);
      if (parsed?.vatPercentage != null && Number.isFinite(Number(parsed.vatPercentage))) {
        setVatPct(Number(parsed.vatPercentage));
      }
      setMessage(
        `${manual ? `Refresh checked at ${new Date().toLocaleTimeString()}. ` : ""}${parsed
          ? `${parsed.items.length} saved BOQ row(s) loaded.${manual && unchanged ? " No changes found in the saved BOQ." : ""} Refresh reads this browser's saved BOQ; it does not generate new quantities or fetch the shared version.`
          : "No saved BOQ exists in this browser. Open BOQ and generate it, or use Load shared version if it was saved on another device."}`
      );
    } catch {
      setMessage("The saved BOQ could not be read. Refresh failed; the currently displayed data was kept. Open BOQ and review the saved document.");
    }
  }

  const loadBoqFromEffect=useEffectEvent(loadBoq);
  useEffect(() => {
    let cancelled=false;
    // Read the external browser draft after commit; stale project loads are cancelled.
    Promise.resolve().then(()=>{
      if(cancelled)return;
    setShares(defaultEstimateShares());
    setBoq(null);
    setBasis("benchmark"); setIncludeProvisional(true); setScenarioPct(10);
    setLoadedProject(null);setQuality("standard");setRatePerSqm(4200);setContingencyPct(7.5);setProfitPct(12);setVatPct(5);loadBoqFromEffect();
    try{
      const saved=JSON.parse(localStorage.getItem(`ventra:project-estimate:${projectId}`)||'null');
      if(saved&&saved.projectId===projectId){
        if(saved.sectionShares)setShares({...defaultEstimateShares(),...saved.sectionShares});
        if(["benchmark","boq"].includes(saved.basis))setBasis(saved.basis);
        if(typeof saved.includeProvisional === "boolean")setIncludeProvisional(saved.includeProvisional);
        if(saved.scenarioPct != null)setScenarioPct(clamp(saved.scenarioPct,0,100));
        if(['economy','standard','premium','luxury'].includes(saved.quality))setQuality(saved.quality);
        if(Number(saved.ratePerSqm)>0)setRatePerSqm(Number(saved.ratePerSqm));
        if(Number.isFinite(Number(saved.contingencyPct)))setContingencyPct(clamp(saved.contingencyPct,0,100));
        if(Number.isFinite(Number(saved.profitPct)))setProfitPct(clamp(saved.profitPct,0,100));
        if(Number.isFinite(Number(saved.vatPct)))setVatPct(clamp(saved.vatPct,0,100));
      }
    }catch{setMessage('Saved estimate settings could not be restored. Review rates before saving.');}
    setLoadedProject(projectId);
    });
    return()=>{cancelled=true;};
  }, [projectId]);

  useEffect(()=>{
    const reload=event=>{if(event.type==='storage'&&event.key!==`ventra:project-boq:${projectId}`)return;if(event.detail?.projectId&&event.detail.projectId!==projectId)return;loadBoqFromEffect();};
    window.addEventListener('storage',reload);window.addEventListener('ventra:boq-updated',reload);
    return()=>{window.removeEventListener('storage',reload);window.removeEventListener('ventra:boq-updated',reload);};
  },[projectId]);

  function changeQuality(value){setQuality(value);setRatePerSqm({economy:3200,standard:4200,premium:5600,luxury:7500}[value]||4200);}

  const items = useMemo(()=>Array.isArray(boq?.items)?boq.items:[],[boq]);
  const floorArea = getFloorArea(boq?.takeoff);
  const calculation = useMemo(() => calculateProjectEstimate({
    items, basis, includeProvisional, floorArea, ratePerSqm,
    contingencyPct, profitPct, vatPct, scenarioPct,
  }), [items, basis, includeProvisional, floorArea, ratePerSqm, contingencyPct, profitPct, vatPct, scenarioPct]);
  const {groups:{verified:verifiedItems, provisional:provisionalItems, pending:pendingItems},
    measuredCost, provisionalDerivedCost, includedProvisionalCost, coveredBoqCost, benchmarkBase,
    benchmarkAvailable, benchmarkDifference, expectedDirectCost, contingency, profit,
    tenderBeforeVat, vat, finalTender:expectedTender, low, high, ready:estimateReady, sections} = calculation;
  const sectionBudget=eightSectionEstimate(calculation,shares);
  // Compatibility field: an unallocated benchmark gap, never an identified missing work measurement.
  const missingScopeAllowance = basis === "benchmark" ? Math.max(0, benchmarkDifference || 0) : 0;

  useEffect(() => {
    if (!projectId || loadedProject!==projectId || !boq || typeof window === "undefined") return;

    window.localStorage.setItem(
      `ventra:project-estimate:${projectId}`,
      JSON.stringify({
        projectId,
        projectName: boq?.projectName || "Ventra Project",
        currency: "AED",
        calculationReady: estimateReady,
        method: basis === "benchmark" ? "floor_area_benchmark" : "priced_boq_scope",
        basis, includeProvisional, includedProvisionalCost, coveredBoqCost,
        benchmarkBase, benchmarkDifference, scenarioPct, rangeBasis: "user_scenario_not_confidence_interval",
        boqSourceUpdatedAt: boq?.updatedAt || null, scopeCoverage: "not_confirmed",
        classificationVersion: 3,
        benchmarkBasis: "editable_assumption_not_live_market_rate",
        floorArea,
        quality, sectionShares:shares, sectionAllocationValid:sectionBudget.allocationValid,
        ratePerSqm,
        measuredCost,
        provisionalDerivedCost,
        missingScopeAllowance,
        expectedDirectCost,
        contingencyPct,
        contingency,
        profitPct,
        profit,
        tenderBeforeVat,
        vatPct,
        vat,
        finalTender: expectedTender,
        expectedRangeLow: low,
        expectedRangeHigh: high,
        verifiedItems: verifiedItems.length,
        provisionalItems: provisionalItems.length,
        pendingItems: pendingItems.length,
        scopeAllowances: [],
        commercialSafe: false,
        estimateConfidence:
          "requires_review",
        updatedAt: new Date().toISOString(),
      })
    );

    window.dispatchEvent(
      new CustomEvent("ventra:estimate-updated", {
        detail: {
          projectId,
          finalTender: expectedTender,
          quality,
          ratePerSqm,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }, [
    shares, sectionBudget.allocationValid, projectId, loadedProject, boq, boq?.projectName, boq?.updatedAt, basis, includeProvisional, scenarioPct,
    includedProvisionalCost, coveredBoqCost, benchmarkBase, benchmarkDifference, floorArea, quality, ratePerSqm,
    measuredCost, provisionalDerivedCost, missingScopeAllowance, expectedDirectCost,
    contingencyPct, contingency, profitPct, profit, tenderBeforeVat,
    vatPct, vat, expectedTender, low, high, verifiedItems.length,
    provisionalItems.length, pendingItems.length, estimateReady
  ]);

  return (
    <LocalizedElement as="section" className="estimate-panel">
      <CommercialSync projectId={projectId} />
      <LocalizedElement as="div" className="estimate-header">
        <LocalizedElement as="div">
          <LocalizedElement as="span">TOTAL PROJECT ESTIMATE</LocalizedElement>
          <LocalizedElement as="h2">{basis === "benchmark" ? "Preliminary Project Budget" : "BOQ-based Cost Estimate"}</LocalizedElement>
          <LocalizedElement as="p">
            Choose a floor-area budget or the cost of listed BOQ work.
            These estimates use different bases; compare their direct costs before markups.
          </LocalizedElement>
        </LocalizedElement>
        <LocalizedElement as="button" type="button" onClick={() => loadBoq(true)}>
          <RefreshCw size={16}/>Refresh from BOQ
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="estimate-message">
        The AED/m² benchmark is an editable planning assumption, not a live market quote.
        Quality presets are defaults. Confirm the rate, project scope and quantities before tendering.
        Enter a direct construction rate excluding contingency, contractor profit and VAT.
        A difference from the BOQ is not proof of missing work or a validated project budget.
      </LocalizedElement>
      {message && <LocalizedElement as="div" className="estimate-message" role="status" aria-live="polite">{message}</LocalizedElement>}

      <LocalizedElement as="div" className="estimate-basis-controls">
        <LocalizedElement as="label">Estimate basis
          <LocalizedElement as="select" value={basis} onChange={e => setBasis(e.target.value)}>
            <LocalizedElement as="option" value="benchmark">Preliminary budget · floor area × rate</LocalizedElement>
            <LocalizedElement as="option" value="boq">BOQ-based estimate · listed work only</LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
        {basis === "boq" && <LocalizedElement as="label" className="estimate-toggle">
          <LocalizedElement as="input" type="checkbox" checked={includeProvisional} onChange={e => setIncludeProvisional(e.target.checked)} />
          Include provisional BOQ costs (estimated quantities)
        </LocalizedElement>}
      </LocalizedElement>
      <LocalizedElement as="div" className="estimate-message">
        {items.length} total BOQ rows: {verifiedItems.length} verified + {provisionalItems.length} provisional + {pendingItems.length} unresolved.
        {" "}BOQ scope completeness has not been confirmed. Unresolved and unlisted work is not priced in BOQ mode.
      </LocalizedElement>
      {pendingItems.length > 0 && <LocalizedElement as="div" className="estimate-message" role="alert">
        {pendingItems.length} BOQ rows have unresolved quantities, rates or verification. Their cost is excluded, not assumed to be zero.
      </LocalizedElement>}

      {!estimateReady && boq && (
        <LocalizedElement as="div" className="estimate-message">
          <TriangleAlert size={16}/>
          {basis === "benchmark" ? "Verify a positive floor area and benchmark rate to calculate a preliminary budget." : "No priced BOQ work is included. Load the BOQ, review rates, or include provisional costs."}
        </LocalizedElement>
      )}

      {estimateReady && (
        <>
          <LocalizedElement as="div" className="estimate-kpis">
            <LocalizedElement as="div">
              <LocalizedElement as="span">Verified Measured Cost</LocalizedElement>
              <LocalizedElement as="strong">{money(measuredCost)}</LocalizedElement>
              <LocalizedElement as="small">{verifiedItems.length} verified BOQ row(s)</LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="div">
              <LocalizedElement as="span">Provisional Derived Scope</LocalizedElement>
              <LocalizedElement as="strong">{money(provisionalDerivedCost)}</LocalizedElement>
              <LocalizedElement as="small">{provisionalItems.length} derived BOQ row(s), excluded from verified subtotal</LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="div">
              <LocalizedElement as="span">{basis === "benchmark" ? "Benchmark minus listed BOQ" : "Provisional BOQ excluded"}</LocalizedElement>
              <LocalizedElement as="strong">{basis === "benchmark" ? money(benchmarkDifference) : money(provisionalDerivedCost - includedProvisionalCost)}</LocalizedElement>
              <LocalizedElement as="small">{basis === "benchmark" ? "Signed difference; not measured missing work" : "Excluded from the selected direct cost"}</LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="div">
              <LocalizedElement as="span">Selected direct cost</LocalizedElement>
              <LocalizedElement as="strong">{money(expectedDirectCost)}</LocalizedElement>
              <LocalizedElement as="small">{basis === "benchmark" ? `${floorArea.toFixed(2)} m² × ${money(ratePerSqm)}/m²` : `Verified BOQ${includeProvisional ? " + provisional BOQ" : " only"}; no benchmark top-up`}</LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="estimate-settings">
            <LocalizedElement as="label">
              Build Quality
              <LocalizedElement as="select" disabled={basis === "boq"} value={quality} onChange={(e)=>changeQuality(e.target.value)}>
                <LocalizedElement as="option" value="economy">Economy</LocalizedElement>
                <LocalizedElement as="option" value="standard">Standard</LocalizedElement>
                <LocalizedElement as="option" value="premium">Premium</LocalizedElement>
                <LocalizedElement as="option" value="luxury">Luxury</LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="label">
              Benchmark AED / m²
              <LocalizedElement as="input"
                type="number"
                min="1"
                disabled={basis === "boq"}
                value={ratePerSqm}
                onChange={(e)=>setRatePerSqm(Math.max(1, Number(e.target.value)||1))}
              />
            </LocalizedElement>
            <LocalizedElement as="label">
              Contingency %
              <LocalizedElement as="input"
                type="number"
                min="0" max="50" step="0.5"
                value={contingencyPct}
                onChange={(e)=>setContingencyPct(clamp(e.target.value,0,50))}
              />
            </LocalizedElement>
            <LocalizedElement as="label">
              Contractor Profit %
              <LocalizedElement as="input"
                type="number"
                min="0" max="50" step="0.5"
                value={profitPct}
                onChange={(e)=>setProfitPct(clamp(e.target.value,0,50))}
              />
            </LocalizedElement>
            <LocalizedElement as="label">
              VAT %
              <LocalizedElement as="input"
                type="number"
                min="0" max="100" step="0.5"
                value={vatPct}
                onChange={(e)=>setVatPct(clamp(e.target.value,0,100))}
              />
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="estimate-table-wrap">
            <LocalizedElement as="table" className="estimate-table">
              <LocalizedElement as="caption">Direct cost comparison · excludes contingency, profit and VAT</LocalizedElement>
              <LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Cost basis</LocalizedElement><LocalizedElement as="th">Amount (AED)</LocalizedElement><LocalizedElement as="th">Meaning</LocalizedElement></LocalizedElement></LocalizedElement>
              <LocalizedElement as="tbody">
                <LocalizedElement as="tr"><LocalizedElement as="td">Verified BOQ</LocalizedElement><LocalizedElement as="td">{money(measuredCost)}</LocalizedElement><LocalizedElement as="td">Measured or reviewed rows only</LocalizedElement></LocalizedElement>
                <LocalizedElement as="tr"><LocalizedElement as="td">Provisional BOQ</LocalizedElement><LocalizedElement as="td">{money(provisionalDerivedCost)}</LocalizedElement><LocalizedElement as="td">Estimated quantities; separate from verified work</LocalizedElement></LocalizedElement>
                <LocalizedElement as="tr"><LocalizedElement as="td">Listed BOQ including provisional</LocalizedElement><LocalizedElement as="td">{money(coveredBoqCost)}</LocalizedElement><LocalizedElement as="td">Scope coverage still requires review</LocalizedElement></LocalizedElement>
                <LocalizedElement as="tr"><LocalizedElement as="td">Floor-area benchmark</LocalizedElement><LocalizedElement as="td">{benchmarkAvailable ? money(benchmarkBase) : "Unavailable"}</LocalizedElement><LocalizedElement as="td">Independent editable planning assumption</LocalizedElement></LocalizedElement>
                <LocalizedElement as="tr"><LocalizedElement as="td">Benchmark minus listed BOQ</LocalizedElement><LocalizedElement as="td">{benchmarkDifference == null ? "Unavailable" : money(benchmarkDifference)}</LocalizedElement><LocalizedElement as="td">{benchmarkDifference == null ? "Verify floor area and rate" : benchmarkDifference < 0 ? "Listed BOQ exceeds the benchmark; review both scope and rate" : "Unallocated difference; not automatically missing work"}</LocalizedElement></LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
          <LocalizedElement as="div" className="estimate-table-wrap">
            <LocalizedElement as="table" className="estimate-table">
              <LocalizedElement as="caption">Eight-section project estimate · direct cost before markups</LocalizedElement>
              <LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Section</LocalizedElement><LocalizedElement as="th">{basis==='benchmark'?'Budget allocation %':'BOQ rows'}</LocalizedElement><LocalizedElement as="th">Direct cost (AED)</LocalizedElement><LocalizedElement as="th">Unresolved BOQ rows</LocalizedElement></LocalizedElement></LocalizedElement>
              <LocalizedElement as="tbody">{sectionBudget.rows.map(row=><LocalizedElement as="tr" key={row.id}><LocalizedElement as="td">{row.name}</LocalizedElement><LocalizedElement as="td">{basis==='benchmark'?<LocalizedElement as="input" aria-label={`Budget share for ${row.name}`} type="number" min="0" max="100" step="0.1" value={shares[row.id]} onChange={e=>setShares(current=>({...current,[row.id]:e.target.value}))}/>:row.count}</LocalizedElement><LocalizedElement as="td">{row.cost==null?'Allocation needs review':money(row.cost)}</LocalizedElement><LocalizedElement as="td">{row.pending}</LocalizedElement></LocalizedElement>)}</LocalizedElement>
              <LocalizedElement as="tfoot"><LocalizedElement as="tr"><LocalizedElement as="th">Total</LocalizedElement><LocalizedElement as="td">{basis==='benchmark'?`${sectionBudget.rows.reduce((sum,r)=>sum+(Number(r.share)||0),0)}%`:items.length}</LocalizedElement><LocalizedElement as="td">{money(expectedDirectCost)}</LocalizedElement><LocalizedElement as="td">{pendingItems.length}</LocalizedElement></LocalizedElement></LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
          <LocalizedElement as="div" className="estimate-message" role={sectionBudget.allocationValid?'status':'alert'}>
            {basis==='benchmark'?'The eight budget shares are editable planning assumptions; they are not measured quantities. Shares must total 100%.':'The eight headings group the priced BOQ scope. Unlisted work and unresolved quantities are not priced.'}
            {basis==='benchmark'&&!sectionBudget.allocationValid&&' Allocation percentages must total 100% before a section breakdown is available.'}
          </LocalizedElement>
          <LocalizedElement as="div" className="estimate-message">
            <ShieldCheck size={16}/>
            {basis === "benchmark" ? "The benchmark is the selected total direct cost. BOQ costs are shown for comparison and are not added on top." : "Only the selected BOQ rows form the direct cost. No automatic allowance is added for unlisted work."}
            {" "}Markups below apply once to the selected base. BOQ overhead, profit, discount and VAT settings are not imported.
          </LocalizedElement>
          <LocalizedElement as="label" className="estimate-scenario">Scenario variation ± %
            <LocalizedElement as="input" type="number" min="0" max="100" step="1" value={scenarioPct} onChange={e => setScenarioPct(clamp(e.target.value,0,100))} />
            <LocalizedElement as="small">Editable sensitivity scenario, not a statistical accuracy or confidence range.</LocalizedElement>
          </LocalizedElement>
          <LocalizedElement as="div" className="estimate-summary">
            {basis === "boq" && <>
              <LocalizedElement as="div"><LocalizedElement as="span">Verified BOQ included</LocalizedElement><LocalizedElement as="strong">{money(measuredCost)}</LocalizedElement></LocalizedElement>
              <LocalizedElement as="div"><LocalizedElement as="span">Provisional BOQ included</LocalizedElement><LocalizedElement as="strong">{money(includedProvisionalCost)}</LocalizedElement></LocalizedElement>
            </>}
            <LocalizedElement as="div"><LocalizedElement as="span">{basis === "benchmark" ? "Floor-area budget · direct cost" : "Listed BOQ · direct cost"}</LocalizedElement><LocalizedElement as="strong">{money(expectedDirectCost)}</LocalizedElement></LocalizedElement>
            <LocalizedElement as="div"><LocalizedElement as="span">Contingency ({contingencyPct}%)</LocalizedElement><LocalizedElement as="strong">{money(contingency)}</LocalizedElement></LocalizedElement>
            <LocalizedElement as="div"><LocalizedElement as="span">Profit ({profitPct}%)</LocalizedElement><LocalizedElement as="strong">{money(profit)}</LocalizedElement></LocalizedElement>
            <LocalizedElement as="div"><LocalizedElement as="span">VAT ({vatPct}%)</LocalizedElement><LocalizedElement as="strong">{money(vat)}</LocalizedElement></LocalizedElement>
            <LocalizedElement as="div" className="estimate-total">
              <LocalizedElement as="span"><Calculator size={18}/>Indicative total including VAT</LocalizedElement>
              <LocalizedElement as="strong">{money(expectedTender)}</LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="div">
              <LocalizedElement as="span">Scenario range (±{scenarioPct}%)</LocalizedElement>
              <LocalizedElement as="strong">{money(low)} – {money(high)}</LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
        </>
      )}
    </LocalizedElement>
  );
}
