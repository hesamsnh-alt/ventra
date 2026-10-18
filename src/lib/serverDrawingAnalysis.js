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

    if(!completeDrawingResult(result))return NextResponse.json({success:false,error:'PDF analysis is incomplete; previous BOQ was not replaced. Saved evidence retained for review.',code:'DRAWING_JOB_INCOMPLETE',partialResult:result},{status:409});
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
