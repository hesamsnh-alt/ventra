import {account} from "@/lib/serverBilling";
import {commercialError} from "@/lib/serverCommercial";
import { NextResponse } from "next/server";
import { getApsViewerToken } from "@/services/apsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await account(request);
    const token = await getApsViewerToken();

    return NextResponse.json(
      {
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
    console.error("[APS Viewer Token]", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create APS viewer token.",
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
