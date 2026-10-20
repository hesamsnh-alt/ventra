import {reportDrawingProgress} from '@/services/drawingJobRuntime.mjs';
import {commercialRun} from './serverCommercial';
import {completeDrawingResult} from './drawingJobIdentity.mjs';
import { NextResponse } from "next/server";
import { analyzeDrawing } from "@/services/takeoffServerService";


async function handleCommercialRequest(request) {
  const startedAt = Date.now();

  try {
    const body = await request.json();
    const fileUrl = String(body?.fileUrl || "");
    const fileName = String(body?.fileName || "");
    const fileType = String(body?.fileType || "application/octet-stream");

    if (!fileUrl) {
      return NextResponse.json({ success: false, error: "fileUrl is required." }, { status: 400 });
    }
    if (!fileName) {
      return NextResponse.json({ success: false, error: "fileName is required." }, { status: 400 });
    }

    console.log("[Drawing Analysis] Started", {
      fileName,
      fileType,
      resumeSourceMeasurementsOnly: body?.resumeSourceMeasurementsOnly === true,
      localPdfRecoveryOnly: body?.localPdfRecoveryOnly === true,
      mode: fileType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf")
        ? "large-pdf"
        : "single-drawing",
    });

    await reportDrawingProgress({stage:'analyzing'});
    const result = await analyzeDrawing({
      fileUrl,
      fileName,
      fileType,
      pageNumber: body?.pageNumber ?? null,
      projectName: String(body?.projectName || ""),
      discipline: String(body?.discipline || ""),
      resumeSourceMeasurementsOnly: body?.resumeSourceMeasurementsOnly === true,
      localPdfRecoveryOnly: body?.localPdfRecoveryOnly === true,
      noAutomaticRetries: body?.noAutomaticRetries === true,
    });

    if(!completeDrawingResult(result)){
      const total=Number(result.total_pages||result.pdf_analysis?.total_pages||0);
      const analyzed=Array.isArray(result.page_results)?new Set(result.page_results.map(p=>p.pageNumber)).size:Number(result.analyzed_pages||0);
      const review=result.pdf_analysis?.document_review_status;
      const sourceReview=result.pdf_analysis?.source_measurement_status;
      const failures=result.failed_pages||result.pdf_analysis?.failed_pages||[];
      const sourceReason=['failed','pending','partial'].includes(sourceReview?.status)?`Source detail review ${sourceReview.status}: ${(sourceReview.parts||[]).filter(p=>p.status!=='completed').map(p=>`${p.id}: ${p.reason||p.status}`).join('; ')}. ${sourceReview.reason||''}`:'';
      const reason=String(review?.reason||sourceReason||failures.map(p=>p.error||p.reason||'Page extraction failed').join('; ')||'Source review did not complete.').slice(0,700);
      return NextResponse.json({success:false,error:`PDF analysis is incomplete (${analyzed}/${total||'?'} pages; review: ${review?.status||'unavailable'}). ${reason} Previous BOQ was not replaced. Saved evidence retained for review.`,code:'DRAWING_JOB_INCOMPLETE',partialResult:result},{status:409});
    }
    await reportDrawingProgress({stage:'finalizing'});
    return NextResponse.json({
      success: true,
      result,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[Drawing Analysis] Failed", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Drawing analysis failed.",
        durationMs: Date.now() - startedAt,
      },
      { status: Number(error?.status) || 500 }
    );
  }
}

export async function runDrawingRequest(request){return commercialRun(request,'drawing',handleCommercialRequest);}
