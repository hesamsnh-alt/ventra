"use client";
import WorkspaceDisclosure from './WorkspaceDisclosure';
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import CommercialSync from "./CommercialSync";
import SelectionCommercialSummary from "./SelectionCommercialSummary";

import { useEffect, useMemo, useState, useEffectEvent } from "react";
import "./ProjectQuotation.css";
import DocumentBranding, { useDocumentBranding } from "./DocumentBranding";
import { quotationTotals } from "@/lib/commercialDocument.mjs";

function money(value) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function readJson(key) {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  return JSON.parse(raw);
}

export default function ProjectQuotation({ projectId }) {
  const [estimate, setEstimate] = useState(null);
  const [branding, updateBranding] = useDocumentBranding(projectId);
  const [lineItems, setLineItems] = useState(null);
  const [customVat, setCustomVat] = useState(null);
  const [clientName, setClientName] = useState("");
  const [validityDays, setValidityDays] = useState(30);
  const [paymentTerms, setPaymentTerms] = useState(
    "Payment terms to be agreed before contract award."
  );
  const [exclusions, setExclusions] = useState(
    "Authority fees, design changes, and works not listed in the verified BOQ are excluded."
  );

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastActionAt, setLastActionAt] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [lastSavedDraft, setLastSavedDraft] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const estimateKey = `ventra:project-estimate:${projectId}`;
  const quotationKey = `ventra:project-quotation:${projectId}`;

  function markSuccess(message) {
    const now = new Date();
    setStatusMessage(message);
    setErrorMessage("");
    setLastActionAt(now.toLocaleTimeString("en-AE"));
  }

  function markError(message) {
    setErrorMessage(message);
    setStatusMessage("");
    setLastActionAt(new Date().toLocaleTimeString("en-AE"));
  }

  function refreshEstimate() {
    if (!projectId || typeof window === "undefined") return false;

    setBusyAction("refresh");
    setErrorMessage("");
    setStatusMessage("");

    try {
      const raw = window.localStorage.getItem(
        `ventra:project-estimate:${projectId}`
      );

      if (!raw) {
        setEstimate(null);
        markError(
          "REFRESH FAILED: no saved Estimate exists for this project."
        );
        return false;
      }

      const latest = JSON.parse(raw);

      if (!latest || Number(latest.finalTender) <= 0) {
        setEstimate(null);
        markError(
          "REFRESH FAILED: saved Estimate is invalid or has no final tender."
        );
        return false;
      }

      // Force a guaranteed React state change.
      setEstimate(null);

      window.requestAnimationFrame(() => {
        setEstimate({
          ...latest,
          __quotationRefreshId: Date.now(),
        });
        setRefreshNonce((value) => value + 1);
      });

      const refreshedMessage =
        `REFRESHED ✓ ${money(latest.finalTender)} · ` +
        (latest.basis === "boq" ? `Listed BOQ${latest.includeProvisional ? " including provisional costs" : "; verified costs only"}` :
        `${latest.quality || "Quality not set"} · ${Number(latest.ratePerSqm || 0).toLocaleString("en-AE")} AED/m²`);

      markSuccess(refreshedMessage);

      window.localStorage.setItem(
        `ventra:quotation-last-refresh:${projectId}`,
        JSON.stringify({
          finalTender: Number(latest.finalTender) || 0,
          quality: latest.quality || null,
          ratePerSqm: Number(latest.ratePerSqm) || 0,
          estimateUpdatedAt: latest.updatedAt || null,
          refreshedAt: new Date().toISOString(),
        })
      );

      console.log("[VENTRA QUOTATION REFRESH v40]", {
        projectId,
        finalTender: Number(latest.finalTender) || 0,
        quality: latest.quality || null,
        ratePerSqm: Number(latest.ratePerSqm) || 0,
        estimateUpdatedAt: latest.updatedAt || null,
      });

      return true;
    } catch (error) {
      setEstimate(null);
      markError(
        error instanceof Error
          ? `REFRESH FAILED: ${error.message}`
          : "REFRESH FAILED."
      );
      return false;
    } finally {
      setBusyAction("");
    }
  }

  function loadSavedDraft() {
    if (!projectId || typeof window === "undefined") return;

    try {
      const draft = readJson(quotationKey);
      if (!draft) return;

      setClientName(draft.clientName || "");
      setValidityDays(Number(draft.validityDays) || 30);
      setPaymentTerms(
        draft.paymentTerms ||
          "Payment terms to be agreed before contract award."
      );
      setExclusions(
        draft.exclusions ||
          "Authority fees, design changes, and works not listed in the verified BOQ are excluded."
      );
      setLastSavedDraft(draft);
      setLineItems(Array.isArray(draft.lineItems) ? draft.lineItems : null);
      setCustomVat(draft.lineItems ? draft.vatPct ?? 5 : null);
    } catch {
      // Old/corrupt draft must not block quotation.
    }
  }

  const loadDraftFromEffect=useEffectEvent(loadSavedDraft);
  const refreshEstimateFromEffect=useEffectEvent(refreshEstimate);
  useEffect(() => {
    let cancelled=false;
    Promise.resolve().then(()=>{if(!cancelled){loadDraftFromEffect();refreshEstimateFromEffect();}});
    return()=>{cancelled=true;};
  }, [projectId]);

  // Keep quotation synced if Estimate is changed in another tab/window.
  useEffect(() => {
    if (typeof window === "undefined") return;

    function onStorage(event) {
      if (event.key === estimateKey) {
        refreshEstimateFromEffect();
      }
    }

    function onEstimateUpdated(event) {
      if (!event?.detail?.projectId || event.detail.projectId === projectId) {
        refreshEstimateFromEffect();
      }
    }

    function onFocus() {
      refreshEstimateFromEffect();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshEstimateFromEffect();
      }
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("ventra:estimate-updated", onEstimateUpdated);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ventra:estimate-updated", onEstimateUpdated);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [estimateKey, projectId]);

  const quotation = useMemo(
    () => {
      if (lineItems) {
        try { return quotationTotals(lineItems, customVat ?? estimate?.vatPct ?? 5); }
        catch (error) { return { subtotal: 0, vat: 0, total: 0, error: error.message }; }
      }
      return ({
      subtotal:
        Number(estimate?.tenderBeforeVat) ||
        Number(estimate?.netBeforeVat) ||
        0,
      vat: Number(estimate?.vat) || 0,
      total: Number(estimate?.finalTender) || 0,
    }); },
    [estimate, lineItems, customVat]
  );

  const canUseQuotation =
    Boolean(estimate || lineItems) && quotation.total > 0 && !quotation.error && (!lineItems || lineItems.every((item) => String(item.description || "").trim() && String(item.unit || "").trim()));

  function buildPayload(status) {
    return {
      projectId,
      branding: { ...branding },
      lineItems,
      projectName: estimate?.projectName || "Ventra Project",
      clientName: clientName.trim(),
      currency: "AED",
      validityDays: Number(validityDays) || 30,
      paymentTerms,
      exclusions,

      quality: estimate?.quality || null,
      ratePerSqm: Number(estimate?.ratePerSqm) || 0,

      measuredCost: Number(estimate?.measuredCost) || 0,
      provisionalDerivedCost:
        Number(estimate?.provisionalDerivedCost) || 0,
      missingScopeAllowance:
        Number(estimate?.missingScopeAllowance) || 0,
      expectedDirectCost:
        Number(estimate?.expectedDirectCost) || 0,

      subtotal: quotation.subtotal,
      vat: quotation.vat,
      total: quotation.total,

      contingencyPct: Number(estimate?.contingencyPct) || 0,
      profitPct: Number(estimate?.profitPct) || 0,
      vatPct: lineItems ? Number(customVat ?? estimate?.vatPct ?? 5) : Number(estimate?.vatPct) || 0,

      expectedRangeLow:
        Number(estimate?.expectedRangeLow) || 0,
      expectedRangeHigh:
        Number(estimate?.expectedRangeHigh) || 0,

      pendingBoqItems: Number(estimate?.pendingItems) || 0,
      commercialSafe: Boolean(estimate?.commercialSafe),
      estimateMethod: estimate?.method || null,
      estimateBasis: estimate?.basis || null,
      includeProvisional: estimate?.includeProvisional ?? null,
      includedProvisionalCost: Number(estimate?.includedProvisionalCost) || 0,
      estimateUpdatedAt: estimate?.updatedAt || null,

      status,
      updatedAt: new Date().toISOString(),
    };
  }

  function saveDraft() {
    if (typeof window === "undefined") return false;

    setBusyAction("save");
    setErrorMessage("");
    setStatusMessage("");

    try {
      if (!canUseQuotation) {
        throw new Error(
          "No valid Estimate is loaded. Refresh Estimate first."
        );
      }

      const payload = buildPayload("draft");
      const serialized = JSON.stringify(payload);

      window.localStorage.setItem(
        `ventra:project-quotation:${projectId}`,
        serialized
      );

      // Hard verification: exact JSON must be readable immediately.
      const verifyRaw = window.localStorage.getItem(
        `ventra:project-quotation:${projectId}`
      );

      if (!verifyRaw) {
        throw new Error(
          "Quotation was not written to browser storage."
        );
      }

      const verified = JSON.parse(verifyRaw);

      if (
        Number(verified.total) !== Number(payload.total) ||
        String(verified.updatedAt) !== String(payload.updatedAt)
      ) {
        throw new Error(
          "Saved quotation does not match the current quotation."
        );
      }

      // Keep a second immutable snapshot key so a later UI edit cannot make
      // the user think Save did nothing.
      const snapshotKey =
        `ventra:project-quotation-snapshot:${projectId}:${Date.now()}`;

      window.localStorage.setItem(
        snapshotKey,
        serialized
      );

      setLastSavedDraft({
        ...verified,
        snapshotKey,
      });

      const savedMessage =
        `SAVED ✓ ${money(payload.total)} · ` +
        `${new Date(payload.updatedAt).toLocaleTimeString("en-AE")}`;

      markSuccess(savedMessage);

      window.dispatchEvent(
        new CustomEvent("ventra:quotation-saved", {
          detail: {
            projectId,
            total: payload.total,
            updatedAt: payload.updatedAt,
            snapshotKey,
          },
        })
      );

      console.log("[VENTRA QUOTATION SAVE v40]", {
        projectId,
        total: payload.total,
        updatedAt: payload.updatedAt,
        snapshotKey,
      });

      return true;
    } catch (error) {
      markError(
        error instanceof Error
          ? `SAVE FAILED: ${error.message}`
          : "SAVE FAILED."
      );
      return false;
    } finally {
      setBusyAction("");
    }
  }

  function generatePdf() {
    if (!canUseQuotation || typeof window === "undefined") {
      markError("Load an Estimate or complete valid quotation items before generating PDF.");
      return;
    }

    setBusyAction("pdf");

    try {
      const payload = buildPayload("generated");

      // Persist exact snapshot used for print/PDF.
      window.localStorage.setItem(
        quotationKey,
        JSON.stringify(payload)
      );

      markSuccess(
        "Print dialog opened. Choose “Save as PDF” as the printer."
      );

      console.log("[VENTRA QUOTATION PDF v38]", {
        total: payload.total,
        estimateUpdatedAt: payload.estimateUpdatedAt,
      });

      // Critical v38 change:
      // NO window.open(), NO about:blank, NO popup dependency.
      // Print the current quotation page directly.
      setTimeout(() => {
        window.print();
      }, 100);
    } catch (error) {
      markError(
        error instanceof Error
          ? `PDF generation failed: ${error.message}`
          : "PDF generation failed."
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <LocalizedElement as="section" className="quotation-panel">
      <CommercialSync projectId={projectId} />
      <SelectionCommercialSummary key={projectId} projectId={projectId} />
      <DocumentBranding branding={branding} onChange={updateBranding} />
      <LocalizedElement as="div" className="quotation-header">
        <LocalizedElement as="div">
          <LocalizedElement as="span">CLIENT OFFER</LocalizedElement>
          <LocalizedElement as="h2">{!lineItems ? "Preliminary Budget Estimate" : "Quotation"}</LocalizedElement>
          <LocalizedElement as="p">{!lineItems ? "Indicative budget only. Quantities, scope and rates require review before contract award." : "Subject to the scope, terms and exclusions below."}</LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div"
        className="quotation-status-bar quotation-card"
        style={{
          border: errorMessage
            ? "2px solid #ff5f5f"
            : statusMessage
              ? "2px solid #27d17f"
              : undefined,
        }}
      >
        <LocalizedElement as="strong">
          {busyAction
            ? `${busyAction.toUpperCase()}...`
            : statusMessage || errorMessage || "Quotation ready."}
        </LocalizedElement>
        {lastActionAt && (
          <LocalizedElement as="span" style={{ marginLeft: 12, opacity: 0.75 }}>
            Last action: {lastActionAt}
          </LocalizedElement>
        )}
        {lastSavedDraft?.snapshotKey && (
          <LocalizedElement as="div" style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Saved snapshot: {lastSavedDraft.snapshotKey}
          </LocalizedElement>
        )}
      </LocalizedElement>

      <WorkspaceDisclosure title="Document details" className="commercial-no-print"><LocalizedElement as="div" className="quotation-card commercial-no-print">
        <LocalizedElement as="strong">Quotation Sync Status</LocalizedElement>
        <LocalizedElement as="p">
          Refresh count: <LocalizedElement as="strong">{refreshNonce}</LocalizedElement>
          {" · "}
          Last draft saved:{" "}
          <LocalizedElement as="strong">
            {lastSavedDraft?.updatedAt
              ? new Date(lastSavedDraft.updatedAt).toLocaleString("en-AE")
              : "Not saved yet"}
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement></WorkspaceDisclosure>

      {estimate && (
        <LocalizedElement as="div" className="quotation-card commercial-no-print">
          <LocalizedElement as="strong">Loaded Estimate</LocalizedElement>
          <LocalizedElement as="p">
            Basis: <LocalizedElement as="strong">{estimate.basis === "boq" ? "Listed BOQ costs" : "Floor-area preliminary budget"}</LocalizedElement>
            {" · "}
            {estimate.basis === "boq" ? <LocalizedElement as="strong">{estimate.includeProvisional ? "Provisional costs included" : "Verified costs only"}</LocalizedElement> : <LocalizedElement as="strong">
              Benchmark:{" "}
              {Number(estimate.ratePerSqm || 0).toLocaleString("en-AE")} AED/m²
            </LocalizedElement>}
            {" · "}
            Final estimate: <LocalizedElement as="strong">{money(estimate.finalTender)}</LocalizedElement>
          </LocalizedElement>
          {estimate.updatedAt && (
            <LocalizedElement as="p">
              Estimate saved:{" "}
              {new Date(estimate.updatedAt).toLocaleString("en-AE")}
            </LocalizedElement>
          )}
        </LocalizedElement>
      )}

      <LocalizedElement as="div" className="quotation-grid">
        <LocalizedElement as="div" className="quotation-card commercial-no-print">
          {!lineItems && <LocalizedElement as="button" type="button" onClick={() => { setLineItems([{ id: crypto.randomUUID(), description: "Project works", unit: "lot", quantity: 1, rate: quotation.subtotal }]); setCustomVat(estimate?.vatPct ?? 5); }}>Edit quotation items</LocalizedElement>}
          {lineItems && <LocalizedElement as="button" type="button" onClick={() => { setLineItems(null); setCustomVat(null); }}>Use estimate total</LocalizedElement>}
        </LocalizedElement>
        <LocalizedElement as="div" className="quotation-card">
          <LocalizedElement as="label">Client Name</LocalizedElement>
          <LocalizedElement as="p" className="commercial-print-only quotation-print-value"><OriginalText>{clientName || "—"}</OriginalText></LocalizedElement>
          <LocalizedElement as="input" className="commercial-no-print"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Client / Company"
          />
        </LocalizedElement>

        <LocalizedElement as="div" className="quotation-card">
          <LocalizedElement as="label">Validity (days)</LocalizedElement>
          <LocalizedElement as="p" className="commercial-print-only quotation-print-value">{validityDays || "—"}</LocalizedElement>
          <LocalizedElement as="input" className="commercial-no-print"
            type="number"
            min="1"
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
          />
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="quotation-grid">
        <LocalizedElement as="div" className="quotation-card">
          <LocalizedElement as="label">Payment Terms</LocalizedElement>
          <LocalizedElement as="p" className="commercial-print-only quotation-print-value">{paymentTerms || "—"}</LocalizedElement>
          <LocalizedElement as="textarea" className="commercial-no-print"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
          />
        </LocalizedElement>

        <LocalizedElement as="div" className="quotation-card">
          <LocalizedElement as="label">Exclusions</LocalizedElement>
          <LocalizedElement as="p" className="commercial-print-only quotation-print-value">{exclusions || "—"}</LocalizedElement>
          <LocalizedElement as="textarea" className="commercial-no-print"
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
          />
        </LocalizedElement>
      </LocalizedElement>

      {estimate && (
        <LocalizedElement as="div" className="quotation-card">
          <LocalizedElement as="strong">Estimate Basis</LocalizedElement>
          <LocalizedElement as="p">{estimate.basis === "boq" ? "BOQ-based estimate for listed work only. Unlisted work is not included." : "Preliminary budget based on floor area and an editable construction rate."}</LocalizedElement>
          <LocalizedElement as="p">
            Verified measured BOQ: {money(estimate.measuredCost)}
            {" · "}
            Provisional BOQ costs: {money(estimate.provisionalDerivedCost)}
            {" · "}
            {estimate.basis === "boq" ? `Provisional costs included: ${money(estimate.includedProvisionalCost)}` :
              `${estimate.basis ? "Unallocated benchmark gap" : "Legacy allowance"}: ${money(estimate.missingScopeAllowance)}`}
          </LocalizedElement>
          <LocalizedElement as="p">Selected direct cost: {money(estimate.expectedDirectCost)} · Scope completeness requires review.</LocalizedElement>
          <LocalizedElement as="p">
            {estimate.rangeBasis === "user_scenario_not_confidence_interval" ? "Illustrative scenario range" : "Saved estimate range"}: {money(estimate.expectedRangeLow)}
            {" – "}
            {money(estimate.expectedRangeHigh)}
          </LocalizedElement>
        </LocalizedElement>
      )}

      {!lineItems && estimate && <LocalizedElement as="div" className="quotation-lines quotation-budget-lines">
        <LocalizedElement as="table"><LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Description</LocalizedElement><LocalizedElement as="th">Unit</LocalizedElement><LocalizedElement as="th">Quantity</LocalizedElement><LocalizedElement as="th">Rate (AED)</LocalizedElement><LocalizedElement as="th">Amount (AED)</LocalizedElement></LocalizedElement></LocalizedElement>
        <LocalizedElement as="tbody"><LocalizedElement as="tr"><LocalizedElement as="td">Project budget allowance — scope subject to review</LocalizedElement><LocalizedElement as="td">lot</LocalizedElement><LocalizedElement as="td">1</LocalizedElement><LocalizedElement as="td">{money(quotation.subtotal)}</LocalizedElement><LocalizedElement as="td">{money(quotation.subtotal)}</LocalizedElement></LocalizedElement></LocalizedElement></LocalizedElement>
        <LocalizedElement as="p">No itemised quotation has been entered. This allowance is not a measured BOQ.</LocalizedElement>
      </LocalizedElement>}
      {lineItems && <LocalizedElement as="div" className="quotation-lines">
        <LocalizedElement as="table"><LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Description</LocalizedElement><LocalizedElement as="th">Unit</LocalizedElement><LocalizedElement as="th">Quantity</LocalizedElement><LocalizedElement as="th">Rate (AED)</LocalizedElement><LocalizedElement as="th">Amount (AED)</LocalizedElement><LocalizedElement as="th" className="commercial-no-print">Action</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="tbody">{lineItems.map((item) => <LocalizedElement as="tr" key={item.id}>
          {["description", "unit", "quantity", "rate"].map((field) => <LocalizedElement as="td" key={field}><LocalizedElement as="span" className="commercial-print-only">{item[field]}</LocalizedElement><LocalizedElement as="input" className="commercial-no-print" aria-label={`${field} ${item.id}`} type={["quantity", "rate"].includes(field) ? "number" : "text"} min="0" step="any" value={item[field]} onChange={(event) => setLineItems(lineItems.map((row) => row.id === item.id ? { ...row, [field]: event.target.value } : row))} /></LocalizedElement>)}
          <LocalizedElement as="td">{money(Number(item.quantity) * Number(item.rate))}</LocalizedElement><LocalizedElement as="td" className="commercial-no-print"><LocalizedElement as="button" type="button" onClick={() => setLineItems(lineItems.filter((row) => row.id !== item.id))}>Remove</LocalizedElement></LocalizedElement>
        </LocalizedElement>)}</LocalizedElement></LocalizedElement>
        <LocalizedElement as="div" className="commercial-no-print"><LocalizedElement as="button" type="button" onClick={() => setLineItems([...lineItems, { id: crypto.randomUUID(), description: "", unit: "item", quantity: 1, rate: 0 }])}>Add item</LocalizedElement><LocalizedElement as="label">VAT % <LocalizedElement as="input" type="number" min="0" max="100" value={customVat ?? 5} onChange={(event) => setCustomVat(event.target.value)} /></LocalizedElement></LocalizedElement>
        {quotation.error && <LocalizedElement as="p" role="alert">{quotation.error}</LocalizedElement>}
      </LocalizedElement>}
      <LocalizedElement as="div" className="quotation-summary">
        <LocalizedElement as="div">
          <LocalizedElement as="span">Subtotal before VAT</LocalizedElement>
          <LocalizedElement as="strong">{money(quotation.subtotal)}</LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div">
          <LocalizedElement as="span">VAT</LocalizedElement>
          <LocalizedElement as="strong">{money(quotation.vat)}</LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="quotation-total">
          <LocalizedElement as="span">{!lineItems ? "Total preliminary budget" : "Total including VAT"}</LocalizedElement>
          <LocalizedElement as="strong">{money(quotation.total)}</LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="quotation-actions">
        <LocalizedElement as="button"
          type="button"
          onClick={refreshEstimate}
          disabled={busyAction === "refresh"}
        >
          {busyAction === "refresh"
            ? "Refreshing..."
            : "REFRESH ESTIMATE ↻"}
        </LocalizedElement>

        <LocalizedElement as="button"
          type="button"
          onClick={saveDraft}
          disabled={!canUseQuotation || busyAction === "save"}
        >
          {busyAction === "save"
            ? "Saving..."
            : lastSavedDraft
              ? "SAVE DRAFT AGAIN ✓"
              : "SAVE DRAFT QUOTATION"}
        </LocalizedElement>

        <LocalizedElement as="button"
          type="button"
          onClick={generatePdf}
          disabled={!canUseQuotation || busyAction === "pdf"}
        >
          {busyAction === "pdf"
            ? "Opening Print..."
            : "Generate PDF"}
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}
