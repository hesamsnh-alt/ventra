import {apsModelAccess} from "@/lib/serverApsAccess";
import {commercialError} from "@/lib/serverCommercial";
import { NextResponse } from "next/server";
import { getApsViewerToken } from "@/services/apsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const model = await apsModelAccess(request,new URL(request.url).searchParams.get('urn'));
    const token = await getApsViewerToken(model.resource);

    return NextResponse.json(
      {
        success: true,
        connected: true,
        access_token: token.accessToken,
        expires_in: token.expiresIn,
        token_type: token.tokenType || "Bearer",
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    if(error.status)return commercialError(error);
    console.error("[APS Token]", error);

    return NextResponse.json(
      {
        success: false,
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Autodesk APS connection failed.",
      },
      {
        status: Number(error?.status) || 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
