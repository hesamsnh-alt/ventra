import {apsModelAccess} from "@/lib/serverApsAccess";
import {commercialError} from "@/lib/serverCommercial";
import {selectApsMetadataViews} from "@/lib/apsMetadataViews.mjs";
import { NextResponse } from "next/server";
import { getApsAccessToken } from "@/services/apsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APS_BASE = "https://developer.api.autodesk.com";

function cleanCadText(value) {
  return String(value ?? "")
    .replace(/\\P/gi, " ")
    .replace(/\{\\[^;{}]+;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyRoomText(value) {
  const rawLabel = cleanCadText(value);
  const text = rawLabel.toUpperCase();
  if (!text || text.length > 100) return null;

  const rules = [
    [/\bMASTER\s+BED(?:\s*ROOM)?\b/, "master_bedroom", "Master Bedroom"],
    [/\bBED(?:\s*ROOM)?(?:\s*\d+)?\b/, "bedroom", "Bedroom"],
    [/\bLIVING(?:\s+RM|\s+ROOM)?\b/, "living_room", "Living Room"],
    [/\bFAMILY\s+ROOM\b/, "family_room", "Family Room"],
    [/\bDINING(?:\s+RM|\s+ROOM)?\b|\bDINNING(?:\s+RM|\s+ROOM)?\b/, "dining_room", "Dining Room"],
    [/\bKITCHEN\b|\bKIT\.?\b/, "kitchen", "Kitchen"],
    [/\bPANTRY\b/, "pantry", "Pantry"],
    [/\bLAUNDRY\b|\bL['’]?DRY\b/, "laundry", "Laundry"],
    [/\bBATH(?:\s*ROOM)?\b/, "bathroom", "Bathroom"],
    [/\bTOILET\b|\bW\.?C\.?\b/, "toilet", "Toilet"],
    [/\bPOWDER(?:\s+ROOM)?\b/, "powder_room", "Powder Room"],
    [/\bCORRIDOR\b/, "corridor", "Corridor"],
    [/\bFOYER\b/, "foyer", "Foyer"],
    [/\bHALL\b/, "hall", "Hall"],
    [/\bSTUDY\b/, "study", "Study"],
    [/\bOFFICE\b/, "office", "Office"],
    [/\bWALK[\s-]*IN\s+CLOSET\b/, "walk_in_closet", "Walk-in Closet"],
    [/\bCLOSET\b/, "closet", "Closet"],
    [/\bSTORE\b|\bSTORAGE\b/, "store", "Store"],
    [/\bBALCONY\b/, "balcony", "Balcony"],
    [/\bTERRACE\b/, "terrace", "Terrace"],
    [/\bGARAGE\b/, "garage", "Garage"],
  ];

  for (const [pattern, roomType, label] of rules) {
    if (pattern.test(text)) {
      return { roomType, label, rawLabel };
    }
  }
  return null;
}

function flattenStrings(value, output = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      // Property names can themselves carry text in DWG derivatives.
      output.push(String(key));
      flattenStrings(item, output, depth + 1);
    }
  }
  return output;
}

async function apsJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`APS ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export async function POST(request) {
  try {
    const {
      urn,
      viewGuid = null, viewName = null, viewRole = null,
    } = await request.json();

    if (!urn) {
      return NextResponse.json({
        candidates: [],
      });
    }

    const model=await apsModelAccess(request,urn);
    const { accessToken } = await getApsAccessToken([`data:read:${model.resource}`]);
    const encodedUrn = encodeURIComponent(urn);
    const metadataResult = await apsJson(
      `${APS_BASE}/modelderivative/v2/designdata/${encodedUrn}/metadata`,
      accessToken
    );
    const metadata = Array.isArray(metadataResult?.data?.metadata)
      ? metadataResult.data.metadata
      : [];

    const selection=selectApsMetadataViews(metadata,{viewGuid,viewName,viewRole});
    const ordered=selection.views;
    if(!selection.safe)return NextResponse.json({candidates:[],needsViewSelection:true,warning:'Select a specific engineering view; metadata cannot safely be matched between sheets.'});

    const candidates = [];
    const seen = new Set();

    for (const view of ordered) {
      if (!view?.guid) continue;
      let propertiesResult;
      try {
        propertiesResult = await apsJson(
          `${APS_BASE}/modelderivative/v2/designdata/${encodedUrn}/metadata/${encodeURIComponent(view.guid)}/properties?forceget=true`,
          accessToken
        );
      } catch (error) {
        console.warn("[VENTRA ROOM META API] properties view failed", {
          guid: view.guid,
          message: error?.message,
        });
        continue;
      }

      const collection = Array.isArray(propertiesResult?.data?.collection)
        ? propertiesResult.data.collection
        : [];

      for (const object of collection) {
        const objectName =
          String(
            object?.name ||
            ""
          ).trim();

        const objectLooksLikeComponentName =
          /\s-\s*Plan\b/i.test(
            objectName
          ) ||
          /\[[0-9A-F]+\]/i.test(
            objectName
          );

        const values = [
          ...(objectLooksLikeComponentName
            ? []
            : [objectName]),
          ...flattenStrings(
            object?.properties
          ),
        ];

        const dbId =
          object?.objectid;

        if (dbId == null) {
          continue;
        }

        const classifications =
          [];

        const localSeen =
          new Set();

        for (
          const value of values
        ) {
          const classification =
            classifyRoomText(
              value
            );

          if (
            !classification
          ) {
            continue;
          }

          const typeKey =
            classification
              .roomType;

          if (
            localSeen.has(
              typeKey
            )
          ) {
            continue;
          }

          localSeen.add(
            typeKey
          );

          classifications.push(
            classification
          );
        }

        // A real text entity should not simultaneously claim to be multiple
        // different rooms. Multiple matches usually mean a parent/block object
        // whose nested properties describe several child elements.
        if (
          classifications.length !==
          1
        ) {
          continue;
        }

        const classification =
          classifications[0];

        const key =
          `${view.guid}:${dbId}:${classification.roomType}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        candidates.push({
          dbId,
          guid: view.guid,
          viewName:
            view.name || null,
          ...classification,
          source:
            "aps_model_derivative_properties",
        });
      }
    }

    console.log("[VENTRA ROOM META API] candidates", {
      views: ordered.length,
      count: candidates.length,
      labels: candidates.map((item) => item.label),
    });

    return NextResponse.json({ candidates, metadataMatch:selection.match });
  } catch (error) {
    if(error.status)return commercialError(error);
    console.error("[VENTRA ROOM META API] failed", error);
    return NextResponse.json({ candidates: [], error: error?.message || "Metadata lookup failed" });
  }
}
