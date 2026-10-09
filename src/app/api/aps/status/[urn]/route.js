import {account} from "@/lib/serverBilling";
import {commercialError} from "@/lib/serverCommercial";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(message, status, details = null) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

async function readJsonSafely(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text.slice(0, 2000),
    };
  }
}

async function getApsAccessToken(request) {
  const tokenUrl =
    new URL(
      "/api/aps/token",
      request.url
    );

  const response =
    await fetch(
      tokenUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: request.headers.get("authorization") || "",
        },
        cache: "no-store",
      }
    );

  const payload =
    await readJsonSafely(
      response
    );

  const accessToken =
    payload?.access_token ||
    payload?.accessToken ||
    payload?.token ||
    null;

  if (
    !response.ok ||
    !accessToken
  ) {
    const message =
      payload?.error ||
      payload?.message ||
      `APS token request failed. HTTP ${response.status}`;

    throw new Error(message);
  }

  return accessToken;
}

export async function GET(
  request,
  context
) {
  try {
    await account(request);
    const params =
      await context.params;

    const rawUrn =
      params?.urn;

    if (!rawUrn) {
      return jsonError(
        "APS URN is required.",
        400
      );
    }

    let urn;

    try {
      urn =
        decodeURIComponent(
          String(rawUrn)
        ).trim();
    } catch {
      urn =
        String(
          rawUrn
        ).trim();
    }

    if (!urn) {
      return jsonError(
        "APS URN is empty.",
        400
      );
    }

    const accessToken =
      await getApsAccessToken(
        request
      );

    const manifestUrl =
      `https://developer.api.autodesk.com/modelderivative/v2/designdata/${encodeURIComponent(
        urn
      )}/manifest`;

    const apsResponse =
      await fetch(
        manifestUrl,
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
            Accept:
              "application/json",
          },
          cache: "no-store",
        }
      );

    const manifest =
      await readJsonSafely(
        apsResponse
      );

    if (!apsResponse.ok) {
      const apsMessage =
        manifest?.developerMessage ||
        manifest?.diagnostic ||
        manifest?.message ||
        manifest?.error ||
        `Autodesk manifest request failed. HTTP ${apsResponse.status}`;

      console.error(
        "[APS Status Route] Autodesk error",
        {
          urn,
          status:
            apsResponse.status,
          payload:
            manifest,
        }
      );

      return jsonError(
        apsMessage,
        apsResponse.status,
        manifest
      );
    }

    console.log(
      "[APS Status Route] manifest",
      {
        urn,
        status:
          manifest?.status,
        progress:
          manifest?.progress,
      }
    );

    return NextResponse.json(
      {
        success: true,
        manifest,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    if(error.status)return commercialError(error);
    console.error(
      "[APS Status Route]",
      error
    );

    return jsonError(
      error?.message ||
        "Could not read Autodesk translation status.",
      500
    );
  }
}
