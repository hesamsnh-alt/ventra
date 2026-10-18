"use client";
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState,subscribeDrawingWorkflow} from '@/lib/drawingWorkflowGate.mjs';
import WorkspaceDisclosure from './WorkspaceDisclosure';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {translateText} from '@/lib/i18n/translate.mjs';
import {localizeBoqText,missingBoqTranslations} from '@/lib/boqLocalization.mjs';
import {useEffectEvent} from "react";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {persistTakeoff} from "@/lib/takeoffStorage.mjs";
import { commercialFetch } from "@/lib/commercialFetch";
import { getDrawingEvidence } from "@/lib/drawingEvidence.mjs";
import { saveReadyBoq } from "@/lib/boqDraftPersistence.mjs";
import CommercialSync from "./CommercialSync";

import { useEffect, useMemo, useState, useRef } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  BookOpen,
  CheckCircle2,
  LoaderCircle,
  Lock,
  Plus,
  Pencil,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from "lucide-react";

import { generateBoq } from "@/services/boqService";
import { getLatestProjectTakeoff } from "@/services/takeoffService";

import "./ProjectBOQ.css";
import DocumentBranding, { useDocumentBranding } from "./DocumentBranding";
import { brandingHtml } from "@/lib/commercialDocument.mjs";
import { classifyEstimateItem } from "@/lib/estimateClassification.mjs";
import { requireBoqReview, confirmBoqReview, invalidateBoqReview } from "@/lib/boqEvidence.mjs";
import { calculateBoqBudget } from "@/lib/boqBudget.mjs";
import { buildBoqExport } from "@/lib/boqExport.mjs";
import {catalogPriceEntries,boqUnitFactor,applyBoqCatalogSelection,editPdfBoqItem} from '@/lib/boqPriceSelection.mjs';
import {applyProjectRateCsv} from '@/lib/boqProjectRates.mjs';


const SECTION_OPTIONS = [
  "General",
  "Preliminaries",
  "Earthworks",
  "Concrete",
  "Masonry Works",
  "Metal Works",
  "Carpentry",
  "Doors & Windows",
  "Finishes",
  "Painting",
  "MEP",
  "External Works",
];

const UNIT_OPTIONS = ["m²", "m³", "m", "nos", "kg", "ton", "lot", "item"];

const UAE_PRICE_LIBRARY = [
  { id: "block-wall-200", section: "Masonry Works", description: "200mm thick concrete block wall including mortar", unit: "m²", rate: 66 },
  { id: "timber-door", section: "Doors & Windows", description: "Single leaf timber door complete with frame and ironmongery", unit: "nos", rate: 1260 },
  { id: "aluminium-window-nos", section: "Doors & Windows", description: "Aluminium framed glazed window complete", unit: "nos", rate: 750 },
  { id: "aluminium-window-area", section: "Doors & Windows", description: "Aluminium framed glazed window complete", unit: "m²", rate: 920 },
  { id: "cement-plaster", section: "Finishes", description: "Internal cement sand plaster to walls", unit: "m²", rate: 27 },
  { id: "emulsion-paint", section: "Painting", description: "Internal wall emulsion paint including primer and putty", unit: "m²", rate: 20 },
  { id: "floor-tiles", section: "Finishes", description: "Supply and installation of porcelain floor tiles", unit: "m²", rate: 115 },
  { id: "gypsum-ceiling", section: "Finishes", description: "Suspended gypsum board ceiling complete", unit: "m²", rate: 145 },
  { id: "tile-skirting", section: "Finishes", description: "Porcelain tile skirting complete", unit: "m", rate: 38 },
  { id: "concrete-slab", section: "Concrete", description: "Reinforced concrete slab including placing and finishing", unit: "m³", rate: 540 },
];


function normalizeSection(section) {
  const value = String(section || "General").trim();
  if (value === "Doors and Windows") return "Doors & Windows";
  return value || "General";
}

function reindexItems(items = []) {
  return items.map((item, index) => ({
    ...item,
    section: normalizeSection(item.section),
    itemNumber: String(index + 1).padStart(2, "0"),
  }));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function normalizeUnit(unit) {
  const units = {
    m2: "m²",
    m3: "m³",
  };

  return units[unit] || unit || "item";
}

function normalizeItems(items = [], takeoff = null) {
  return reindexItems(items.map(requireBoqReview).map((item, index) => ({
    ...item,
    id: item?.id || `${Date.now()}-${index}`,
    itemNumber: item?.itemNumber || String(index + 1),
    section: normalizeSection(item?.section),
    description: item?.description || "BOQ item",
    unit: normalizeUnit(item?.unit),
    quantity: Number(item?.quantity) || 0,
    rate: Number(item?.rate) || 0,
    source: item?.source || "manual_review_required",
    confidence: Number(item?.confidence) || 0,
    notes: item?.notes || "",
    quantityBasis: item?.quantityBasis || "",
    rateSource: item?.rateSource || "Ventra UAE Price Library",
    referenceRate: Number(item?.referenceRate) || 0,
    rateMissing:
      item?.rateMissing === true,
    measuredFromApsStructure:
      item?.measuredFromApsStructure === true,
    status: item?.status || (item?.source === "manual" ? "manual" : item?.verification === "verified" ? "measured" : "quantity_pending"),
    verification:
      item?.verification ||
      (item?.status === "provisional_estimate" ? "provisional" : ["quantity_pending", "measured_rate_pending"].includes(item?.status) ? "pending" : ["measured", "manual"].includes(item?.status) || item?.source === "manual" ? "verified" : "pending"),
    includeInCommercialTotal:
      typeof item?.includeInCommercialTotal === "boolean"
        ? item.includeInCommercialTotal
        : item?.status !== "quantity_pending" &&
          item?.status !== "provisional_estimate",
    quantityLocked: typeof item?.quantityLocked === "boolean" ? item.quantityLocked : item?.source !== "manual",
  })));
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeProjectName(value) {
  return String(value || "project").replace(/[^a-z0-9_-]+/gi, "-");
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ProjectBOQ({
  projectId,
  projectName = "Untitled Project",
}) {
  const {language}=useLanguage();
  const translationContext=useRef({projectId,language});translationContext.current={projectId,language};
  const [boqTranslations,setBoqTranslations]=useState({}),[translatingBoq,setTranslatingBoq]=useState(false),[editingSection,setEditingSection]=useState(null);
  const tr=text=>localizeBoqText(text,language,boqTranslations);
  useEffect(()=>{setBoqTranslations({});try{setBoqTranslations(JSON.parse(sessionStorage.getItem(`ventra:boq-translations:${projectId}:${language}`)||'{}'));}catch{}},[projectId,language]);
  async function translateDescriptions(){
   if(translatingBoq)return;
   const texts=missingBoqTranslations([...items.flatMap(i=>[i.section,i.description,i.quantityBasis,i.notes]),...assumptions,...warnings],language,boqTranslations);
   if(!texts.length)return;setTranslatingBoq(true);setErrorMessage('');
   const selectedLanguage=language,selectedProject=projectId;
   try{
    const response=await commercialFetch('/api/ai/boq-translation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,language,texts:texts.slice(0,150)})});const payload=await response.json();if(!response.ok||!payload.translations)throw new Error(payload.error||'BOQ translation failed; the original descriptions and amounts remain unchanged.');
    const merged={...boqTranslations,...payload.translations};try{sessionStorage.setItem(`ventra:boq-translations:${selectedProject}:${selectedLanguage}`,JSON.stringify(merged));}catch{}
    if(translationContext.current.projectId===selectedProject&&translationContext.current.language===selectedLanguage)setBoqTranslations(merged);
   }catch(e){setErrorMessage(e.message);}finally{setTranslatingBoq(false);}
  }
  const [takeoff, setTakeoff] = useState(null);
  const [boqSource,setBoqSource]=useState(null);
  const [items, setItems] = useState([]);
  const [branding, updateBranding] = useDocumentBranding(projectId);
  const [warnings, setWarnings] = useState([]);
  const [assumptions, setAssumptions] = useState([]);
  const [loadingTakeoff, setLoadingTakeoff] = useState(true);
  const [loadedBoqProject, setLoadedBoqProject] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [drawingWorkflow,setDrawingWorkflow] = useState(()=>drawingWorkflowState(projectId));
  useEffect(()=>{
    setDrawingWorkflow(drawingWorkflowState(projectId));
    return subscribeDrawingWorkflow(projectId,setDrawingWorkflow);
  },[projectId]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [vatPercentage, setVatPercentage] = useState(5);
  const [overheadPercentage, setOverheadPercentage] = useState(0);
  const [profitPercentage, setProfitPercentage] = useState(0);
  const [discountPercentage, setDiscountPercentage] = useState(0);
  const [autoGenerated, setAutoGenerated] = useState(false);
  const [descriptionEditor, setDescriptionEditor] = useState(null);
  const [priceLibraryItemId, setPriceLibraryItemId] = useState(null);
  const [priceSearch, setPriceSearch] = useState("");
  const [priceLibraryEntries,setPriceLibraryEntries]=useState([]);
  const [projectRateImport,setProjectRateImport]=useState(null);
  const [applyingProjectRates,setApplyingProjectRates]=useState(false);
  const projectRateInputRef=useRef(null),projectRateRequestRef=useRef(0),projectRateContextRef=useRef(null);
  projectRateContextRef.current={projectId,takeoff,items,loadedBoqProject,loadingTakeoff,generating,vatPercentage,overheadPercentage,profitPercentage,discountPercentage,warnings,assumptions};
  useEffect(()=>{setApplyingProjectRates(false);return ()=>{projectRateRequestRef.current++;};},[projectId,takeoff?.document_id,takeoff?.analyzed_at]);
  const priceLibraryRequestRef=useRef(0);
  useEffect(()=>{priceLibraryRequestRef.current++;setPriceLibraryEntries([]);setPriceLibraryItemId(null);},[projectId,takeoff?.document_id,takeoff?.analyzed_at,!!takeoff?.pdf_analysis]);
  const [measurementInfo, setMeasurementInfo] = useState(null);
  const [reviewEditor, setReviewEditor] = useState(null);
  const [readingDwg, setReadingDwg] = useState(false);
  async function readDwgImages(event) {
    const files = Array.from(event.target.files || []); event.target.value = "";
    if (!files.length) return;
    if (!takeoff) { setErrorMessage("Run the drawing takeoff first."); return; }
    if (files.length > 4 || files.reduce((n, file) => n + file.size, 0) > 8 * 1024 * 1024) { setErrorMessage("Choose up to four readable images, at most 8 MB total."); return; }
    setReadingDwg(true); setErrorMessage("");
    try {
      const images = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      })));
      const response = await commercialFetch("/api/ai/dwg-evidence", {method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({projectId, images, urn:takeoff.aps_urn || null, records:getDrawingEvidence(takeoff)?.records || []})});
      const result = await response.json();
      if (!response.ok || !result.evidence) throw new Error(result.error || "Drawing evidence extraction failed.");
      const next = {...takeoff, drawing_evidence:{...getDrawingEvidence(takeoff), ...result.evidence}, updated_at:new Date().toISOString()};
      await persistTakeoff(projectId,next);
      if (next.aps_urn) window.localStorage.setItem(`ventra:dwg-evidence:${projectId}:${next.aps_urn}`, JSON.stringify(result.evidence));
      setTakeoff(next);
      setMessage("Drawing schedules and material notes read. Generate BOQ to apply accepted evidence; export any manual BOQ changes before rebuilding.");
    } catch(error) { setErrorMessage(error.message || "Could not read the drawing images."); }
    finally { setReadingDwg(false); }
  }


  function saveReview() {
    try {
      const item = items.find((entry) => entry.id === reviewEditor.id);
      const reviewed = confirmBoqReview(item, reviewEditor.reference, reviewEditor);
      setItems((current) => current.map((entry) => entry.id === reviewed.id ? reviewed : entry));
      setReviewEditor(null);
      setErrorMessage("");
      setMessage("Line reviewed and included in the reviewed BOQ subtotal.");
    } catch (error) { setErrorMessage(error.message); }
  }

  async function generateFromTakeoff(sourceTakeoff, { silent = false } = {}) {
    if (!sourceTakeoff || generating) return false;
    const workflowToken = beginDrawingWorkflow(projectId,'boq');
    if (!workflowToken) {
      if (!silent) setErrorMessage(drawingWorkflowState(projectId).analysisFailed
        ? "The latest drawing analysis failed. Complete a successful analysis before generating a new BOQ."
        : "Drawing analysis or BOQ generation is still running. Wait for it to finish.");
      return false;
    }

    try {
      setGenerating(true);
      if (!silent) {
        setMessage("");
        setErrorMessage("");
      }
      setWarnings([]);
      setAssumptions([]);

      const boq = await generateBoq({
        projectId,
        takeoff: sourceTakeoff,
        projectName,
        priceLevel: "standard",
        vatPercentage,
      });

      if (!Array.isArray(boq?.items) || boq.items.length === 0) {
        throw new Error(
          "The latest takeoff contains no measurable floor, wall, opening, or slab quantities. Return to Drawings and run AI Quantity Takeoff again."
        );
      }

      console.log(
        "[VENTRA BOQ ELECTRICAL INPUT v27]",
        {
          electrical_items:
            Number(
              sourceTakeoff
                ?.electrical_items
            ) || 0,
          lighting_points:
            Number(
              sourceTakeoff
                ?.lighting_points
            ) || 0,
          socket_points:
            Number(
              sourceTakeoff
                ?.socket_points
            ) || 0,
          switches:
            Number(
              sourceTakeoff
                ?.switches
            ) || 0,
          distribution_boards:
            Number(
              sourceTakeoff
                ?.distribution_boards
            ) || 0,
        }
      );

      let generatedItems = normalizeItems(boq.items, sourceTakeoff);
      let nextProjectRateImport=null;
      if(projectRateImport?.csvText&&projectRateImport.projectId===projectId&&projectRateImport.documentId&&projectRateImport.documentId===sourceTakeoff.document_id){
        const imported=applyProjectRateCsv(generatedItems,sourceTakeoff,projectRateImport.csvText,{fileName:projectRateImport.fileName});
        nextProjectRateImport={...imported.summary,projectId,documentId:sourceTakeoff.document_id,analyzedAt:sourceTakeoff.analyzed_at,csvText:projectRateImport.csvText,beforeItems:generatedItems};
        generatedItems=normalizeItems(imported.items,sourceTakeoff);
      }
      // Commit the complete result before a tab switch can unmount this panel.
      saveReadyBoq(window.localStorage, projectId, {
        projectName, currency: "AED", vatPercentage, overheadPercentage,
        profitPercentage, discountPercentage, items: generatedItems,
        warnings: Array.isArray(boq.warnings) ? boq.warnings : [],
        assumptions: Array.isArray(boq.assumptions) ? boq.assumptions : [],
        takeoff: sourceTakeoff, boqSource:{documentId:sourceTakeoff.document_id,name:sourceTakeoff.document_name,recordedBy:151}, projectRateImport:nextProjectRateImport, updatedAt: new Date().toISOString(),
      }, { loadedProject: projectId, loading: false, generating: false });
      setTakeoff(sourceTakeoff);
      setBoqSource({documentId:sourceTakeoff.document_id,name:sourceTakeoff.document_name,recordedBy:151});
      setItems(generatedItems);
      setProjectRateImport(nextProjectRateImport);
      setWarnings(Array.isArray(boq.warnings) ? boq.warnings : []);
      setAssumptions(Array.isArray(boq.assumptions) ? boq.assumptions : []);
      setMessage(nextProjectRateImport?`BOQ rebuilt; ${nextProjectRateImport.appliedRows} project CSV rates reapplied. Unmatched scopes remain unresolved.`:"BOQ generated successfully from the latest Quantity Takeoff.");
      return true;
    } catch (error) {
      console.error("Generate BOQ error:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Could not generate the BOQ."
      );
      return false;
    } finally {
      finishDrawingWorkflow(projectId,workflowToken,true);
      setGenerating(false);
    }
  }

  const generateBoqFromEffect=useEffectEvent(generateFromTakeoff);
  const generatedFlagFromEffect=useEffectEvent(()=>autoGenerated);
  useEffect(() => {
    let mounted = true;

    async function loadTakeoff() {
      setLoadedBoqProject(null);
      setItems([]);
      setProjectRateImport(null);
      setTakeoff(null);
      setBoqSource(null);
      setWarnings([]);
      setAssumptions([]);
      if (!projectId) {
        if (mounted) {
          setErrorMessage("Project ID is missing.");
          setLoadingTakeoff(false);
        }
        return;
      }

      try {
        setLoadingTakeoff(true);
        setErrorMessage("");

        const { takeoff: latestTakeoff, error } =
          await getLatestProjectTakeoff(projectId);

        if (!mounted) return;
        if (error) throw error;

        setTakeoff(latestTakeoff || null);

        const storedBoq = window.localStorage.getItem(
          `ventra:project-boq:${projectId}`
        );

        let storedItems = [];

        if (storedBoq) {
          const parsedBoq = JSON.parse(storedBoq);
          setBoqSource(parsedBoq.boqSource||null);
          const savedRates=parsedBoq?.projectRateImport;
          setProjectRateImport(savedRates?.projectId===projectId&&savedRates?.documentId&&savedRates.documentId===latestTakeoff?.document_id&&savedRates.analyzedAt===latestTakeoff?.analyzed_at&&typeof savedRates?.csvText==='string'&&savedRates.csvText.length<=4*1024*1024&&Array.isArray(savedRates.beforeItems)?savedRates:null);
          storedItems = normalizeItems(parsedBoq?.items || [], latestTakeoff);
          setItems(storedItems);
          setWarnings(
            Array.isArray(parsedBoq?.warnings) ? parsedBoq.warnings : []
          );
          setAssumptions(
            Array.isArray(parsedBoq?.assumptions)
              ? parsedBoq.assumptions
              : []
          );
          setVatPercentage(Number.isFinite(Number(parsedBoq?.vatPercentage)) ? Number(parsedBoq.vatPercentage) : 5);
          setOverheadPercentage(Number.isFinite(Number(parsedBoq?.overheadPercentage)) ? Number(parsedBoq.overheadPercentage) : 0);
          setProfitPercentage(Number.isFinite(Number(parsedBoq?.profitPercentage)) ? Number(parsedBoq.profitPercentage) : 0);
          setDiscountPercentage(Number.isFinite(Number(parsedBoq?.discountPercentage)) ? Number(parsedBoq.discountPercentage) : 0);
        }

        // A completed takeoff should never leave the BOQ page as an empty shell.
        // Generate once automatically when no saved BOQ rows exist.
        if (latestTakeoff && storedItems.length === 0 && !generatedFlagFromEffect()) {
          setAutoGenerated(true);
          await generateBoqFromEffect(latestTakeoff, { silent: true });
        }
        if (mounted) setLoadedBoqProject(projectId);
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Could not load BOQ data."
          );
        }
      } finally {
        if (mounted) setLoadingTakeoff(false);
      }
    }

    loadTakeoff();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  const subtotal = useMemo(
    () =>
      items
        .filter(
          (item) =>
            classifyEstimateItem(item) === "verified"
        )
        .reduce(
          (sum, item) =>
            sum +
            Number(item.quantity) *
              Number(item.rate),
          0
        ),
    [items]
  );

  const overhead = useMemo(
    () => subtotal * ((Number(overheadPercentage) || 0) / 100),
    [subtotal, overheadPercentage]
  );

  const profit = useMemo(
    () => (subtotal + overhead) * ((Number(profitPercentage) || 0) / 100),
    [subtotal, overhead, profitPercentage]
  );

  const discount = useMemo(
    () => (subtotal + overhead + profit) * ((Number(discountPercentage) || 0) / 100),
    [subtotal, overhead, profit, discountPercentage]
  );

  const taxableTotal = Math.max(0, subtotal + overhead + profit - discount);

  const vat = useMemo(
    () => taxableTotal * ((Number(vatPercentage) || 0) / 100),
    [taxableTotal, vatPercentage]
  );

  const total = taxableTotal + vat;
  const lineSums = useMemo(() => buildBoqExport(items).sums, [items]);
  const budget = calculateBoqBudget(lineSums, { overheadPercentage, profitPercentage, discountPercentage, vatPercentage });


  useEffect(() => {
    if (!projectId) return;

    saveReadyBoq(window.localStorage, projectId, {
        projectName,
        currency: "AED",
        vatPercentage,
        overheadPercentage,
        profitPercentage,
        discountPercentage,
        items,
        warnings,
        assumptions,
        takeoff,
        boqSource,
        projectRateImport,
        updatedAt: new Date().toISOString(),
      }, { loadedProject: loadedBoqProject, loading: loadingTakeoff, generating:generating||applyingProjectRates });
  }, [projectId, loadedBoqProject, loadingTakeoff, generating, applyingProjectRates, projectName, vatPercentage, overheadPercentage, profitPercentage, discountPercentage, items, warnings, assumptions, takeoff, boqSource, projectRateImport]);

  function saveProjectRateDraft(nextItems,nextImport) {
    const saved=saveReadyBoq(window.localStorage,projectId,{
      projectName,currency:'AED',vatPercentage,overheadPercentage,profitPercentage,discountPercentage,
      items:nextItems,warnings,assumptions,takeoff,boqSource,projectRateImport:nextImport,updatedAt:new Date().toISOString(),
    },{loadedProject:loadedBoqProject,loading:loadingTakeoff,generating});
    if(!saved)throw Error('BOQ is still loading or generating. Wait before applying project rates.');
  }

  async function importProjectRateCsv(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!takeoff?.pdf_analysis||loadingTakeoff||generating||applyingProjectRates||loadedBoqProject!==projectId){setErrorMessage('Wait for the PDF BOQ to finish loading.');return;}
    if(!takeoff.document_id){setErrorMessage('The PDF document reference is missing. Reopen its saved BOQ before importing rates.');return;}
    if(file.size>4*1024*1024){setErrorMessage('Choose a project rate CSV smaller than 4 MB.');return;}
    const token=beginDrawingWorkflow(projectId,'boq');if(!token){setErrorMessage('Wait for drawing analysis or BOQ generation to finish.');return;}
    const request=++projectRateRequestRef.current,snapshot=projectRateContextRef.current;
    const current=()=>request===projectRateRequestRef.current&&projectRateContextRef.current?.projectId===snapshot.projectId;
    let succeeded=false;setApplyingProjectRates(true);setErrorMessage('');
    try{
      const text=await file.text();if(!current())return;
      const latest=projectRateContextRef.current;
      if(['takeoff','items','loadedBoqProject','vatPercentage','overheadPercentage','profitPercentage','discountPercentage','warnings','assumptions'].some(k=>latest[k]!==snapshot[k]))throw Error('BOQ or drawing changed while reading the CSV. Select the file again for the current BOQ.');
      const imported=applyProjectRateCsv(items,takeoff,text,{fileName:file.name});
      const nextItems=normalizeItems(imported.items,takeoff);
      const nextImport={...imported.summary,projectId,documentId:takeoff.document_id,analyzedAt:takeoff.analyzed_at,csvText:text,beforeItems:items};
      // Persist the entire draft and restore point before publishing UI state.
      // A quota/disk failure leaves the current BOQ untouched.
      saveProjectRateDraft(nextItems,nextImport);
      setItems(nextItems);setProjectRateImport(nextImport);setPriceLibraryItemId(null);
      setMessage(`${imported.summary.appliedRows} project CSV rates applied and saved; ${imported.summary.unboundCodes.length} CSV rows were not applied. No AI analysis was run.`);
      succeeded=true;
    }catch(error){if(current())setErrorMessage(error.message||'Project rate CSV could not be applied.');}
    finally{finishDrawingWorkflow(projectId,token,succeeded);if(current())setApplyingProjectRates(false);}
  }

  function restoreBeforeProjectRates() {
    if(!projectRateImport||projectRateImport.projectId!==projectId||projectRateImport.documentId!==takeoff?.document_id)return;
    if(projectRateImport.analyzedAt!==takeoff?.analyzed_at){setErrorMessage('The PDF analysis has changed. Its earlier BOQ rows cannot be restored to this analysis.');return;}
    const token=beginDrawingWorkflow(projectId,'boq');if(!token){setErrorMessage('Wait for drawing analysis or BOQ generation to finish.');return;}
    let succeeded=false;
    try{
      const restored=normalizeItems(projectRateImport.beforeItems,takeoff);
      saveProjectRateDraft(restored,null);setItems(restored);setProjectRateImport(null);setErrorMessage('');
      setMessage('BOQ rows restored to the saved state before the latest CSV import.');succeeded=true;
    }catch(error){setErrorMessage(error.message||'The saved BOQ could not be restored.');}
    finally{finishDrawingWorkflow(projectId,token,succeeded);}
  }

  function updateItem(id, field, value) {
    if(takeoff?.pdf_analysis){
      try{setItems(items.map(item=>item.id===id?editPdfBoqItem(item,field,value):item));setErrorMessage('');}
      catch(error){setErrorMessage(error.message);}
      return;
    }
    setItems((currentItems) => {
      const updatedItems = currentItems.map((item) =>
        item.id === id
          ? {
              ...invalidateBoqReview(item),
              [field]:
                field === "quantity" || field === "rate"
                  ? Math.max(0, Number(value) || 0)
                  : value,
            }
          : item
      );

      return field === "section" ? reindexItems(updatedItems) : updatedItems;
    });
  }

  function addItem() {
    setErrorMessage("");
    setMessage("");
    setItems((currentItems) => reindexItems([
      ...currentItems,
      {
        id: `${Date.now()}-manual`,
        itemNumber: String(currentItems.length + 1),
        section: "General",
        description: "New BOQ item",
        unit: "item",
        quantity: 1,
        rate: 0,
        source: "manual",
        confidence: 100,
        notes: "",
        status: "manual",
        verification: "manual",
        includeInCommercialTotal: true,
        quantityLocked: false,
        rateSource: "Manual rate",
      },
    ]));
  }

  function removeItem(id) {
    setItems((currentItems) =>
      reindexItems(currentItems.filter((item) => item.id !== id))
    );
  }

  function toggleQuantityLock(id) {
    setItems((currentItems) => currentItems.map((item) =>
      item.id === id ? { ...item, quantityLocked: !item.quantityLocked } : item
    ));
  }

  function openDescriptionEditor(item) {
    setDescriptionEditor({ id: item.id, value: item.description });
  }

  function saveDescriptionEditor() {
    if (!descriptionEditor) return;
    updateItem(descriptionEditor.id, "description", descriptionEditor.value);
    setDescriptionEditor(null);
  }

  async function openPriceLibrary(item) {
    const request=++priceLibraryRequestRef.current;
    setPriceLibraryItemId(item.id);
    setPriceSearch("");
    if(!takeoff?.pdf_analysis){setPriceLibraryEntries(UAE_PRICE_LIBRARY);return;}
    setPriceLibraryEntries([]);setErrorMessage('');setMessage('Loading existing price catalog…');
    try{
      const response=await commercialFetch('/api/boq/catalog',{method:'GET',cache:'no-store'});
      const payload=await response.json();if(!response.ok||payload.success!==true)throw Error(payload.error||'Price catalog could not be loaded.');
      const entries=catalogPriceEntries(payload.catalog);
      if(request!==priceLibraryRequestRef.current)return;
      setPriceLibraryEntries(entries);setMessage('Existing catalog loaded. Search by item code or description; up to 100 compatible matches are shown. Zero-rate entries require a project rate.');
    }catch(error){if(request===priceLibraryRequestRef.current){setErrorMessage(error.message);setMessage('');}}
  }

  function applyLibraryRate(entry) {
    if(takeoff?.pdf_analysis){
      try{
        const selected=items.find(item=>item.id===priceLibraryItemId);if(!selected)throw Error('BOQ item is no longer available.');
        const updated=applyBoqCatalogSelection(selected,entry);
        setItems(items.map(item=>item.id===selected.id?updated:item));setPriceLibraryItemId(null);setPriceSearch('');setErrorMessage('');
        setMessage('Existing catalog rate applied with compatible units. Review the complete line before commercial inclusion.');
      }catch(error){setErrorMessage(error.message);}
      return;
    }
    setItems((currentItems) => currentItems.map((item) =>
      item.id === priceLibraryItemId ? requireBoqReview({
        ...invalidateBoqReview(item), section: entry.section, description: entry.description,
        unit: entry.unit, rate: entry.rate, rateSource: "Ventra UAE Price Library", rateMissing: false,
        status: item.status === "measured_rate_pending" ? "provisional_estimate" : item.status,
        verification: item.status === "measured_rate_pending" ? "provisional" : item.verification,
        includeInCommercialTotal: false,
      }) : item
    ));
    setPriceLibraryItemId(null);
    setPriceSearch("");
    setMessage("Budget rate applied. Review the complete line before commercial inclusion.");
  }

  function exportCsv() {
    if (items.length === 0) {
      setErrorMessage("Generate or add BOQ items before exporting.");
      return;
    }

    const exportDocument = buildBoqExport(items, { overheadPercentage, profitPercentage, discountPercentage, vatPercentage, overhead, profit, discount, vat, total }, {language,translations:boqTranslations});
    const rows = [
      [branding.companyName, branding.address, branding.contact, branding.taxNumber],
      [projectName + " - Bill of Quantities"],
      [exportDocument.note],
      exportDocument.headers,
      ...exportDocument.rows,
      [],
      ...exportDocument.summary.map(([label, amount]) => [label, "", "", "", "", "", amount]),
    ];

    const csv = rows
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n");

    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = projectName.replace(/[^a-z0-9_-]+/gi, "-");

    link.href = url;
    link.download = `${safeName || "project"}-boq.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    if (items.length === 0) {
      setErrorMessage("Generate or add BOQ items before exporting.");
      return;
    }

    const exportDocument = buildBoqExport(items, { overheadPercentage, profitPercentage, discountPercentage, vatPercentage, overhead, profit, discount, vat, total }, {language,translations:boqTranslations});
    const rows = exportDocument.rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
    const headers = exportDocument.headers.map(value => `<th>${escapeHtml(value)}</th>`).join("");
    const summary = exportDocument.summary.map(([label, amount]) => `<tr><td colspan="6">${escapeHtml(label)}</td><td>${escapeHtml(amount)}</td><td colspan="6"></td></tr>`).join("");
    const workbook = `<!doctype html><html lang="${language}" dir="${language==='en'?'ltr':'rtl'}"><head><meta charset="utf-8"></head><body><p>${escapeHtml(exportDocument.note)}</p><table border="1"><tr><th colspan="13">${escapeHtml(projectName)} - ${escapeHtml(tr("Bill of Quantities"))}</th></tr><tr>${headers}</tr>${rows}${summary}</table></body></html>`;

    downloadBlob(workbook.replace("<body>", `<body>${brandingHtml(branding)}`), `${safeProjectName(projectName)}-boq.xls`, "application/vnd.ms-excel;charset=utf-8");
  }

  function exportPdf() {
    if (items.length === 0) {
      setErrorMessage("Generate or add BOQ items before exporting.");
      return;
    }

    window.print();
  }

  async function handleGenerateBoq() {
    if (generating) return;
    if (drawingWorkflowState(projectId).active || drawingWorkflowState(projectId).analysisFailed) {
      setErrorMessage(drawingWorkflowState(projectId).analysisFailed
        ? "The latest drawing analysis failed. Complete a successful analysis before generating a new BOQ."
        : "Drawing analysis is still running. Wait for the completed analysis before generating BOQ.");
      return;
    }

    setMessage("");
    setErrorMessage("");

    const { takeoff: latestTakeoff, error: latestTakeoffError } =
      await getLatestProjectTakeoff(projectId);

    if (latestTakeoffError) {
      setErrorMessage(latestTakeoffError.message || "Could not load the latest takeoff.");
      return;
    }

    if (!latestTakeoff) {
      setErrorMessage(
        "No Quantity Takeoff was found for this project. Open Drawings, run AI Quantity Takeoff, then return to BOQ."
      );
      return;
    }

    await generateFromTakeoff(latestTakeoff);
  }

  return (
    <LocalizedElement as="section" className="boq-panel">
      <CommercialSync projectId={projectId} />
      <DocumentBranding branding={branding} onChange={updateBranding} />
      <LocalizedElement as="div" className="boq-header">
        <LocalizedElement as="div">
          <LocalizedElement as="span">QUANTITY TAKEOFF</LocalizedElement>
          <LocalizedElement as="h2">Bill of Quantities</LocalizedElement>
          <LocalizedElement as="p">Generate editable quantities and budget rates from the latest takeoff.</LocalizedElement>
          {items.length>0 && <p style={{overflowWrap:'anywhere'}}>BOQ source / مرجع BOQ: {boqSource?.name || 'ثبت نشده؛ گزارش قدیمی را با فایل فعال تطبیق بده / Legacy reference not recorded'}</p>}
          {drawingWorkflow.analysisFailed && <p role="alert">آخرین تحلیل موفق نشده است؛ ردیف‌های موجود ممکن است مربوط به گزارش قبلی باشند. / Latest analysis failed; existing BOQ rows may belong to an earlier report.</p>}
        </LocalizedElement>

        <LocalizedElement as="div" className="boq-header-actions">
          <LocalizedElement as="button"
            type="button"
            onClick={handleGenerateBoq}
            disabled={generating || loadingTakeoff || !!drawingWorkflow.active || drawingWorkflow.analysisFailed}
          >
            {generating ? (
              <LoaderCircle size={17} className="boq-spinner" />
            ) : (
              <Sparkles size={17} />
            )}
            {generating ? "Generating..." : "Generate BOQ"}
          </LocalizedElement>

          <LocalizedElement as="button" type="button" className="boq-secondary" onClick={addItem}>
            <Plus size={17} />
            Add Item
          </LocalizedElement>

          <WorkspaceDisclosure title="Export & reports" className="workspace-export-drawer commercial-no-print"><LocalizedElement as="button" type="button" className="boq-secondary" onClick={exportCsv}>
            <Download size={17} />
            CSV
          </LocalizedElement>

          <LocalizedElement as="button" type="button" className="boq-secondary" onClick={exportExcel}>
            <FileSpreadsheet size={17} />
            Excel
          </LocalizedElement>

          <LocalizedElement as="button" type="button" className="boq-secondary" onClick={exportPdf}>
            <FileText size={17} />
            PDF
          </LocalizedElement></WorkspaceDisclosure>
        </LocalizedElement>
      </LocalizedElement>

      {loadingTakeoff && (
        <LocalizedElement as="div" className="boq-status-message">Loading Quantity Takeoff...</LocalizedElement>
      )}

      {!loadingTakeoff && !takeoff && !errorMessage && (
        <LocalizedElement as="div" className="boq-warning-message">
          Run AI Quantity Takeoff first, then generate the BOQ.
        </LocalizedElement>
      )}

      {message && <LocalizedElement as="div" className="boq-success-message">{message}</LocalizedElement>}
      <LocalizedElement as="details" className="boq-warning-message">
        <LocalizedElement as="summary">Drawing notes and schedule evidence · {getDrawingEvidence(takeoff || {})?.records?.length || 0} text records</LocalizedElement>
        <LocalizedElement as="p">DWG schedules are read twice. Complete, matching whole-project tables supply BOQ quantities; specification and rate still require review.</LocalizedElement>
        <LocalizedElement as="label">{readingDwg ? "Reading schedules and notes…" : "Read clear schedule/notes screenshots (up to 4)"}<LocalizedElement as="input" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={readingDwg || generating || !takeoff} onChange={readDwgImages} /></LocalizedElement>
        <LocalizedElement as="p">This uses drawing analysis allowance. Use a complete readable schedule with its header, all rows and material notes.</LocalizedElement>
        {getDrawingEvidence(takeoff || {})?.extractionError && <LocalizedElement as="p" role="alert">{getDrawingEvidence(takeoff)?.extractionError}</LocalizedElement>}
        {(getDrawingEvidence(takeoff || {})?.tables || []).map((table,index) => <LocalizedElement as="div" key={index}><LocalizedElement as="strong">{table.kind} schedule · {table.scope || "project"} · {table.accepted ? `accepted quantity total: ${table.total}` : "unresolved: no count replacement"}</LocalizedElement><LocalizedElement as="ul">{table.rows.map((row,i) => <LocalizedElement as="li" key={i}>{row.mark}: {row.quantityAccepted ? row.quantity : "quantity pending"} · {row.material || "material unspecified"} · {row.dimensions}</LocalizedElement>)}</LocalizedElement></LocalizedElement>)}
        <LocalizedElement as="ul">{(getDrawingEvidence(takeoff || {})?.specifications || []).map((spec,index) => <LocalizedElement as="li" key={index}>{spec.scope} · {spec.location}: {spec.material} · {spec.accepted ? "matching source reads" : "needs review"} · {spec.quote}</LocalizedElement>)}</LocalizedElement>
        <LocalizedElement as="ul">{(getDrawingEvidence(takeoff || {})?.issues || []).map((issue,index) => <LocalizedElement as="li" key={index}>{issue}</LocalizedElement>)}</LocalizedElement>
        {!getDrawingEvidence(takeoff || {})?.records?.length && <LocalizedElement as="p">No explicit CAD text properties were retained in this takeoff. Re-extract the engineering drawing to capture available text, or review the original drawing manually.</LocalizedElement>}
        {getDrawingEvidence(takeoff || {})?.truncated && <LocalizedElement as="p">Text capture reached its limit; inspect the original drawing for omitted notes.</LocalizedElement>}
        <LocalizedElement as="ul">{(getDrawingEvidence(takeoff || {})?.records || []).slice(0, 50).map((record, index) => <LocalizedElement as="li" key={index}>Object {record.dbId ?? "unknown"} · {record.field}: {record.text}</LocalizedElement>)}</LocalizedElement>
        {(getDrawingEvidence(takeoff || {})?.records?.length || 0) > 50 && <LocalizedElement as="p">Showing the first 50 text records; the retained records remain in the takeoff.</LocalizedElement>}
      </LocalizedElement>
      {items.some((item) => item?.status === "provisional_estimate") && (
        <LocalizedElement as="div" className="boq-warning-message">
          Unreviewed quantities, catalog specifications and budget rates are provisional and excluded from the reviewed BOQ subtotal. Review each complete line against the drawing and applicable rates.
        </LocalizedElement>
      )}
      {items.some((item) => item?.status === "measured_rate_pending") && (
        <LocalizedElement as="div" className="boq-warning-message">
          Any measured structural quantity without a safe catalog rate remains excluded from the commercial subtotal until a rate is confirmed.
        </LocalizedElement>
      )}
      {errorMessage && (
        <LocalizedElement as="div" className="boq-error-message">{errorMessage}</LocalizedElement>
      )}

      {warnings.length > 0 && (
        <LocalizedElement as="div" className="boq-warning-box">
          <LocalizedElement as="strong">Warnings</LocalizedElement>
          <LocalizedElement as="ul">
            {warnings.map((warning, index) => (
              <LocalizedElement as="li" key={`${warning}-${index}`}>{tr(warning)}</LocalizedElement>
            ))}
          </LocalizedElement>
        </LocalizedElement>
      )}

      {assumptions.length > 0 && (
        <LocalizedElement as="div" className="boq-assumption-box">
          <LocalizedElement as="strong">Assumptions</LocalizedElement>
          <LocalizedElement as="ul">
            {assumptions.map((assumption, index) => (
              <LocalizedElement as="li" key={`${assumption}-${index}`}>{tr(assumption)}</LocalizedElement>
            ))}
          </LocalizedElement>
        </LocalizedElement>
      )}

      {language!=='en'&&missingBoqTranslations([...items.flatMap(i=>[i.section,i.description,i.quantityBasis,i.notes]),...assumptions,...warnings],language,boqTranslations).length>0&&<LocalizedElement as="div" className="boq-assumption-box"><LocalizedElement as="p">Some project descriptions need translation. Translating uses the AI API and the project BOQ analysis allowance; original quantities and rates stay unchanged.</LocalizedElement><LocalizedElement as="button" type="button" className="boq-secondary" disabled={translatingBoq||generating} onClick={translateDescriptions}>{translatingBoq?'Translating BOQ descriptions…':'Translate remaining BOQ descriptions'}</LocalizedElement></LocalizedElement>}
      <LocalizedElement as="datalist" id="boq-section-options">
        {SECTION_OPTIONS.map((section) => <LocalizedElement as="option" key={section} value={tr(section)} />)}
      </LocalizedElement>

      <LocalizedElement as="div" className="boq-table-wrap">
        <LocalizedElement as="table" className="boq-table">
          <LocalizedElement as="colgroup">
            <LocalizedElement as="col" className="boq-col-number" />
            <LocalizedElement as="col" className="boq-col-section" />
            <LocalizedElement as="col" className="boq-col-description" />
            <LocalizedElement as="col" className="boq-col-unit" />
            <LocalizedElement as="col" className="boq-col-quantity" />
            <LocalizedElement as="col" className="boq-col-rate" />
            <LocalizedElement as="col" className="boq-col-amount" />
            <LocalizedElement as="col" className="boq-col-actions" />
          </LocalizedElement>
          <LocalizedElement as="thead">
            <LocalizedElement as="tr">
              <LocalizedElement as="th">No.</LocalizedElement>
              <LocalizedElement as="th">Section</LocalizedElement>
              <LocalizedElement as="th">Description</LocalizedElement>
              <LocalizedElement as="th">Unit</LocalizedElement>
              <LocalizedElement as="th">Quantity</LocalizedElement>
              <LocalizedElement as="th">Rate</LocalizedElement>
              <LocalizedElement as="th">Amount</LocalizedElement>
              <LocalizedElement as="th" />
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="tbody">
            {items.length === 0 ? (
              <LocalizedElement as="tr">
                <LocalizedElement as="td" colSpan="8" className="boq-empty-row">
                  No BOQ items yet.
                </LocalizedElement>
              </LocalizedElement>
            ) : (
              items.map((item) => {
                const amount = Number(item.quantity) * Number(item.rate);
                const tooltip = [item.description, item.quantityBasis, item.notes, item.source].filter(Boolean).join(" • ");

                const ratePending =
                  item?.status ===
                    "measured_rate_pending" ||
                  item?.rateMissing === true;

                return (
                  <LocalizedElement as="tr"
                    key={item.id}
                    title={
                      ratePending
                        ? (takeoff?.pdf_analysis?"Recorded project quantity. Specification and rate require review.":"Measured quantity verified. Commercial rate pending.")
                        : undefined
                    }
                  >
                    <LocalizedElement as="td" className="boq-item-number">{item.itemNumber}</LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="input"
                        className="boq-searchable-field"
                        list="boq-section-options"
                        value={editingSection===item.id?item.section:tr(item.section)}
                        onFocus={()=>setEditingSection(item.id)} onBlur={()=>setEditingSection(null)}
                        title={item.section}
                        onChange={(event) => updateItem(item.id, "section", SECTION_OPTIONS.find(s=>tr(s)===event.target.value)||event.target.value)}
                        aria-label={`Section for item ${item.itemNumber}`}
                      />
                    </LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="button"
                        type="button"
                        className="boq-description-button"
                        title={tr(item.description)+" • "+[item.quantityBasis,item.notes,item.source].filter(Boolean).map(tr).join(" • ")}
                        onDoubleClick={() => openDescriptionEditor(item)}
                        onClick={() => openDescriptionEditor(item)}
                      >
                        <LocalizedElement as="span">
                          {tr(item.description)}
                          {item.reviewRequired ? tr("  •  REVIEW REQUIRED") : item.status === "measured_rate_pending" ? tr("  •  MEASURED / RATE PENDING") : ""}
                        </LocalizedElement>
                        <Pencil className="boq-edit-icon" size={15} aria-hidden="true" />
                      </LocalizedElement>
                      <LocalizedElement as="button" type="button" className="boq-secondary" onClick={() => setReviewEditor({ id: item.id, reference: "", scope: false, quantity: false, rate: false })}>
                        {item.review?.confirmed ? "Review again" : "Review line"}
                      </LocalizedElement>
                    </LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="select"
                        className="boq-unit-badge"
                        value={item.unit}
                        onChange={(event) => updateItem(item.id, "unit", event.target.value)}
                      >
                        {(UNIT_OPTIONS.includes(item.unit) ? UNIT_OPTIONS : [...UNIT_OPTIONS, item.unit]).map((unit) => (
                          <LocalizedElement as="option" key={unit} value={unit}>{unit}</LocalizedElement>
                        ))}
                      </LocalizedElement>
                    </LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="div" className="boq-quantity-control">
                        <LocalizedElement as="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantity}
                          disabled={item.quantityLocked}
                          onChange={(event) => updateItem(item.id, "quantity", event.target.value)}
                          title={item.quantityBasis || "BOQ quantity"}
                        />
                        <LocalizedElement as="button"
                          type="button"
                          className={`boq-inline-icon ${item.quantityLocked ? "is-measured" : "is-manual"}`}
                          onClick={() => {
                            if (item.quantityLocked) {
                              setMeasurementInfo(item);
                            } else {
                              toggleQuantityLock(item.id);
                            }
                          }}
                          title={item.quantityLocked ? "View measurement source" : "Lock manual quantity"}
                        >
                          {item.quantityLocked ? (
                            <><Lock size={14} /><LocalizedElement as="span" className="boq-visually-hidden">Measured quantity</LocalizedElement></>
                          ) : (
                            <><Unlock size={14} /><LocalizedElement as="span" className="boq-visually-hidden">Manual quantity</LocalizedElement></>
                          )}
                        </LocalizedElement>
                      </LocalizedElement>
                    </LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="div" className="boq-rate-control">
                        <LocalizedElement as="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.rate}
                          placeholder={ratePending ? "Rate pending" : "0.00"}
                          onChange={(event) => {
                            updateItem(item.id, "rate", event.target.value);
                            if (
                              !takeoff?.pdf_analysis && ratePending &&
                              Number(event.target.value) > 0
                            ) {
                              setItems((currentItems) =>
                                currentItems.map((currentItem) =>
                                  currentItem.id === item.id
                                    ? {
                                        ...invalidateBoqReview(currentItem),
                                        rateMissing: false,
                                        status: "provisional_estimate",
                                        verification: "provisional",
                                        includeInCommercialTotal: false,
                                        rateSource: "Manual confirmed rate",
                                      }
                                    : currentItem
                                )
                              );
                            }
                          }}
                        />
                        <LocalizedElement as="button"
                          type="button"
                          className="boq-inline-icon"
                          onClick={() => openPriceLibrary(item)}
                          title="Choose from UAE Price Library"
                        >
                          <BookOpen size={15} />
                          <LocalizedElement as="span" className="boq-visually-hidden">UAE 2026 price library</LocalizedElement>
                        </LocalizedElement>
                      </LocalizedElement>
                    </LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="div"
                        className="boq-amount-cell"
                        title={`${Number(item.quantity).toLocaleString("en-AE")} × ${formatCurrency(item.rate)} = ${formatCurrency(amount)}`}
                      >
                        <LocalizedElement as="strong" className="boq-line-amount">
                          {ratePending
                            ? "RATE PENDING"
                            : formatCurrency(amount)}
                        </LocalizedElement>
                        <LocalizedElement as="small" title={ratePending ? "Measured quantity, rate required" : "Automatically calculated"}>
                          <CheckCircle2 size={13} />
                          <LocalizedElement as="span" className="boq-visually-hidden">
                            {ratePending ? "Measured quantity, rate required" : "Automatically calculated"}
                          </LocalizedElement>
                        </LocalizedElement>
                      </LocalizedElement>
                    </LocalizedElement>
                    <LocalizedElement as="td">
                      <LocalizedElement as="button" type="button" className="boq-delete" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.description}`}>
                        <Trash2 size={16} />
                      </LocalizedElement>
                    </LocalizedElement>
                  </LocalizedElement>
                );
              })
            )}
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="boq-summary-grid">
        <LocalizedElement as="div" className="boq-adjustments">
          <LocalizedElement as="label"><LocalizedElement as="span">Overhead percentage</LocalizedElement><LocalizedElement as="input" type="number" min="0" max="100" step="0.1" value={overheadPercentage} onChange={(event) => setOverheadPercentage(Math.max(0, Number(event.target.value) || 0))} /></LocalizedElement>
          <LocalizedElement as="label"><LocalizedElement as="span">Profit percentage</LocalizedElement><LocalizedElement as="input" type="number" min="0" max="100" step="0.1" value={profitPercentage} onChange={(event) => setProfitPercentage(Math.max(0, Number(event.target.value) || 0))} /></LocalizedElement>
          <LocalizedElement as="label"><LocalizedElement as="span">Discount percentage</LocalizedElement><LocalizedElement as="input" type="number" min="0" max="100" step="0.1" value={discountPercentage} onChange={(event) => setDiscountPercentage(Math.max(0, Number(event.target.value) || 0))} /></LocalizedElement>
          <LocalizedElement as="label"><LocalizedElement as="span">VAT percentage</LocalizedElement><LocalizedElement as="input" type="number" min="0" max="100" step="0.1" value={vatPercentage} onChange={(event) => setVatPercentage(Math.max(0, Number(event.target.value) || 0))} /></LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="boq-totals">
          <LocalizedElement as="div"><LocalizedElement as="span">All displayed row amounts · before adjustments</LocalizedElement><LocalizedElement as="strong">{formatCurrency(budget.displayed)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Provisional subtotal · included in budget</LocalizedElement><LocalizedElement as="strong">{formatCurrency(lineSums.provisional)}</LocalizedElement></LocalizedElement>
          {lineSums.pending !== 0 && <LocalizedElement as="div"><LocalizedElement as="span">Unresolved row amounts · excluded from budget</LocalizedElement><LocalizedElement as="strong">{formatCurrency(lineSums.pending)}</LocalizedElement></LocalizedElement>}
          <LocalizedElement as="div"><LocalizedElement as="span">BOQ budget subtotal · including provisional</LocalizedElement><LocalizedElement as="strong">{formatCurrency(budget.subtotal)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Budget overhead ({overheadPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(budget.overhead)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Budget profit ({profitPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(budget.profit)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Budget discount ({discountPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(-budget.discount)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Budget VAT ({vatPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(budget.vat)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div" className="boq-grand-total"><LocalizedElement as="span">BOQ budget total · including provisional</LocalizedElement><LocalizedElement as="strong">{formatCurrency(budget.total)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="p">Budget includes unreviewed costs. Project scope completeness remains unconfirmed.</LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Verified / reviewed subtotal · tender basis</LocalizedElement><LocalizedElement as="strong">{formatCurrency(subtotal)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Overhead ({overheadPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(overhead)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Profit ({profitPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(profit)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">Discount ({discountPercentage}%)</LocalizedElement><LocalizedElement as="strong">{discount > 0 ? `-${formatCurrency(discount)}` : formatCurrency(0)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div"><LocalizedElement as="span">VAT ({vatPercentage}%)</LocalizedElement><LocalizedElement as="strong">{formatCurrency(vat)}</LocalizedElement></LocalizedElement>
          <LocalizedElement as="div" className="boq-grand-total"><LocalizedElement as="span">Reviewed tender total</LocalizedElement><LocalizedElement as="strong">{formatCurrency(total)}</LocalizedElement></LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>


      {reviewEditor && (
        <LocalizedElement as="div" className="boq-modal-backdrop" onMouseDown={() => setReviewEditor(null)}>
          <LocalizedElement as="div" className="boq-modal" role="dialog" aria-modal="true" aria-label="Review BOQ line" onMouseDown={(event) => event.stopPropagation()}>
            <LocalizedElement as="div" className="boq-modal-header"><LocalizedElement as="h3">Review BOQ line</LocalizedElement><LocalizedElement as="button" type="button" onClick={() => setReviewEditor(null)}><X size={18} /></LocalizedElement></LocalizedElement>
            <LocalizedElement as="p"><OriginalText>{tr(items.find((entry) => entry.id === reviewEditor.id)?.description)}</OriginalText></LocalizedElement>
            <LocalizedElement as="p">Confirm against this project’s drawing and rate source. Reviewing a line does not establish that the whole project scope is complete.</LocalizedElement>
            {[['scope', 'Scope and material/specification match the drawing'], ['quantity', 'Quantity and unit are checked, including schedule conflicts'], ['rate', 'Rate applies to this specification, unit and project']].map(([key, label]) => (
              <LocalizedElement as="label" key={key} style={{display: 'block', marginBottom: 12}}><LocalizedElement as="input" type="checkbox" checked={reviewEditor[key]} onChange={(event) => setReviewEditor((current) => ({...current, [key]: event.target.checked}))} /> {label}</LocalizedElement>
            ))}
            <LocalizedElement as="label">Drawing/schedule and rate reference<LocalizedElement as="input" className="boq-library-search" value={reviewEditor.reference} placeholder="Sheet, detail/schedule, supplier quotation or approved budget rate" onChange={(event) => setReviewEditor((current) => ({...current, reference: event.target.value}))} /></LocalizedElement>
            <LocalizedElement as="div" className="boq-modal-actions"><LocalizedElement as="button" type="button" className="boq-secondary" onClick={() => setReviewEditor(null)}>Cancel</LocalizedElement><LocalizedElement as="button" type="button" disabled={!reviewEditor.scope || !reviewEditor.quantity || !reviewEditor.rate || !reviewEditor.reference.trim()} onClick={saveReview}>Confirm reviewed line</LocalizedElement></LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      )}

      {measurementInfo && (
        <LocalizedElement as="div" className="boq-modal-backdrop" role="presentation" onMouseDown={() => setMeasurementInfo(null)}>
          <LocalizedElement as="div" className="boq-modal boq-measurement-modal" role="dialog" aria-modal="true" aria-label="Measurement source" onMouseDown={(event) => event.stopPropagation()}>
            <LocalizedElement as="div" className="boq-modal-header">
              <LocalizedElement as="div"><LocalizedElement as="span">QUANTITY SOURCE</LocalizedElement><LocalizedElement as="h3">Measured quantity details</LocalizedElement></LocalizedElement>
              <LocalizedElement as="button" type="button" onClick={() => setMeasurementInfo(null)}><X size={18}/></LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="dl" className="boq-measurement-details">
              <LocalizedElement as="div"><LocalizedElement as="dt">Item</LocalizedElement><LocalizedElement as="dd"><OriginalText>{tr(measurementInfo.description)}</OriginalText></LocalizedElement></LocalizedElement>
              <LocalizedElement as="div"><LocalizedElement as="dt">Quantity</LocalizedElement><LocalizedElement as="dd">{measurementInfo.quantity} {measurementInfo.unit}</LocalizedElement></LocalizedElement>
              <LocalizedElement as="div"><LocalizedElement as="dt">Source</LocalizedElement><LocalizedElement as="dd">{measurementInfo.source || "Drawing geometry"}</LocalizedElement></LocalizedElement>
              <LocalizedElement as="div"><LocalizedElement as="dt">Basis</LocalizedElement><LocalizedElement as="dd">{measurementInfo.quantityBasis || "Detected from the latest Quantity Takeoff"}</LocalizedElement></LocalizedElement>
              <LocalizedElement as="div"><LocalizedElement as="dt">Confidence</LocalizedElement><LocalizedElement as="dd">{measurementInfo.confidence > 0 ? `${Math.round(measurementInfo.confidence)}%` : "Not provided"}</LocalizedElement></LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="div" className="boq-modal-actions">
              <LocalizedElement as="button" type="button" className="boq-secondary" onClick={() => setMeasurementInfo(null)}>Close</LocalizedElement>
              <LocalizedElement as="button" type="button" onClick={() => { toggleQuantityLock(measurementInfo.id); setMeasurementInfo(null); }}>Unlock for editing</LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      )}

      {descriptionEditor && (
        <LocalizedElement as="div" className="boq-modal-backdrop" role="presentation" onMouseDown={() => setDescriptionEditor(null)}>
          <LocalizedElement as="div" className="boq-modal" role="dialog" aria-modal="true" aria-label="Edit BOQ description" onMouseDown={(event) => event.stopPropagation()}>
            <LocalizedElement as="div" className="boq-modal-header"><LocalizedElement as="div"><LocalizedElement as="span">BOQ ITEM</LocalizedElement><LocalizedElement as="h3">Edit description</LocalizedElement></LocalizedElement><LocalizedElement as="button" type="button" onClick={() => setDescriptionEditor(null)}><X size={18}/></LocalizedElement></LocalizedElement>
            <LocalizedElement as="textarea" autoFocus value={descriptionEditor.value} onChange={(event) => setDescriptionEditor((current) => ({ ...current, value: event.target.value }))} />
            <LocalizedElement as="div" className="boq-modal-actions"><LocalizedElement as="button" type="button" className="boq-secondary" onClick={() => setDescriptionEditor(null)}>Cancel</LocalizedElement><LocalizedElement as="button" type="button" onClick={saveDescriptionEditor}>Save description</LocalizedElement></LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      )}

      {priceLibraryItemId && (
        <LocalizedElement as="div" className="boq-modal-backdrop" role="presentation" onMouseDown={() => setPriceLibraryItemId(null)}>
          <LocalizedElement as="div" className="boq-modal boq-price-modal" role="dialog" aria-modal="true" aria-label="UAE Price Library" onMouseDown={(event) => event.stopPropagation()}>
            <LocalizedElement as="div" className="boq-modal-header"><LocalizedElement as="div"><LocalizedElement as="span">UAE 2026</LocalizedElement><LocalizedElement as="h3">Ventra Price Library</LocalizedElement></LocalizedElement><LocalizedElement as="button" type="button" onClick={() => setPriceLibraryItemId(null)}><X size={18}/></LocalizedElement></LocalizedElement>
            <LocalizedElement as="input" className="boq-library-search" autoFocus placeholder="Search item, section or unit..." value={priceSearch} onChange={(event) => setPriceSearch(event.target.value)} />
            {takeoff?.pdf_analysis&&<>
              <LocalizedElement as="button" type="button" className="boq-secondary" disabled={applyingProjectRates||generating||loadingTakeoff||!!drawingWorkflow.active||drawingWorkflow.analysisFailed} onClick={()=>projectRateInputRef.current?.click()}>{applyingProjectRates?'Applying CSV…':'Apply project rate CSV to this BOQ'}</LocalizedElement>
              <input ref={projectRateInputRef} type="file" accept=".csv,text/csv" hidden onChange={importProjectRateCsv} />
              <LocalizedElement as="p" className="boq-library-note">CSV columns: code, description_en, unit, rate_aed. Applies matching rates to this BOQ only. Unmatched rows stay unchanged. No AI analysis is used.</LocalizedElement>
              {projectRateImport&&<>
                <LocalizedElement as="p" className="boq-library-note">Project CSV: {projectRateImport.fileName}; {projectRateImport.appliedRows} rates applied. Not applied: {projectRateImport.unboundCodes?.join(', ')||'none'}. Other priced rows retained: {projectRateImport.otherPricedRowsRetained}.</LocalizedElement>
                {!!projectRateImport.warnings?.length&&<LocalizedElement as="p" className="boq-library-note">{projectRateImport.warnings.join(' ')}</LocalizedElement>}
                <LocalizedElement as="button" type="button" className="boq-secondary" disabled={applyingProjectRates||generating||loadingTakeoff||!!drawingWorkflow.active} onClick={restoreBeforeProjectRates}>Restore BOQ before latest CSV</LocalizedElement>
                <LocalizedElement as="p" className="boq-library-note">Restore replaces current rows, including later edits, with the saved rows before the latest import.</LocalizedElement>
              </>}
            </>}
            <LocalizedElement as="div" className="boq-library-list">
              {priceLibraryEntries.filter((entry) => (!takeoff?.pdf_analysis||boqUnitFactor(items.find(item=>item.id===priceLibraryItemId)?.unit,entry.unit)!==null)&&`${entry.itemCode||''} ${entry.section} ${entry.description} ${entry.unit} ${tr(entry.section)} ${tr(entry.description)}`.toLowerCase().includes(priceSearch.toLowerCase())).slice(0,100).map((entry) => (
                <LocalizedElement as="button" type="button" key={entry.id} disabled={!!takeoff?.pdf_analysis&&entry.rateMissing} onClick={() => applyLibraryRate(entry)}>
                  <LocalizedElement as="span"><LocalizedElement as="strong"><OriginalText>{tr(entry.description)}</OriginalText></LocalizedElement><LocalizedElement as="small">{tr(entry.section)} · {tr(entry.unit)}</LocalizedElement></LocalizedElement>
                  <LocalizedElement as="b">{entry.rateMissing?tr('Rate pending'):formatCurrency(entry.rate)}</LocalizedElement>
                </LocalizedElement>
              ))}
            </LocalizedElement>
            <LocalizedElement as="p" className="boq-library-note">{takeoff?.pdf_analysis&&priceLibraryEntries.length===0?(errorMessage||'Loading existing price catalog…'):'Budget rates are editable and should be verified against supplier quotations before tender submission.'}</LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      )}
    </LocalizedElement>
  );
}
