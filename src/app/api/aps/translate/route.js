import {commercialContext,commercialError} from "@/lib/serverCommercial";
import { NextResponse } from "next/server";
import { translateApsModel } from "@/services/apsService";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    await commercialContext(request,body.projectId);
    const result = await translateApsModel({
      urn: body?.urn,
      rootFilename: body?.rootFilename || "",
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if(error.status)return commercialError(error);
    console.error("[APS Translate]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "APS translation failed." },
      { status: Number(error?.status) || 500 }
    );
  }
}
