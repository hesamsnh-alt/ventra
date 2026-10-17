import {commercialRun} from '@/lib/serverCommercial';
import { NextResponse } from "next/server";
import { analyzeDrawing } from "@/services/takeoffServerService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Ventra drawing analysis API is running.",
  });
}

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
    });

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

export async function POST(request){return commercialRun(request,'drawing',handleCommercialRequest);}
