import {account} from "@/lib/serverBilling";
import {commercialError} from "@/lib/serverCommercial";
import { NextResponse } from "next/server";
import { getApsViewerToken } from "@/services/apsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

export async function GET(request, context) {
  const params = await context.params;
  const action = String(params?.action || "").toLowerCase();

  if (action !== "token" && action !== "viewer-token") {
    return NextResponse.json(
      {
        success: false,
        error: "APS route not found.",
      },
      {
        status: 404,
        headers: noStoreHeaders(),
      }
    );
  }

  try {
    await account(request);
    const token = await getApsViewerToken();

    console.log("[APS Token Fallback] served", {
      action,
    });

    if (action === "viewer-token") {
      return NextResponse.json(
        {
          access_token: token.accessToken,
          expires_in: token.expiresIn,
          token_type: token.tokenType || "Bearer",
        },
        {
          headers: noStoreHeaders(),
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        connected: true,
        access_token: token.accessToken,
        expires_in: token.expiresIn,
        token_type: token.tokenType || "Bearer",
      },
      {
        headers: noStoreHeaders(),
      }
    );
  } catch (error) {
    if(error.status)return commercialError(error);
    console.error("[APS Token Fallback]", error);

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
        headers: noStoreHeaders(),
      }
    );
  }
}
