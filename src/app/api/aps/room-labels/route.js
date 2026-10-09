import {commercialRun} from '@/lib/serverCommercial';
import { NextResponse } from "next/server";
import { getOpenAIClient } from "@/services/openaiClient";
import { getApsAccessToken } from "@/services/apsService";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const APS_BASE =
  "https://developer.api.autodesk.com";

const analysisCache = new Map();
const inFlight = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const ANALYZER_VERSION = "ventra49-room-audit-fast-authority-v1-room-bbox-v1";

const ROOM_TYPES = [
  "Room",
  "Living Room",
  "Family Room",
  "Lounge",
  "Dining Room",
  "Kitchen",
  "Pantry",
  "Laundry",
  "Bedroom",
  "Master Bedroom",
  "Bathroom",
  "Toilet",
  "Powder Room",
  "Hall",
  "Corridor",
  "Foyer",
  "Office",
  "Study",
  "Closet",
  "Walk-in Closet",
  "Store",
  "Balcony",
  "Terrace",
  "Garage",
];

function clamp01(value) {
  return Math.max(
    0,
    Math.min(1, Number(value) || 0)
  );
}

function cleanCadText(value) {
  return String(value ?? "")
    .replace(/\\P/gi, " ")
    .replace(/\{\\[^;{}]+;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeArchitecturalRoomLabel(
  label,
  type
) {
  const raw =
    cleanCadText(label);
  const upper =
    raw.toUpperCase();

  const aliases = [
    [/^B\/R$/, "Bathroom", "BATHROOM"],
    [/^BATH\s*RM$/, "Bathroom", "BATHROOM"],
    [/^LIVING$/, "Living Room", "LIVING ROOM"],
    [/^DINNING\s+ROOM$/, "Dining Room", "DINNING ROOM"],
    [/^FOYER$/, "Foyer", "FOYER"],
    [/^FORUM$/, "Foyer", "FOYER"],
    [/^HAL$/, "Hall", "HALL"],
    [/^HALL$/, "Hall", "HALL"],
    [/^M\.?\s*BED(?:ROOM)?$/, "Master Bedroom", "MASTER BEDROOM"],
    [/^MASTER\s+BED$/, "Master Bedroom", "MASTER BEDROOM"],
    [/^W\.?I\.?C\.?$/, "Walk-in Closet", "WALK-IN CLOSET"],
    [/^(?:WALK|K)[\s-]*IN\s+CLOSET$/, "Walk-in Closet", "WALK-IN CLOSET"],
    [/^K-IN\s+CLOSET$/, "Walk-in Closet", "WALK-IN CLOSET"],
    [/^WALK-?\s*CLOSET$/, "Walk-in Closet", "WALK-IN CLOSET"],
    [/^WALK-\s+CLOSET$/, "Walk-in Closet", "WALK-IN CLOSET"],
  ];

  for (const [pattern, normalizedType, normalizedLabel] of aliases) {
    if (pattern.test(upper)) {
      return {
        label: normalizedLabel,
        type: normalizedType,
      };
    }
  }

  return {
    label: raw,
    type:
      ROOM_TYPES.includes(type)
        ? type
        : "Room",
  };
}

function classifyRoomText(value) {
  const rawLabel =
    cleanCadText(value);
  const text =
    rawLabel.toUpperCase();

  if (
    !text ||
    text.length > 80
  ) {
    return null;
  }

  const rules = [
    [
      /^ROOM\s+[A-Z0-9_-]+$/,
      "Room",
    ],
    [
      /\bMASTER\s+BED(?:\s*ROOM)?\b/,
      "Master Bedroom",
    ],
    [
      /\bBED(?:\s*ROOM)?(?:\s*\d+)?\b/,
      "Bedroom",
    ],
    [
      /\bLIVING(?:\s+ROOM|\s+RM)?\b/,
      "Living Room",
    ],
    [
      /\bFAMILY\s+ROOM\b/,
      "Family Room",
    ],
    [
      /\bDINING(?:\s+ROOM|\s+RM)?\b/,
      "Dining Room",
    ],
    [/\bKITCHEN\b/, "Kitchen"],
    [/\bPANTRY\b/, "Pantry"],
    [
      /\bLAUNDRY\b|\bL['’]?DRY\b/,
      "Laundry",
    ],
    [
      /\bBATH(?:\s*ROOM)?\b/,
      "Bathroom",
    ],
    [
      /\bTOILET\b|\bW\.?C\.?\b/,
      "Toilet",
    ],
    [
      /\bPOWDER(?:\s+ROOM)?\b/,
      "Powder Room",
    ],
    [/\bCORRIDOR\b/, "Corridor"],
    [/\bFOYER\b/, "Foyer"],
    [/\bHALL\b/, "Hall"],
    [/\bSTUDY\b/, "Study"],
    [/\bOFFICE\b/, "Office"],
    [
      /\bWALK[\s-]*IN\s+CLOSET\b/,
      "Walk-in Closet",
    ],
    [/\bCLOSET\b/, "Closet"],
    [
      /\bSTORE\b|\bSTORAGE\b/,
      "Store",
    ],
    [/\bBALCONY\b/, "Balcony"],
    [/\bTERRACE\b/, "Terrace"],
    [/\bGARAGE\b/, "Garage"],
  ];

  for (const [pattern, type] of rules) {
    if (pattern.test(text)) {
      return {
        label: rawLabel,
        type,
      };
    }
  }

  return null;
}

function flattenStrings(
  value,
  output = [],
  depth = 0
) {
  if (
    value == null ||
    depth > 7
  ) {
    return output;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    output.push(
      String(value)
    );
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      flattenStrings(
        item,
        output,
        depth + 1
      );
    }
    return output;
  }

  if (
    typeof value === "object"
  ) {
    for (const [key, item] of Object.entries(
      value
    )) {
      output.push(
        String(key)
      );
      flattenStrings(
        item,
        output,
        depth + 1
      );
    }
  }

  return output;
}

async function apsJson(
  url,
  token
) {
  const response = await fetch(
    url,
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
        Accept:
          "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `APS ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

async function getApsTextEvidence(
  urn
) {
  if (!urn) {
    return {
      raw: [],
      trusted: [],
    };
  }

  try {
    const { accessToken } =
      await getApsAccessToken([
        "data:read",
      ]);

    const encodedUrn =
      encodeURIComponent(urn);

    const metadataResult =
      await apsJson(
        `${APS_BASE}/modelderivative/v2/designdata/${encodedUrn}/metadata`,
        accessToken
      );

    const metadata =
      Array.isArray(
        metadataResult?.data
          ?.metadata
      )
        ? metadataResult.data
            .metadata
        : [];

    const views = [
      ...metadata.filter(
        (item) =>
          item?.role === "2d"
      ),
      ...metadata.filter(
        (item) =>
          item?.role !== "2d"
      ),
    ];

    const raw = [];
    const trusted = [];
    const seenTrusted =
      new Set();

    for (const view of views) {
      if (!view?.guid) {
        continue;
      }

      let propertiesResult;

      try {
        propertiesResult =
          await apsJson(
            `${APS_BASE}/modelderivative/v2/designdata/${encodedUrn}/metadata/${encodeURIComponent(
              view.guid
            )}/properties?forceget=true`,
            accessToken
          );
      } catch {
        continue;
      }

      const collection =
        Array.isArray(
          propertiesResult
            ?.data?.collection
        )
          ? propertiesResult
              .data.collection
          : [];

      for (const object of collection) {
        const strings = [
          object?.name,
          ...flattenStrings(
            object?.properties
          ),
        ]
          .filter(Boolean)
          .map(cleanCadText)
          .filter(Boolean);

        for (const value of strings) {
          const classified =
            classifyRoomText(
              value
            );

          if (!classified) {
            continue;
          }

          raw.push({
            guid:
              view.guid,
            dbId:
              object?.objectid ??
              null,
            viewName:
              view?.name || null,
            rawLabel:
              value,
            type:
              classified.type,
          });

          // Block/family identifiers are not printed room labels.
          if (
            /\s-\s*PLAN\b/i.test(
              value
            ) ||
            /\[[0-9A-F]+\]/i.test(
              value
            ) ||
            /\b(?:BLOCK|FAMILY|TYPE|STYLE|SYMBOL|LAYER)\b/i.test(
              value
            )
          ) {
            continue;
          }

          const strict =
            classifyRoomText(
              value
            );

          if (!strict) {
            continue;
          }

          const key =
            `${strict.type}::${strict.label.toUpperCase()}`;

          if (
            seenTrusted.has(key)
          ) {
            continue;
          }

          seenTrusted.add(key);
          trusted.push({
            label:
              strict.label,
            type:
              strict.type,
            source:
              "aps_model_derivative_text",
          });
        }
      }
    }

    console.log(
      "[VENTRA ANALYZER] APS text evidence",
      {
        views:
          views.length,
        rawCount:
          raw.length,
        trustedCount:
          trusted.length,
        trusted,
      }
    );

    return {
      raw,
      trusted,
    };
  } catch (error) {
    console.warn(
      "[VENTRA ANALYZER] APS metadata unavailable",
      error
    );

    return {
      raw: [],
      trusted: [],
    };
  }
}

async function getApsThumbnail(
  urn
) {
  if (!urn) {
    return null;
  }

  const { accessToken } =
    await getApsAccessToken([
      "viewables:read",
    ]);

  const response = await fetch(
    `${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(
      urn
    )}/thumbnail?width=1000&height=1000`,
    {
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
        Accept:
          "image/png,image/jpeg,image/*",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return null;
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (!buffer.length) {
    return null;
  }

  return {
    buffer,
    mime:
      response.headers.get(
        "content-type"
      ) || "image/png",
    source:
      "aps_thumbnail_fallback",
  };
}

function parseDataImage(
  dataUrl
) {
  if (
    typeof dataUrl !==
      "string" ||
    !dataUrl.startsWith(
      "data:image/"
    )
  ) {
    return null;
  }

  const match =
    dataUrl.match(
      /^data:(image\/[^;]+);base64,(.+)$/s
    );

  if (!match) {
    return null;
  }

  try {
    const buffer =
      Buffer.from(
        match[2],
        "base64"
      );

    if (!buffer.length) {
      return null;
    }

    return {
      buffer,
      mime:
        match[1],
      source:
        "autodesk_viewer_high_res",
    };
  } catch {
    return null;
  }
}

function toDataUrl(
  buffer,
  mime = "image/png"
) {
  return `data:${mime};base64,${buffer.toString(
    "base64"
  )}`;
}

function normalizeBox(box) {
  const x =
    clamp01(box?.x);
  const y =
    clamp01(box?.y);
  const width =
    Math.max(
      0.03,
      Math.min(
        1 - x,
        Number(box?.width) ||
          0
      )
    );
  const height =
    Math.max(
      0.03,
      Math.min(
        1 - y,
        Number(box?.height) ||
          0
      )
    );

  return {
    x,
    y,
    width,
    height,
  };
}

async function cropRegion(
  sourceBuffer,
  sourceMeta,
  bbox,
  name
) {
  const normalized =
    normalizeBox(bbox);

  const cropName =
    String(name || "");

  const isPlanCrop =
    cropName.startsWith(
      "plan-"
    );

  const isScheduleCrop =
    /-schedule$/i.test(
      cropName
    );

  /*
   * Layout detection can place a schedule bbox tightly around the visible
   * table and clip the final data row. A tiny symmetric crop margin is fine
   * for plans, but schedules need extra vertical context, especially below
   * the detected box. Keep horizontal padding conservative so adjacent door
   * and window schedules do not bleed into each other.
   */
  const paddingX =
    normalized.width *
    (isPlanCrop
      ? 0.004
      : isScheduleCrop
        ? 0.012
        : 0.018);

  const paddingTop =
    normalized.height *
    (isPlanCrop
      ? 0.004
      : isScheduleCrop
        ? 0.025
        : 0.018);

  const paddingBottom =
    normalized.height *
    (isPlanCrop
      ? 0.004
      : isScheduleCrop
        ? 0.22
        : 0.018);

  const x =
    Math.max(
      0,
      normalized.x -
        paddingX
    );
  const y =
    Math.max(
      0,
      normalized.y -
        paddingTop
    );
  const width =
    Math.min(
      1 - x,
      normalized.width +
        paddingX * 2
    );
  const height =
    Math.min(
      1 - y,
      normalized.height +
        paddingTop +
        paddingBottom
    );

  const left =
    Math.max(
      0,
      Math.round(
        sourceMeta.width * x
      )
    );
  const top =
    Math.max(
      0,
      Math.round(
        sourceMeta.height * y
      )
    );
  const cropWidth =
    Math.max(
      1,
      Math.min(
        sourceMeta.width -
          left,
        Math.round(
          sourceMeta.width *
            width
        )
      )
    );
  const cropHeight =
    Math.max(
      1,
      Math.min(
        sourceMeta.height -
          top,
        Math.round(
          sourceMeta.height *
            height
        )
      )
    );

  const targetWidth =
    String(name || "").includes(
      "schedule"
    )
      ? 4200
      : 3200;

  const buffer =
    await sharp(
      sourceBuffer
    )
      .extract({
        left,
        top,
        width:
          cropWidth,
        height:
          cropHeight,
      })
      .resize({
        width: targetWidth,
        withoutEnlargement:
          false,
        fit: "inside",
      })
      .normalize()
      .sharpen({
        sigma: 0.9,
      })
      .png()
      .toBuffer();

  return {
    name,
    bbox: {
      x,
      y,
      width,
      height,
    },
    dataUrl:
      toDataUrl(
        buffer,
        "image/png"
      ),
    bytes:
      buffer.length,
  };
}

async function callStructured(
  openai,
  {
    name,
    schema,
    prompt,
    imageUrl,
  }
) {
  const response =
    await openai.responses.create({
      model:
        process.env
          .OPENAI_DRAWING_MODEL ||
        "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type:
                "input_text",
              text:
                prompt,
            },
            {
              type:
                "input_image",
              image_url:
                imageUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type:
            "json_schema",
          name,
          strict: true,
          schema,
        },
      },
    });

  return JSON.parse(
    response.output_text ||
      "{}"
  );
}

const boxSchema = {
  type: "object",
  additionalProperties:
    false,
  properties: {
    x: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    y: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    width: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    height: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
  },
  required: [
    "x",
    "y",
    "width",
    "height",
  ],
};

async function understandSheet(
  openai,
  imageUrl,
  trustedApsEvidence
) {
  const apsHints =
    trustedApsEvidence.length
      ? trustedApsEvidence
          .map(
            (item) =>
              `${item.label} (${item.type})`
          )
          .join(", ")
      : "none";

  const schema = {
    type: "object",
    additionalProperties:
      false,
    properties: {
      plans: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties:
            false,
          properties: {
            id: {
              type: "string",
            },
            title: {
              type: "string",
            },
            bbox: boxSchema,
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "id",
            "title",
            "bbox",
            "confidence",
          ],
        },
      },
      doorSchedules: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties:
            false,
          properties: {
            bbox: boxSchema,
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "bbox",
            "confidence",
          ],
        },
      },
      windowSchedules: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties:
            false,
          properties: {
            bbox: boxSchema,
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "bbox",
            "confidence",
          ],
        },
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: [
      "plans",
      "doorSchedules",
      "windowSchedules",
      "confidence",
    ],
  };

  const prompt = `
You are the sheet-understanding stage of a construction takeoff system.

Inspect the COMPLETE high-resolution drawing sheet.

Identify bounding boxes ONLY for actual architectural FLOOR PLANS.
Do NOT mark elevations, sections, details, legends, notes, schedules, title blocks,
door/window symbols, furniture details or isolated diagrams as floor plans.

If there are two floor plans on the same sheet, return two separate plan regions.
If there is one floor plan, return one.
A plan region should include the complete exterior walls and all rooms of that plan,
but exclude neighboring plans/schedules as much as possible.

Also locate explicit DOOR SCHEDULE and WINDOW SCHEDULE table regions if present.

Autodesk APS exact printed-text hints (corroborating evidence only):
${apsHints}

Do not invent a plan or schedule just because an APS component/family name contains
a room/door/window word.

Coordinates are normalized to the whole image, top-left origin.
`.trim();

  return callStructured(
    openai,
    {
      name:
        "ventra_sheet_layout",
      schema,
      prompt,
      imageUrl,
    }
  );
}


async function detectMinimalCadWindowMarkers(
  sourceBuffer,
  sourceMeta,
  plans
) {
  const candidates = [];

  for (
    let index = 0;
    index < (Array.isArray(plans) ? plans.length : 0);
    index += 1
  ) {
    const plan = plans[index];
    const box = normalizeBox(plan?.bbox);

    const left = Math.max(
      0,
      Math.floor(box.x * sourceMeta.width)
    );
    const top = Math.max(
      0,
      Math.floor(box.y * sourceMeta.height)
    );
    const right = Math.min(
      sourceMeta.width,
      Math.ceil((box.x + box.width) * sourceMeta.width)
    );
    const bottom = Math.min(
      sourceMeta.height,
      Math.ceil((box.y + box.height) * sourceMeta.height)
    );

    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    const { data, info } =
      await sharp(sourceBuffer)
        .extract({
          left,
          top,
          width,
          height,
        })
        .resize({
          width: 1600,
          withoutEnlargement: false,
          fit: "inside",
        })
        .removeAlpha()
        .raw()
        .toBuffer({
          resolveWithObject: true,
        });

    const pixelCount =
      info.width * info.height;
    const mask =
      new Uint8Array(pixelCount);

    for (
      let pixel = 0;
      pixel < pixelCount;
      pixel += 1
    ) {
      const offset =
        pixel * info.channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];

      // Minimal CAD window layers are commonly rendered cyan/blue. Require
      // strong blue/cyan chroma so black walls, yellow labels and green doors
      // are excluded.
      const blueCyan =
        b >= 95 &&
        g >= 55 &&
        b - r >= 45 &&
        g - r >= 20 &&
        b >= g * 0.9;

      if (blueCyan) {
        mask[pixel] = 1;
      }
    }

    const visited =
      new Uint8Array(pixelCount);
    const components = [];
    const directions = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1],
    ];

    for (
      let seed = 0;
      seed < pixelCount;
      seed += 1
    ) {
      if (!mask[seed] || visited[seed]) {
        continue;
      }

      const queue = [seed];
      visited[seed] = 1;
      let head = 0;
      let count = 0;
      let minX = info.width;
      let minY = info.height;
      let maxX = 0;
      let maxY = 0;

      while (head < queue.length) {
        const current = queue[head++];
        const x = current % info.width;
        const y = Math.floor(current / info.width);
        count += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;

          if (
            nx < 0 || ny < 0 ||
            nx >= info.width || ny >= info.height
          ) {
            continue;
          }

          const next =
            ny * info.width + nx;

          if (
            mask[next] &&
            !visited[next]
          ) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }

      const componentWidth =
        maxX - minX + 1;
      const componentHeight =
        maxY - minY + 1;
      const longSide =
        Math.max(componentWidth, componentHeight);
      const shortSide =
        Math.max(1, Math.min(componentWidth, componentHeight));
      const aspect =
        longSide / shortSide;

      // Architectural minimalist window markers are short, thin, elongated
      // strokes. Ignore isolated pixels, text fragments, large filled regions
      // and nearly square symbols.
      if (
        count >= 18 &&
        longSide >= 18 &&
        shortSide <= 28 &&
        aspect >= 2.4
      ) {
        components.push({
          planId: String(plan?.id || `plan-${index + 1}`),
          pixelCount: count,
          bbox: {
            x: minX / info.width,
            y: minY / info.height,
            width: componentWidth / info.width,
            height: componentHeight / info.height,
          },
          aspect,
        });
      }
    }

    candidates.push(...components);
  }

  console.log(
    "[VENTRA ANALYZER] minimal CAD window markers",
    {
      count: candidates.length,
      markers: candidates,
    }
  );

  return {
    count: candidates.length,
    confidence:
      candidates.length > 0
        ? 0.99
        : 0,
    source:
      candidates.length > 0
        ? "autodesk_thumbnail_cad_window_marker"
        : "unavailable",
    markers: candidates,
  };
}

async function analyzePlan(
  openai,
  planCrop,
  planInfo,
  trustedApsEvidence
) {
  const schema = {
    type: "object",
    additionalProperties:
      false,
    properties: {
      rooms: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties:
            false,
          properties: {
            label: {
              type: "string",
            },
            type: {
              type: "string",
              enum:
                ROOM_TYPES,
            },
            x: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            bbox: boxSchema,
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "label",
            "type",
            "x",
            "y",
            "bbox",
            "confidence",
          ],
        },
      },
      doors: {
        type: "integer",
        minimum: 0,
      },
      windows: {
        type: "integer",
        minimum: 0,
      },
      openingConfidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: [
      "rooms",
      "doors",
      "windows",
      "openingConfidence",
      "confidence",
    ],
  };

  const hints =
    trustedApsEvidence.length
      ? trustedApsEvidence
          .map(
            (item) =>
              `${item.label} (${item.type})`
          )
          .join(", ")
      : "none";

  const prompt = `
Analyze ONLY this architectural floor-plan region.
Plan id: ${planInfo.id}
Plan title: ${planInfo.title || "unknown"}

For EVERY room/space you return:
- x/y = center of the printed room label, normalized 0..1 within this plan crop.
- bbox = the visible INTERIOR EXTENT of that room/space, normalized 0..1 within this plan crop.
- bbox must follow the room enclosed by walls as closely as a rectangle can; do not use the text bounding box.
- Do not include adjacent rooms, corridors, schedules, notes or furniture outside the room.
- If the room is irregular, bbox should be the tight rectangle around the room interior.

Autodesk APS exact room-text hints from the source file:
${hints}

ROOMS / SPACES:
- Read every visibly printed architectural room/space label in this plan.
- Return each physical labeled space once, at the center of its printed label.
- Valid examples include BEDROOM, MASTER BEDROOM, LIVING ROOM, KITCHEN,
  BATHROOM, TOILET/WC, DINING, CORRIDOR, FOYER, LAUNDRY, PANTRY,
  OFFICE, STUDY, STORE, BALCONY, TERRACE, GARAGE and generic ROOM A / ROOM B.
- If multiple BEDROOM labels are visibly printed in different physical spaces,
  return multiple bedrooms.
- Do not infer an unlabeled room from furniture or plumbing fixtures.
- Do not read title blocks, schedules, elevations, sections or notes as rooms.

DOORS:
- Count actual architectural door openings/symbols within this plan once each.
- A swing arc with a door leaf is strong evidence.
- Do not count cabinet doors, schedule rows, symbols outside the plan or line gaps.

WINDOWS:
- Count actual architectural window/glazing symbols embedded in walls.
- In simple CAD/DXF plans a window may be represented only by a short line
  segment drawn in a distinct window layer/color directly on an exterior wall.
  Treat that as ONE window when the segment is clearly localized to the wall
  and is visually distinct from the continuous wall geometry.
- Do NOT require a double-line or detailed glazing symbol in a minimalist CAD
  plan when a distinct short wall-aligned window marker is clearly present.
- A room divider, grid, dimension line, title border, long construction line,
  or an isolated line away from a wall is NOT a window.
- Do not count the same window more than once if multiple strokes belong to one
  physical opening.
- Return zero only when no window symbol or distinct wall-aligned CAD window
  marker is visible.

Coordinates x/y are normalized within THIS crop, top-left origin.
Do not guess unreadable text.
`.trim();

  return callStructured(
    openai,
    {
      name:
        "ventra_plan_analysis",
      schema,
      prompt,
      imageUrl:
        planCrop.dataUrl,
    }
  );
}



async function discoverMissingPlanRooms(
  openai,
  planCrop,
  planInfo,
  existingRooms
) {
  const existing =
    (Array.isArray(existingRooms)
      ? existingRooms
      : []
    ).map((item) => ({
      label:
        String(item?.label || "").trim(),
      type:
        ROOM_TYPES.includes(item?.type)
          ? item.type
          : "Room",
      x:
        clamp01(item?.x),
      y:
        clamp01(item?.y),
    }));

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      missingRooms: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: {
              type: "string",
            },
            type: {
              type: "string",
              enum: ROOM_TYPES,
            },
            x: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "label",
            "type",
            "x",
            "y",
            "confidence",
          ],
        },
      },
    },
    required: [
      "missingRooms",
    ],
  };

  const prompt = `
Perform a COMPLETENESS CHECK on this single architectural floor plan.

Plan: ${planInfo?.title || planInfo?.id || "unknown"}

These labeled spaces were already found:
${JSON.stringify(existing)}

Your only job is to find clearly printed architectural room/space labels that
are VISIBLE in the plan but MISSING from the list above.

Important:
- Scan the entire plan systematically from top-left to bottom-right.
- Specifically check for MASTER BEDROOM, BEDROOM, WALK-IN CLOSET, BATHROOM/B/R,
  TOILET/WC, HALL, LIVING ROOM, DINING ROOM, KITCHEN, LAUNDRY, STUDY, FOYER,
  PANTRY, STORE, BALCONY, TERRACE and generic ROOM labels.
- Return a missing space even when another space of the SAME TYPE already exists
  elsewhere. Example: two separate BEDROOM labels are two physical rooms.
- Do not return a room already represented at approximately the same location.
- Do not infer rooms from furniture or fixtures.
- Do not read notes, dimensions, schedules, legends or title text as rooms.
- For partially clipped OCR such as "K-IN CLOSET", if the actual visible label
  clearly represents WALK-IN CLOSET, return corrected label WALK-IN CLOSET.
- x/y are normalized inside THIS plan crop.
- If nothing is missing, return an empty array.
`.trim();

  const parsed =
    await callStructured(
      openai,
      {
        name:
          "ventra_missing_room_discovery",
        schema,
        prompt,
        imageUrl:
          planCrop.dataUrl,
      }
    );

  return Array.isArray(
    parsed?.missingRooms
  )
    ? parsed.missingRooms
    : [];
}

function splitPlanRoomCandidatesForFastVerification(candidates) {
  const safe = (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && String(item?.label || "").trim())
    .slice(0, 50);

  const accepted = [];
  const needsVerification = [];

  for (const item of safe) {
    const label = cleanCadText(item?.label || item?.type);
    const confidence = clamp01(item?.confidence);
    const ambiguous = /^(?:B\/R|W\/R|W\/C|WC|HAL|RM|R\/M)$/i.test(label);

    // A clear, descriptive printed label with strong confidence does not need
    // a second full vision pass over the exact same pixels. The independent
    // full-sheet audit still cross-checks the plan inventory later.
    if (confidence >= 0.84 && !ambiguous) {
      const normalized = normalizeArchitecturalRoomLabel(
        label || item?.type,
        ROOM_TYPES.includes(item?.type) ? item.type : "Room"
      );

      accepted.push({
        ...item,
        label: normalized.label,
        type: normalized.type,
        x: clamp01(item?.x),
        y: clamp01(item?.y),
        confidence,
        verificationConfidence: confidence,
        verified: true,
        verificationSource: "primary_high_confidence_fast_path",
      });
    } else {
      needsVerification.push(item);
    }
  }

  return { accepted, needsVerification };
}

async function verifyPlanRooms(
  openai,
  planCrop,
  planInfo,
  candidates
) {
  const safeCandidates =
    (Array.isArray(candidates)
      ? candidates
      : []
    )
      .filter(
        (item) =>
          item &&
          String(item.label || "").trim()
      )
      .slice(0, 50)
      .map((item, index) => ({
        index,
        label:
          String(item.label || "").trim(),
        type:
          ROOM_TYPES.includes(item.type)
            ? item.type
            : "Room",
        x:
          clamp01(item.x),
        y:
          clamp01(item.y),
        confidence:
          clamp01(item.confidence),
      }));

  if (!safeCandidates.length) {
    return [];
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      rooms: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: {
              type: "integer",
              minimum: 0,
            },
            visible: {
              type: "boolean",
            },
            correctedLabel: {
              type: "string",
            },
            correctedType: {
              type: "string",
              enum: ROOM_TYPES,
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "index",
            "visible",
            "correctedLabel",
            "correctedType",
            "confidence",
          ],
        },
      },
    },
    required: ["rooms"],
  };

  const prompt = `
You are the independent verification stage for an architectural floor-plan takeoff.

Plan: ${planInfo?.title || planInfo?.id || "unknown"}

The first analysis proposed these room/space labels:
${JSON.stringify(safeCandidates)}

Verify EVERY proposed candidate against the actual pixels in this plan crop.

Rules:
- visible=true ONLY when the proposed space label is clearly printed at or very
  near the proposed x/y location and belongs to a physical architectural space.
- Reject hallucinated labels inferred from furniture, plumbing, door swings,
  notes, dimensions or nearby symbols.
- Reject partial/noisy OCR such as HAL, FORUM, B/R unless the printed text is
  genuinely readable and the correctedLabel/correctedType can be determined
  from the actual plan.
- Do not create new rooms in this verification pass.
- If the exact printed text differs slightly (e.g. DINNING ROOM), preserve the
  printed label but assign the correct semantic type.
- Multiple BEDROOMs are valid only when separate printed bedroom labels exist
  in separate physical spaces.
- confidence is your confidence that THIS specific candidate is a real labeled
  architectural space.
`.trim();

  const parsed =
    await callStructured(
      openai,
      {
        name:
          "ventra_plan_room_verification",
        schema,
        prompt,
        imageUrl:
          planCrop.dataUrl,
      }
    );

  const verified =
    Array.isArray(parsed?.rooms)
      ? parsed.rooms
      : [];

  const byIndex =
    new Map(
      verified.map(
        (item) => [
          Number(item.index),
          item,
        ]
      )
    );

  const result = [];

  for (
    let index = 0;
    index < safeCandidates.length;
    index += 1
  ) {
    const original =
      safeCandidates[index];
    const check =
      byIndex.get(index);

    if (
      !check ||
      check.visible !== true ||
      Number(check.confidence) < 0.62
    ) {
      continue;
    }

    const correctedLabel =
      cleanCadText(
        check.correctedLabel ||
          original.label
      );

    const correctedType =
      ROOM_TYPES.includes(
        check.correctedType
      )
        ? check.correctedType
        : original.type;

    // Very short ambiguous abbreviations are not production-safe unless the
    // verifier is exceptionally confident.
    const ambiguous =
      /^(?:B\/R|W\/R|W\/C|WC|HAL|RM|R\/M)$/i.test(
        correctedLabel
      );

    if (
      ambiguous &&
      Number(check.confidence) < 0.90
    ) {
      continue;
    }

    const normalizedRoom =
      normalizeArchitecturalRoomLabel(
        correctedLabel ||
          original.label,
        correctedType
      );

    result.push({
      ...original,
      label:
        normalizedRoom.label,
      type:
        normalizedRoom.type,
      confidence:
        Math.min(
          0.99,
          Math.max(
            original.confidence,
            Number(check.confidence) || 0
          )
        ),
      verificationConfidence:
        Number(check.confidence) || 0,
      verified: true,
    });
  }

  return result;
}


async function auditRoomsOnFullSheet(
  openai,
  imageUrl,
  plans,
  existingRooms
) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      rooms: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: {
              type: "string",
            },
            type: {
              type: "string",
              enum: ROOM_TYPES,
            },
            x: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            bbox: boxSchema,
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "label",
            "type",
            "x",
            "y",
            "bbox",
            "confidence",
          ],
        },
      },
    },
    required: ["rooms"],
  };

  const planHints =
    (Array.isArray(plans)
      ? plans
      : []
    ).map((plan) => ({
      id:
        String(plan?.id || ""),
      title:
        String(plan?.title || ""),
      bbox:
        normalizeBox(plan?.bbox),
    }));

  const existing =
    (Array.isArray(existingRooms)
      ? existingRooms
      : []
    ).map((room) => ({
      label:
        String(room?.label || ""),
      type:
        room?.type || "Room",
      x:
        Number(room?.x),
      y:
        Number(room?.y),
      planId:
        String(room?.planId || ""),
    }));

  const prompt = `
Perform a FINAL FULL-SHEET room audit for a construction takeoff.

Detected floor-plan regions:
${JSON.stringify(planHints)}

Rooms already found by plan-level analysis:
${JSON.stringify(existing)}

Scan the COMPLETE sheet at high resolution and return every clearly printed
architectural room/space label that belongs to one of the detected floor plans.

For each room, bbox must be the tight normalized rectangle around the ROOM INTERIOR
bounded by walls, not the text label. x/y remains the printed label center.
Do not let a bbox include neighboring rooms or schedules.

Important:
- Coordinates x/y are normalized to the COMPLETE SHEET, not to a plan crop.
- Return each physical labeled space once.
- Multiple BEDROOM, BATHROOM, HALL, etc. are valid when printed in separate rooms.
- Include MASTER BEDROOM, WALK-IN CLOSET, BEDROOM, BATHROOM/B/R, LIVING ROOM,
  DINING ROOM, KITCHEN, LAUNDRY, STUDY, FOYER, HALL, TOILET/WC, PANTRY,
  STORE, BALCONY, TERRACE and generic ROOM labels when visibly printed.
- Do not infer unlabeled rooms from furniture/fixtures.
- Do not read schedules, title blocks, elevations, notes or dimensions as rooms.
- Correct obvious OCR fragments such as K-IN CLOSET / WALK- CLOSET to
  WALK-IN CLOSET when the printed label is clear.
- Do not guess unreadable labels.
`.trim();

  const parsed =
    await callStructured(
      openai,
      {
        name:
          "ventra_full_sheet_room_audit",
        schema,
        prompt,
        imageUrl,
      }
    );

  const audited =
    Array.isArray(parsed?.rooms)
      ? parsed.rooms
      : [];

  const normalizedAudited =
    audited
      .filter(
        (room) =>
          Number(room?.confidence) >= 0.72
      )
      .map((room) => {
        const normalized =
          normalizeArchitecturalRoomLabel(
            room?.label || room?.type,
            room?.type
          );

        return {
          label:
            normalized.label,
          type:
            normalized.type,
          x:
            clamp01(room?.x),
          y:
            clamp01(room?.y),
          confidence:
            clamp01(room?.confidence),
          verificationConfidence:
            clamp01(room?.confidence),
          verified: true,
          source:
            "openai_full_sheet_room_audit",
        };
      })
      .map((room) =>
        resolveRoomPlanOwnership(
          room,
          plans
        )
      );

  /*
   * A full-sheet vision audit is useful for recovering rooms missed by a
   * plan crop, but short OCR abbreviations are much easier to hallucinate or
   * double-count (for example a bathroom annotation inside a room). Do not
   * allow a low-confidence shorthand seen only by the audit to create a new
   * physical room. Preserve it when the plan-level pass already found a
   * nearby room of the same semantic type, or when the audit confidence is
   * exceptionally high.
   */
  const isAmbiguousRoomShorthand =
    (label, type) => {
      const token =
        cleanCadText(label)
          .toUpperCase()
          .replace(/\s+/g, "");

      const shortToken =
        /^(?:[A-Z]{1,3}|[A-Z]{1,3}\/[A-Z]{1,3})$/.test(
          token
        );

      return (
        shortToken &&
        /^(?:Bathroom|Toilet)$/i.test(
          String(type || "")
        )
      );
    };

  const hasNearbyPlanCorroboration =
    (room) =>
      existing.some(
        (candidate) => {
          if (
            String(candidate?.type || "") !==
            String(room?.type || "")
          ) {
            return false;
          }

          const cx =
            Number(candidate?.x);
          const cy =
            Number(candidate?.y);

          if (
            !Number.isFinite(cx) ||
            !Number.isFinite(cy)
          ) {
            return false;
          }

          const dx = cx - room.x;
          const dy = cy - room.y;

          return (
            Math.hypot(dx, dy) <= 0.065
          );
        }
      );

  return normalizedAudited.filter(
    (room) => {
      if (
        !isAmbiguousRoomShorthand(
          room.label,
          room.type
        )
      ) {
        return true;
      }

      const corroborated =
        hasNearbyPlanCorroboration(
          room
        );

      const keep =
        corroborated ||
        Number(room.confidence) >= 0.93;

      if (!keep) {
        console.warn(
          "[VENTRA ANALYZER] ambiguous audit-only room rejected",
          {
            label: room.label,
            type: room.type,
            planId: room.planId,
            confidence: room.confidence,
          }
        );
      }

      return keep;
    }
  );
}

async function analyzeSchedule(
  openai,
  crop,
  kind
) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      quantityHeaderText: {
        type: "string",
      },
      rows: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            mark: {
              type: "string",
            },
            quantity: {
              anyOf: [
                {
                  type: "integer",
                  minimum: 0,
                },
                {
                  type: "null",
                },
              ],
            },
            cost: {
              anyOf: [
                {
                  type: "number",
                  minimum: 0,
                },
                {
                  type: "null",
                },
              ],
            },
            total: {
              anyOf: [
                {
                  type: "number",
                  minimum: 0,
                },
                {
                  type: "null",
                },
              ],
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "mark",
            "quantity",
            "cost",
            "total",
            "confidence",
          ],
        },
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: [
      "quantityHeaderText",
      "rows",
      "confidence",
    ],
  };

  const prompt = `
Read this ${kind.toUpperCase()} SCHEDULE row-by-row.

For every real data row return:
- mark: row identifier
- quantity: ONLY the value under QTY / QUANTITY / COUNT
- cost: ONLY the unit COST / PRICE column if present, otherwise null
- total: ONLY the row TOTAL / AMOUNT column if present, otherwise null

Critical:
- Never use COST as quantity.
- Never use TOTAL as quantity.
- Never use dimensions, mark numbers, type numbers or row numbers as quantity.
- If COST and TOTAL exist, use their column positions only as evidence to keep
  QTY separated from them.
- Do NOT calculate a grand total.
- Keep rows in visual top-to-bottom order.
`.trim();

  return callStructured(
    openai,
    {
      name:
        `ventra_${kind}_schedule_arithmetic_pass`,
      schema,
      prompt,
      imageUrl:
        crop.dataUrl,
    }
  );
}

async function verifyScheduleRows(
  openai,
  sourceBuffer,
  sourceMeta,
  scheduleCrop,
  kind,
  parsed
) {
  const firstRows =
    Array.isArray(parsed?.rows)
      ? parsed.rows
      : [];

  if (!firstRows.length) {
    return [];
  }

  const second =
    await analyzeSchedule(
      openai,
      scheduleCrop,
      kind
    );

  const secondRows =
    Array.isArray(second?.rows)
      ? second.rows
      : [];

  if (
    secondRows.length !==
    firstRows.length
  ) {
    return firstRows.map(
      (row) => ({
        ...row,
        verifiedQuantity:
          null,
        verificationConfidence:
          0,
        arithmeticValid:
          false,
      })
    );
  }

  const approxEqual =
    (a, b) => {
      const na =
        Number(a);
      const nb =
        Number(b);

      if (
        !Number.isFinite(na) ||
        !Number.isFinite(nb)
      ) {
        return false;
      }

      return (
        Math.abs(na - nb) <=
        Math.max(
          0.5,
          Math.abs(nb) * 0.02
        )
      );
    };

  return firstRows.map(
    (row, index) => {
      const check =
        secondRows[index];

      const firstQty =
        Number(row?.quantity);
      const secondQty =
        Number(
          check?.quantity
        );

      const quantitiesAgree =
        Number.isInteger(
          firstQty
        ) &&
        firstQty >= 0 &&
        Number.isInteger(
          secondQty
        ) &&
        secondQty >= 0 &&
        firstQty === secondQty;

      const firstCost =
        Number(row?.cost);
      const firstTotal =
        Number(row?.total);

      const secondCost =
        Number(check?.cost);
      const secondTotal =
        Number(check?.total);

      const firstArithmetic =
        Number.isFinite(
          firstCost
        ) &&
        Number.isFinite(
          firstTotal
        )
          ? approxEqual(
              firstQty *
                firstCost,
              firstTotal
            )
          : true;

      const secondArithmetic =
        Number.isFinite(
          secondCost
        ) &&
        Number.isFinite(
          secondTotal
        )
          ? approxEqual(
              secondQty *
                secondCost,
              secondTotal
            )
          : true;

      const markCompatible =
        !row?.mark ||
        !check?.mark ||
        String(row.mark)
          .trim()
          .toUpperCase() ===
          String(check.mark)
            .trim()
            .toUpperCase();

      const confidence =
        Math.min(
          Number(
            row?.confidence
          ) || 0,
          Number(
            check?.confidence
          ) || 0
        );

      const valid =
        quantitiesAgree &&
        firstArithmetic &&
        secondArithmetic &&
        markCompatible &&
        confidence >= 0.78;

      return {
        ...row,
        verifiedQuantity:
          valid
            ? firstQty
            : null,
        verificationConfidence:
          valid
            ? confidence
            : 0,
        arithmeticValid:
          firstArithmetic &&
          secondArithmetic,
        secondPassQuantity:
          Number.isInteger(
            secondQty
          )
            ? secondQty
            : null,
      };
    }
  );
}



function isolateAdjacentPlanRegions(
  plans
) {
  const result =
    (Array.isArray(plans)
      ? plans
      : []
    ).map((plan) => ({
      ...plan,
      bbox:
        normalizeBox(plan?.bbox),
    }));

  for (
    let i = 0;
    i < result.length;
    i += 1
  ) {
    for (
      let j = i + 1;
      j < result.length;
      j += 1
    ) {
      const a =
        result[i].bbox;
      const b =
        result[j].bbox;

      const ix1 =
        Math.max(a.x, b.x);
      const ix2 =
        Math.min(
          a.x + a.width,
          b.x + b.width
        );
      const iy1 =
        Math.max(a.y, b.y);
      const iy2 =
        Math.min(
          a.y + a.height,
          b.y + b.height
        );

      const overlapW =
        Math.max(0, ix2 - ix1);
      const overlapH =
        Math.max(0, iy2 - iy1);

      if (
        overlapW <= 0 ||
        overlapH <= 0
      ) {
        continue;
      }

      const horizontalOverlapRatio =
        overlapW /
        Math.max(
          1e-9,
          Math.min(
            a.width,
            b.width
          )
        );

      const verticalOverlapRatio =
        overlapH /
        Math.max(
          1e-9,
          Math.min(
            a.height,
            b.height
          )
        );

      if (
        verticalOverlapRatio > 0.55 &&
        horizontalOverlapRatio < 0.35
      ) {
        const split =
          (ix1 + ix2) / 2;

        if (a.x < b.x) {
          const bRight =
            b.x + b.width;

          a.width =
            Math.max(
              0.03,
              split - a.x
            );

          b.x =
            split;

          b.width =
            Math.max(
              0.03,
              bRight - split
            );
        } else {
          const aRight =
            a.x + a.width;

          b.width =
            Math.max(
              0.03,
              split - b.x
            );

          a.x =
            split;

          a.width =
            Math.max(
              0.03,
              aRight - split
            );
        }
      } else if (
        horizontalOverlapRatio > 0.55 &&
        verticalOverlapRatio < 0.35
      ) {
        const split =
          (iy1 + iy2) / 2;

        if (a.y < b.y) {
          const bBottom =
            b.y + b.height;

          a.height =
            Math.max(
              0.03,
              split - a.y
            );

          b.y =
            split;

          b.height =
            Math.max(
              0.03,
              bBottom - split
            );
        } else {
          const aBottom =
            a.y + a.height;

          b.height =
            Math.max(
              0.03,
              split - b.y
            );

          a.y =
            split;

          a.height =
            Math.max(
              0.03,
              aBottom - split
            );
        }
      }
    }
  }

  return result;
}

function enforcePlanOwnershipBoundaries(
  plans
) {
  const result =
    (Array.isArray(plans)
      ? plans
      : []
    ).map((plan) => ({
      ...plan,
      bbox:
        normalizeBox(plan?.bbox),
    }));

  if (result.length < 2) {
    return result;
  }

  const centers =
    result.map(
      (plan, index) => ({
        index,
        x:
          plan.bbox.x +
          plan.bbox.width / 2,
        y:
          plan.bbox.y +
          plan.bbox.height / 2,
      })
    );

  for (
    let i = 0;
    i < centers.length;
    i += 1
  ) {
    for (
      let j = i + 1;
      j < centers.length;
      j += 1
    ) {
      const a =
        centers[i];
      const b =
        centers[j];

      const pa =
        result[a.index].bbox;
      const pb =
        result[b.index].bbox;

      const dx =
        Math.abs(
          a.x - b.x
        );

      const dy =
        Math.abs(
          a.y - b.y
        );

      if (dx >= dy) {
        const split =
          (a.x + b.x) / 2;

        const left =
          a.x < b.x
            ? pa
            : pb;

        const right =
          a.x < b.x
            ? pb
            : pa;

        const leftRight =
          left.x +
          left.width;

        const rightRight =
          right.x +
          right.width;

        left.width =
          Math.max(
            0.03,
            Math.min(
              leftRight,
              split
            ) -
              left.x
          );

        if (right.x < split) {
          right.x =
            split;

          right.width =
            Math.max(
              0.03,
              rightRight -
                split
            );
        }
      } else {
        const split =
          (a.y + b.y) / 2;

        const top =
          a.y < b.y
            ? pa
            : pb;

        const bottom =
          a.y < b.y
            ? pb
            : pa;

        const topBottom =
          top.y +
          top.height;

        const bottomBottom =
          bottom.y +
          bottom.height;

        top.height =
          Math.max(
            0.03,
            Math.min(
              topBottom,
              split
            ) -
              top.y
          );

        if (bottom.y < split) {
          bottom.y =
            split;

          bottom.height =
            Math.max(
              0.03,
              bottomBottom -
                split
            );
        }
      }
    }
  }

  return result.map(
    (plan) => ({
      ...plan,
      bbox:
        normalizeBox(
          plan.bbox
        ),
    })
  );
}

function dedupePlanRegions(
  plans
) {
  const result = [];

  for (const plan of Array.isArray(
    plans
  )
    ? plans
    : []) {
    const bbox =
      normalizeBox(plan?.bbox);

    if (
      Number(
        plan?.confidence
      ) < 0.45 ||
      bbox.width *
          bbox.height <
        0.025
    ) {
      continue;
    }

    const duplicate =
      result.some(
        (existing) => {
          const a =
            existing.bbox;
          const b = bbox;

          const ix =
            Math.max(
              0,
              Math.min(
                a.x +
                  a.width,
                b.x +
                  b.width
              ) -
                Math.max(
                  a.x,
                  b.x
                )
            );
          const iy =
            Math.max(
              0,
              Math.min(
                a.y +
                  a.height,
                b.y +
                  b.height
              ) -
                Math.max(
                  a.y,
                  b.y
                )
            );
          const intersection =
            ix * iy;
          const smaller =
            Math.min(
              a.width *
                a.height,
              b.width *
                b.height
            );

          return (
            smaller > 0 &&
            intersection /
                smaller >
              0.82
          );
        }
      );

    if (!duplicate) {
      result.push({
        ...plan,
        bbox,
      });
    }
  }

  return result;
}


function resolveRoomPlanOwnership(
  room,
  plans
) {
  const x =
    Number(room?.x);
  const y =
    Number(room?.y);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return room;
  }

  const candidates =
    (Array.isArray(plans)
      ? plans
      : []
    )
      .map((plan) => {
        const bbox =
          normalizeBox(plan?.bbox);

        const inside =
          x >= bbox.x &&
          x <= bbox.x + bbox.width &&
          y >= bbox.y &&
          y <= bbox.y + bbox.height;

        const cx =
          bbox.x +
          bbox.width / 2;
        const cy =
          bbox.y +
          bbox.height / 2;

        const dx =
          (x - cx) /
          Math.max(
            bbox.width,
            1e-6
          );
        const dy =
          (y - cy) /
          Math.max(
            bbox.height,
            1e-6
          );

        return {
          plan,
          bbox,
          inside,
          distance:
            Math.hypot(
              dx,
              dy
            ),
        };
      })
      .sort((a, b) => {
        if (
          a.inside !==
          b.inside
        ) {
          return a.inside
            ? -1
            : 1;
        }

        return (
          a.distance -
          b.distance
        );
      });

  const owner =
    candidates[0];

  if (!owner?.plan) {
    return room;
  }

  // If the point is outside every plan, keep the original assignment rather
  // than forcing a label into a neighboring floor plan.
  if (
    !owner.inside &&
    owner.distance > 0.78
  ) {
    return room;
  }

  return {
    ...room,
    planId:
      String(
        owner.plan?.id ||
          room.planId ||
          ""
      ),
    planTitle:
      String(
        owner.plan?.title ||
          room.planTitle ||
          ""
      ),
    ownershipCorrected:
      String(
        owner.plan?.id ||
          ""
      ) !==
      String(
        room.planId ||
          ""
      ),
  };
}

function roomGlobalCoordinates(
  room,
  planBox
) {
  return {
    x:
      planBox.x +
      clamp01(room?.x) *
        planBox.width,
    y:
      planBox.y +
      clamp01(room?.y) *
        planBox.height,
  };
}

function roomGlobalBox(
  room,
  cropBox
) {
  const local =
    normalizeBox(
      room?.bbox
    );

  const crop =
    normalizeBox(
      cropBox
    );

  return normalizeBox({
    x:
      crop.x +
      local.x *
        crop.width,
    y:
      crop.y +
      local.y *
        crop.height,
    width:
      local.width *
      crop.width,
    height:
      local.height *
      crop.height,
  });
}



function mergeVerifiedRoomPasses(
  firstPass,
  missingPass
) {
  const combined = [
    ...(Array.isArray(firstPass)
      ? firstPass
      : []),
  ];

  for (const candidate of Array.isArray(
    missingPass
  )
    ? missingPass
    : []) {
    const x =
      Number(candidate?.x);
    const y =
      Number(candidate?.y);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }

    const duplicate =
      combined.some(
        (existing) => {
          const ex =
            Number(existing?.x);
          const ey =
            Number(existing?.y);

          if (
            !Number.isFinite(ex) ||
            !Number.isFinite(ey)
          ) {
            return false;
          }

          const sameType =
            existing?.type ===
            candidate?.type;

          const sameLabel =
            String(
              existing?.label || ""
            )
              .trim()
              .toUpperCase() ===
            String(
              candidate?.label || ""
            )
              .trim()
              .toUpperCase();

          const distance =
            Math.hypot(
              ex - x,
              ey - y
            );

          return (
            distance <
              (sameType ||
              sameLabel
                ? 0.035
                : 0.018)
          );
        }
      );

    if (!duplicate) {
      combined.push(candidate);
    }
  }

  return combined;
}



function mergeAuditAuthorityRooms(
  recoveredRooms,
  auditRooms
) {
  const recovered = Array.isArray(recoveredRooms)
    ? recoveredRooms
    : [];
  const audited = Array.isArray(auditRooms)
    ? auditRooms
    : [];

  if (!audited.length) return recovered;
  if (!recovered.length) return audited;

  const keyOf = (room) =>
    `${String(room?.planId || "")}::${String(room?.type || "")}`;

  const auditedByKey = new Map();
  const recoveredByKey = new Map();

  for (const room of audited) {
    const key = keyOf(room);
    if (!auditedByKey.has(key)) auditedByKey.set(key, []);
    auditedByKey.get(key).push(room);
  }

  for (const room of recovered) {
    const key = keyOf(room);
    if (!recoveredByKey.has(key)) recoveredByKey.set(key, []);
    recoveredByKey.get(key).push(room);
  }

  // In authoritative-audit mode the audit is the physical-room inventory.
  // First-pass rooms are allowed to fill only a genuine per-plan/per-type
  // deficit; they are never blindly appended to the audit inventory. This
  // prevents the same physical room from appearing twice merely because the
  // plan crop and full-sheet pass produced slightly different coordinates.
  const merged = [...audited];

  for (const [key, recoveredGroup] of recoveredByKey.entries()) {
    const auditGroup = auditedByKey.get(key) || [];
    const deficit = Math.max(0, recoveredGroup.length - auditGroup.length);

    if (!deficit) continue;

    const ranked = recoveredGroup
      .map((room) => {
        const rx = Number(room?.x);
        const ry = Number(room?.y);
        let nearest = Infinity;

        for (const audit of auditGroup) {
          const ax = Number(audit?.x);
          const ay = Number(audit?.y);
          if (![rx, ry, ax, ay].every(Number.isFinite)) continue;
          nearest = Math.min(nearest, Math.hypot(rx - ax, ry - ay));
        }

        return {
          room,
          nearest,
          confidence: Number(room?.confidence || 0),
        };
      })
      .sort((a, b) => {
        // Prefer rooms least likely to be another observation of an audited
        // room; confidence breaks ties.
        if (b.nearest !== a.nearest) return b.nearest - a.nearest;
        return b.confidence - a.confidence;
      });

    merged.push(...ranked.slice(0, deficit).map((item) => item.room));
  }

  return merged;
}

function reconcileRecoveredRoomOwnershipWithAudit(
  recoveredRooms,
  auditRooms
) {
  const recovered = Array.isArray(recoveredRooms)
    ? recoveredRooms.map((room) => ({ ...room }))
    : [];
  const audited = Array.isArray(auditRooms)
    ? auditRooms.map((room, index) => ({ ...room, __auditIndex: index }))
    : [];

  if (!recovered.length || !audited.length) {
    return recovered;
  }

  const consumedAudit = new Set();
  const matchedRecovered = new Set();

  const identity = (room) => {
    const normalized = normalizeArchitecturalRoomLabel(
      cleanCadText(room?.label || room?.type),
      room?.type
    );

    return {
      type: String(normalized?.type || room?.type || ""),
      label: String(normalized?.label || room?.label || "")
        .trim()
        .toUpperCase(),
    };
  };

  // First consume audit candidates that already corroborate a recovered room
  // on the same plan and at nearly the same location. This preserves valid
  // multiplicity (for example multiple bathrooms/halls) before we use any
  // remaining audit candidates to repair cross-plan crop contamination.
  recovered.forEach((room, recoveredIndex) => {
    const rid = identity(room);
    const rx = Number(room?.x);
    const ry = Number(room?.y);
    const planId = String(room?.planId || "");

    let best = null;

    audited.forEach((candidate) => {
      if (consumedAudit.has(candidate.__auditIndex)) return;

      const aid = identity(candidate);
      if (aid.type !== rid.type) return;
      if (String(candidate?.planId || "") !== planId) return;

      const ax = Number(candidate?.x);
      const ay = Number(candidate?.y);
      if (![rx, ry, ax, ay].every(Number.isFinite)) return;

      const distance = Math.hypot(rx - ax, ry - ay);
      const sameLabel = aid.label === rid.label;
      const threshold = sameLabel ? 0.085 : 0.045;
      if (distance > threshold) return;

      const score = distance - (sameLabel ? 0.02 : 0);
      if (!best || score < best.score) {
        best = { candidate, score };
      }
    });

    if (best) {
      consumedAudit.add(best.candidate.__auditIndex);
      matchedRecovered.add(recoveredIndex);
    }
  });

  const corrections = [];

  // A plan crop can leak labels from a neighboring floor plan. When a
  // recovered room has no same-plan full-sheet corroboration, prefer an
  // unconsumed full-sheet candidate of the same architectural type. This
  // changes ownership/coordinates, not the overall recovered room count, and
  // avoids fixture-specific labels or expected counts.
  recovered.forEach((room, recoveredIndex) => {
    if (matchedRecovered.has(recoveredIndex)) return;

    const rid = identity(room);
    const currentPlanId = String(room?.planId || "");

    const candidates = audited
      .filter((candidate) => {
        if (consumedAudit.has(candidate.__auditIndex)) return false;
        const aid = identity(candidate);
        return aid.type === rid.type;
      })
      .sort((a, b) => {
        const aid = identity(a);
        const bid = identity(b);
        const aSameLabel = aid.label === rid.label ? 1 : 0;
        const bSameLabel = bid.label === rid.label ? 1 : 0;
        if (aSameLabel !== bSameLabel) return bSameLabel - aSameLabel;
        return Number(b?.confidence || 0) - Number(a?.confidence || 0);
      });

    const replacement = candidates[0];
    if (!replacement) return;

    // Do not churn a room between candidates on the same plan merely because
    // the full-sheet pass used a slightly different coordinate. The repair is
    // specifically for ownership leakage across adjacent plan crops.
    if (String(replacement?.planId || "") === currentPlanId) {
      consumedAudit.add(replacement.__auditIndex);
      return;
    }

    const normalized = normalizeArchitecturalRoomLabel(
      cleanCadText(replacement?.label || replacement?.type),
      replacement?.type
    );

    recovered[recoveredIndex] = {
      ...room,
      label: normalized.label,
      type: normalized.type,
      x: clamp01(replacement?.x),
      y: clamp01(replacement?.y),
      planId: String(replacement?.planId || room?.planId || ""),
      planTitle: String(replacement?.planTitle || room?.planTitle || ""),
      confidence: Math.max(
        Number(room?.confidence || 0),
        Number(replacement?.confidence || 0)
      ),
      ownershipCorrected: true,
      source: "openai_full_sheet_audit_ownership_reconciled",
    };

    consumedAudit.add(replacement.__auditIndex);
    corrections.push({
      type: normalized.type,
      fromPlan: currentPlanId,
      toPlan: String(replacement?.planId || ""),
      label: normalized.label,
    });
  });

  if (corrections.length) {
    console.log(
      "[VENTRA ANALYZER] audit ownership reconciliation",
      { corrections }
    );
  }

  return recovered;
}

function dedupeRooms(
  rooms
) {
  const kept = [];

  const sorted =
    (Array.isArray(rooms)
      ? rooms
      : []
    )
      .filter(
        (room) =>
          ROOM_TYPES.includes(
            room?.type
          ) &&
          String(
            room?.label || ""
          ).trim()
      )
      .sort(
        (a, b) =>
          Number(
            b?.confidence || 0
          ) -
          Number(
            a?.confidence || 0
          )
      );

  for (const candidate of sorted) {
    const x =
      Number(candidate.x);
    const y =
      Number(candidate.y);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }

    const candidateLabel =
      String(candidate.label || "")
        .trim()
        .toUpperCase();

    const duplicate =
      kept.findIndex(
        (existing) => {
          if (
            existing.planId !== candidate.planId ||
            existing.type !== candidate.type
          ) {
            return false;
          }

          const existingLabel =
            String(existing.label || "")
              .trim()
              .toUpperCase();

          const distance =
            Math.hypot(
              existing.x - x,
              existing.y - y
            );

          const sameNormalizedLabel =
            existingLabel ===
            candidateLabel;

          const threshold =
            candidate.type === "Bedroom" ||
            candidate.type === "Master Bedroom"
              ? 0.022
              : sameNormalizedLabel
                ? 0.055
                : 0.032;

          return distance < threshold;
        }
      );

    if (duplicate < 0) {
      kept.push(
        candidate
      );
    }
  }

  return kept;
}


async function executeLowCostRoomRecovery({
  image,
  urn,
}) {
  const source =
    parseDataImage(image);

  if (!source?.buffer) {
    return {
      labels: [],
      source:
        "low_cost_room_recovery_no_image",
    };
  }

  const sourceDataUrl =
    toDataUrl(
      source.buffer,
      source.mime
    );

  const openai =
    getOpenAIClient();

  const schema = {
    type: "object",
    additionalProperties:
      false,
    properties: {
      rooms: {
        type: "array",
        maxItems: 60,
        items: {
          type: "object",
          additionalProperties:
            false,
          properties: {
            label: {
              type: "string",
            },
            type: {
              type: "string",
              enum: ROOM_TYPES,
            },
            x: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "label",
            "type",
            "x",
            "y",
            "confidence",
          ],
        },
      },
    },
    required: ["rooms"],
  };

  const prompt = `
You are performing a LOW-COST RECOVERY PASS for architectural room labels.

Inspect the COMPLETE high-resolution drawing sheet once.

Return every clearly visible architectural ROOM OR SPACE LABEL from all floor plans.
Examples include:
MASTER BEDROOM, BEDROOM, LIVING ROOM, DINING ROOM, KITCHEN, STUDY, HALL,
BATHROOM, TOILET/WC, WALK-IN CLOSET, LAUNDRY, FOYER, PANTRY, STORE,
BALCONY, TERRACE, GARAGE, CORRIDOR and similar architectural spaces.

Rules:
- Do NOT classify furniture, sanitary fixtures, symbols, blocks, schedules,
  legends, notes, dimensions, door/window tags or component names as rooms.
- A WC/toilet fixture symbol is NOT a Toilet room unless the room itself is
  clearly labeled TOILET/WC.
- Preserve duplicate room types when they are separate physical rooms.
- x/y must be the approximate CENTER of the printed room label normalized to
  the entire sheet, top-left origin.
- Do not invent unreadable labels.
- Scan every floor plan on the sheet from top-left to bottom-right.
`.trim();

  const response =
    await openai.responses.create({
      model:
        process.env
          .OPENAI_DRAWING_RECOVERY_MODEL ||
        process.env
          .OPENAI_DRAWING_MODEL ||
        "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type:
                "input_text",
              text: prompt,
            },
            {
              type:
                "input_image",
              image_url:
                sourceDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type:
            "json_schema",
          name:
            "ventra_low_cost_room_recovery",
          strict: true,
          schema,
        },
      },
    });

  const parsed =
    JSON.parse(
      response.output_text ||
      "{}"
    );

  const labels =
    (Array.isArray(
      parsed?.rooms
    )
      ? parsed.rooms
      : []
    )
      .filter(
        (room) =>
          String(
            room?.label ||
            ""
          ).trim() &&
          ROOM_TYPES.includes(
            room?.type
          ) &&
          Number.isFinite(
            Number(room?.x)
          ) &&
          Number.isFinite(
            Number(room?.y)
          )
      )
      .map(
        (room) => ({
          label:
            String(
              room.label
            ).trim(),
          type:
            room.type,
          x:
            clamp01(room.x),
          y:
            clamp01(room.y),
          confidence:
            Math.max(
              0,
              Math.min(
                1,
                Number(
                  room.confidence
                ) || 0
              )
            ),
          verified: true,
          coordinateSystem:
            "viewer_sheet_normalized",
          centroidSource:
            "openai_low_cost_room_recovery",
          bbox: null,
          planId: null,
          planTitle: null,
        })
      );

  console.log(
    "[VENTRA ROOM RECOVERY v28]",
    {
      urn: Boolean(urn),
      calls: 1,
      rooms:
        labels.length,
      types:
        labels.reduce(
          (result, room) => {
            result[
              room.type
            ] =
              (
                result[
                  room.type
                ] || 0
              ) + 1;
            return result;
          },
          {}
        ),
    }
  );

  return {
    labels,
    apsEvidence: {
      rawCount: 0,
      trustedCount: 0,
      labels: [],
    },
    openings: {
      doors: null,
      windows: null,
      confidence: 0,
      source:
        "not_requested_low_cost_recovery",
    },
    validation: {
      rooms: {
        accepted:
          labels,
        needsReview: [],
        acceptedCount:
          labels.length,
        reviewCount: 0,
      },
      openings: {
        doors: {
          status:
            "not_requested",
        },
        windows: {
          status:
            "not_requested",
        },
      },
    },
    planAnalyses: [],
    source:
      "openai_low_cost_room_recovery",
    lowCostRecovery: true,
  };
}

async function executeAnalysis({
  image,
  urn,
  geometryWindowCount = null,
}) {
  const inputImage =
    parseDataImage(image);

  // Production semantic takeoff requires the Autodesk Viewer high-resolution image.
  // Never silently analyze the 1000x1000 APS thumbnail.
  const source = inputImage;

  if (!source?.buffer) {
    console.warn(
      "[VENTRA ANALYZER] high-res Autodesk Viewer image required; thumbnail analysis blocked",
      { urn: Boolean(urn) }
    );
  }

  if (!source?.buffer) {
    return {
      labels: [],
      openings: {
        doors: null,
        windows: null,
        confidence: 0,
        source:
          "unavailable",
      },
      validation: {
        rooms: {
          accepted: [],
          needsReview: [],
          acceptedCount: 0,
          reviewCount: 0,
        },
        openings: {
          doors: {
            status:
              "needs_review",
          },
          windows: {
            status:
              "needs_review",
          },
        },
      },
      diagnostic:
        "NO_ANALYZABLE_IMAGE",
    };
  }

  const sourceMeta =
    await sharp(
      source.buffer
    ).metadata();

  if (
    !sourceMeta.width ||
    !sourceMeta.height
  ) {
    throw new Error(
      "Drawing image dimensions are unavailable."
    );
  }

  const sourceDataUrl =
    toDataUrl(
      source.buffer,
      source.mime
    );

  const apsEvidence =
    await getApsTextEvidence(
      urn
    );

  const openai =
    getOpenAIClient();

  const layout =
    await understandSheet(
      openai,
      sourceDataUrl,
      apsEvidence.trusted
    );

  let plans =
    enforcePlanOwnershipBoundaries(
      isolateAdjacentPlanRegions(
        dedupePlanRegions(
          layout?.plans
        )
      )
    );

  // If segmentation is uncertain, analyze the whole image as one plan
  // rather than slicing the drawing with hard-coded coordinates.
  if (!plans.length) {
    plans = [
      {
        id: "plan-1",
        title:
          "Primary plan",
        bbox: {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
        confidence:
          Number(
            layout?.confidence
          ) || 0.45,
      },
    ];
  }

  console.log(
    "[VENTRA ANALYZER] sheet layout",
    {
      imageSource:
        source.source,
      imageWidth:
        sourceMeta.width,
      imageHeight:
        sourceMeta.height,
      plans,
      doorSchedules:
        layout?.doorSchedules ||
        [],
      windowSchedules:
        layout?.windowSchedules ||
        [],
    }
  );

  // Once the sheet layout is known, the expensive independent vision tasks
  // do not need to wait for one another. Run the full-sheet room audit and
  // both schedules in parallel with the per-plan analysis. This removes
  // several minutes of avoidable serial model latency on large DWG sheets.
  const fullSheetAuditPromise =
    auditRoomsOnFullSheet(
      openai,
      sourceDataUrl,
      plans,
      []
    );

  const schedulePromise =
    Promise.all([
      scheduleQuantity(
        layout?.doorSchedules,
        "doors"
      ),
      scheduleQuantity(
        layout?.windowSchedules,
        "windows"
      ),
    ]);

  const rawRooms = [];
  const planAnalyses = [];

  const planResults =
    await Promise.all(
      plans.map(
        async (
          plan,
          index
        ) => {
          const crop =
            await cropRegion(
              source.buffer,
              sourceMeta,
              plan.bbox,
              `plan-${index + 1}`
            );

          const analysis =
            await analyzePlan(
              openai,
              crop,
              plan,
              apsEvidence.trusted
            );

          const primaryRoomCandidates =
            Array.isArray(analysis?.rooms)
              ? analysis.rooms
              : [];

          const primarySplit =
            splitPlanRoomCandidatesForFastVerification(
              primaryRoomCandidates
            );

          const explicitlyVerifiedCandidates =
            primarySplit.needsVerification.length
              ? await verifyPlanRooms(
                  openai,
                  crop,
                  plan,
                  primarySplit.needsVerification
                )
              : [];

          const firstVerifiedCandidates =
            mergeVerifiedRoomPasses(
              primarySplit.accepted,
              explicitlyVerifiedCandidates
            );

          // Fast path: verify the primary room pass, then let the full-sheet
          // audit recover any genuinely missing rooms. The older flow always
          // ran an additional missing-room discovery + second verification
          // for every plan before the full-sheet audit, which added two
          // sequential vision calls per plan even when the audit later became
          // authoritative. Those expensive passes are now deferred and run
          // only if the full-sheet audit cannot be trusted.
          const verifiedCandidates =
            firstVerifiedCandidates;

          const verifiedMissingCandidates =
            [];

          const planConfidence =
            clamp01(
              analysis?.confidence
            );

          const openingConfidence =
            clamp01(
              analysis?.openingConfidence
            );

          const planRooms =
            verifiedCandidates.map(
              (room) => {
                const global =
                  roomGlobalCoordinates(
                    room,
                    crop.bbox
                  );

                const normalized =
                  normalizeArchitecturalRoomLabel(
                    cleanCadText(
                      room?.label ||
                        room?.type
                    ),
                    room?.type
                  );

                return {
                  label:
                    normalized.label,
                  type:
                    normalized.type,
                  x:
                    clamp01(
                      global.x
                    ),
                  y:
                    clamp01(
                      global.y
                    ),
                  bbox:
                    roomGlobalBox(
                      room,
                      crop.bbox
                    ),
                  confidence:
                    clamp01(
                      room?.confidence
                    ),
                  verificationConfidence:
                    clamp01(
                      room?.verificationConfidence
                    ),
                  verified:
                    room?.verified ===
                    true,
                  planId:
                    String(
                      plan?.id ||
                        `plan-${index + 1}`
                    ),
                  planTitle:
                    String(
                      plan?.title ||
                        ""
                    ),
                  source:
                    "openai_plan_region_verified",
                };
              }
            )
            .map((room) =>
              resolveRoomPlanOwnership(
                room,
                plans
              )
            );

          console.log(
            "[VENTRA ANALYZER] room completeness",
            {
              plan:
                plan?.title ||
                plan?.id,
              firstPass:
                firstVerifiedCandidates.map(
                  (room) =>
                    room.label
                ),
              missingPass:
                verifiedMissingCandidates.map(
                  (room) =>
                    room.label
                ),
              combinedCount:
                verifiedCandidates.length,
              ownershipCorrections:
                planRooms.filter(
                  (room) =>
                    room.ownershipCorrected
                ).map(
                  (room) => ({
                    label:
                      room.label,
                    planId:
                      room.planId,
                  })
                ),
            }
          );

          return {
            rooms:
              planRooms,
            crop,
            plan,
            index,
            firstVerifiedCandidates,
            analysisRaw:
              analysis,
            analysis: {
              planId:
                String(
                  plan?.id ||
                    `plan-${index + 1}`
                ),
              title:
                String(
                  plan?.title ||
                    ""
                ),
              bbox:
                crop.bbox,
              confidence:
                planConfidence,
              doors:
                Math.max(
                  0,
                  Math.trunc(
                    Number(
                      analysis?.doors
                    ) || 0
                  )
                ),
              windows:
                Math.max(
                  0,
                  Math.trunc(
                    Number(
                      analysis?.windows
                    ) || 0
                  )
                ),
              openingConfidence,
              rooms:
                planRooms.length,
            },
          };
        }
      )
    );

  for (const result of planResults) {
    rawRooms.push(
      ...result.rooms
    );
    planAnalyses.push(
      result.analysis
    );
  }

  const rawAuditedRooms =
    await fullSheetAuditPromise;

  // A full-sheet vision audit is useful for recovering rooms that a cropped
  // plan pass misses, but it must not be allowed to invent extra low-confidence
  // rooms and immediately become authoritative. Keep audit-only additions only
  // when they are strongly supported; otherwise defer to the slower per-plan
  // recovery/verification path. This is intentionally spatial/type based rather
  // than tied to any fixture label or expected room count.
  const auditOnlyRejections = [];

  const auditedRooms =
    rawAuditedRooms.filter((room) => {
      const rx = Number(room?.x);
      const ry = Number(room?.y);
      const roomPlanId = String(room?.planId || "");
      const roomType = String(room?.type || "");
      const roomLabel = String(room?.label || "")
        .trim()
        .toUpperCase();

      const corroborated = rawRooms.some((candidate) => {
        if (
          String(candidate?.planId || "") !== roomPlanId ||
          (!Number.isFinite(rx) || !Number.isFinite(ry))
        ) {
          return false;
        }

        const cx = Number(candidate?.x);
        const cy = Number(candidate?.y);

        if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
          return false;
        }

        const sameType =
          String(candidate?.type || "") === roomType;
        const sameLabel =
          String(candidate?.label || "")
            .trim()
            .toUpperCase() === roomLabel;

        if (!sameType && !sameLabel) {
          return false;
        }

        return Math.hypot(cx - rx, cy - ry) <= 0.07;
      });

      const auditLabelToken =
        cleanCadText(roomLabel)
          .toUpperCase()
          .replace(/\s+/g, "");

      const ambiguousAuditOnlyLabel =
        /^(?:B\/R|W\/R|W\/C|WC|HAL|RM|R\/M|BR|WR)$/.test(
          auditLabelToken
        );

      const strongDescriptiveAuditOnlyRoom =
        Number(room?.confidence) >= 0.85 &&
        auditLabelToken.length >= 4 &&
        !ambiguousAuditOnlyLabel &&
        Boolean(roomPlanId);

      if (
        corroborated ||
        Number(room?.confidence) >= 0.93 ||
        strongDescriptiveAuditOnlyRoom
      ) {
        return true;
      }

      auditOnlyRejections.push({
        label: room?.label,
        type: room?.type,
        planId: room?.planId,
        confidence: Number(room?.confidence) || 0,
      });

      return false;
    });

  if (auditOnlyRejections.length) {
    console.warn(
      "[VENTRA ANALYZER] low-confidence audit-only rooms deferred",
      { rooms: auditOnlyRejections }
    );
  }

  const auditedPlanIds =
    new Set(
      auditedRooms
        .map(
          (room) =>
            String(
              room?.planId || ""
            )
        )
        .filter(Boolean)
    );

  const expectedPlanIds =
    new Set(
      plans
        .map(
          (plan) =>
            String(
              plan?.id || ""
            )
        )
        .filter(Boolean)
    );

  const auditCoversAllPlans =
    expectedPlanIds.size > 0 &&
    [...expectedPlanIds].every(
      (planId) =>
        auditedPlanIds.has(
          planId
        )
    );

  const auditConfidence =
    auditedRooms.length
      ? auditedRooms.reduce(
          (sum, room) =>
            sum +
            (Number(
              room?.confidence
            ) || 0),
          0
        ) /
        auditedRooms.length
      : 0;

  // A few low-confidence audit-only candidates must not force the entire
  // analyzer into the expensive missing-room discovery + verification path.
  // When the full-sheet audit covers every detected plan with strong overall
  // confidence, use it as the ownership authority and merge it with the
  // already-verified first plan pass. This preserves real rooms that were
  // visible in a crop while preventing weak audit-only additions from entering
  // the schedule without corroboration.
  const useAuditAsAuthority =
    auditedRooms.length >= 2 &&
    auditCoversAllPlans &&
    auditConfidence >= 0.82;

  let authoritativeRooms;

  if (useAuditAsAuthority) {
    const reconciledFirstPassRooms =
      reconcileRecoveredRoomOwnershipWithAudit(
        rawRooms,
        rawAuditedRooms
      );

    authoritativeRooms =
      mergeAuditAuthorityRooms(
        reconciledFirstPassRooms,
        auditedRooms
      );

    console.log(
      "[VENTRA ANALYZER] deferred room recovery skipped",
      {
        reason:
          "full_sheet_audit_authoritative",
        skippedCalls:
          planResults.length * 2,
        deferredAuditOnlyCount:
          auditOnlyRejections.length,
        preservedFirstPassRooms:
          reconciledFirstPassRooms.length,
      }
    );
  } else {
    // Slow fallback only: if the full-sheet audit is not authoritative, run
    // the missing-room discovery and its verification that used to execute
    // unconditionally for every plan. This preserves the previous recovery
    // behavior without charging the common successful path for redundant AI
    // calls.
    const recoveredPlanResults =
      await Promise.all(
        planResults.map(
          async (result) => {
            const missingCandidates =
              await discoverMissingPlanRooms(
                openai,
                result.crop,
                result.plan,
                result.firstVerifiedCandidates
              );

            const verifiedMissingCandidates =
              await verifyPlanRooms(
                openai,
                result.crop,
                result.plan,
                missingCandidates
              );

            const verifiedCandidates =
              mergeVerifiedRoomPasses(
                result.firstVerifiedCandidates,
                verifiedMissingCandidates
              );

            const planRooms =
              verifiedCandidates
                .map((room) => {
                  const global =
                    roomGlobalCoordinates(
                      room,
                      result.crop.bbox
                    );

                  const normalized =
                    normalizeArchitecturalRoomLabel(
                      cleanCadText(
                        room?.label ||
                          room?.type
                      ),
                      room?.type
                    );

                  return {
                    label:
                      normalized.label,
                    type:
                      normalized.type,
                    x:
                      clamp01(global.x),
                    y:
                      clamp01(global.y),
                    confidence:
                      clamp01(
                        room?.confidence
                      ),
                    verificationConfidence:
                      clamp01(
                        room?.verificationConfidence
                      ),
                    verified:
                      room?.verified === true,
                    planId:
                      String(
                        result.plan?.id ||
                          `plan-${result.index + 1}`
                      ),
                    planTitle:
                      String(
                        result.plan?.title ||
                          ""
                      ),
                    source:
                      "openai_plan_region_verified_recovery",
                  };
                })
                .map((room) =>
                  resolveRoomPlanOwnership(
                    room,
                    plans
                  )
                );

            console.log(
              "[VENTRA ANALYZER] deferred room recovery",
              {
                plan:
                  result.plan?.title ||
                  result.plan?.id,
                firstPass:
                  result.firstVerifiedCandidates.map(
                    (room) => room.label
                  ),
                missingPass:
                  verifiedMissingCandidates.map(
                    (room) => room.label
                  ),
                combinedCount:
                  verifiedCandidates.length,
              }
            );

            return planRooms;
          }
        )
      );

    const recoveredRooms =
      reconcileRecoveredRoomOwnershipWithAudit(
        recoveredPlanResults.flat(),
        rawAuditedRooms
      );

    // Rooms deferred by the full-sheet audit are not discarded. They are
    // re-checked at their exact audited coordinates inside the corresponding
    // plan crop. This is much safer than treating a weak first plan pass as
    // proof that the room does not exist: the plan pass can miss real rooms,
    // especially on dense second-floor plans. At the same time, a hallucinated
    // audit-only room must survive an explicit visibility verification before
    // it can enter the authoritative inventory.
    const verifiedDeferredAuditRooms =
      (await Promise.all(
        planResults.map(async (result) => {
          const planId = String(
            result.plan?.id || `plan-${result.index + 1}`
          );
          const box = result.crop?.bbox;

          if (
            !box ||
            !Number.isFinite(Number(box.x)) ||
            !Number.isFinite(Number(box.y)) ||
            !Number.isFinite(Number(box.width)) ||
            !Number.isFinite(Number(box.height)) ||
            Number(box.width) <= 0 ||
            Number(box.height) <= 0
          ) {
            return [];
          }

          const deferredCandidates = rawAuditedRooms
            .filter((room) => {
              if (String(room?.planId || "") !== planId) return false;

              const rx = Number(room?.x);
              const ry = Number(room?.y);
              if (!Number.isFinite(rx) || !Number.isFinite(ry)) return false;

              const wasDeferred = auditOnlyRejections.some((rejected) =>
                String(rejected?.planId || "") === planId &&
                String(rejected?.label || "").trim().toUpperCase() ===
                  String(room?.label || "").trim().toUpperCase() &&
                String(rejected?.type || "") === String(room?.type || "") &&
                Math.abs((Number(rejected?.confidence) || 0) -
                  (Number(room?.confidence) || 0)) < 1e-6
              );

              return wasDeferred;
            })
            .map((room) => ({
              ...room,
              x: clamp01((Number(room.x) - Number(box.x)) / Number(box.width)),
              y: clamp01((Number(room.y) - Number(box.y)) / Number(box.height)),
            }));

          if (!deferredCandidates.length) return [];

          const verified = await verifyPlanRooms(
            openai,
            result.crop,
            result.plan,
            deferredCandidates
          );

          const accepted = verified
            .filter((room) => room?.verified === true && Number(room?.confidence) >= 0.62)
            .map((room) => {
              const global = roomGlobalCoordinates(room, box);
              const normalized = normalizeArchitecturalRoomLabel(
                cleanCadText(room?.label || room?.type),
                room?.type
              );

              return resolveRoomPlanOwnership(
                {
                  label: normalized.label,
                  type: normalized.type,
                  x: clamp01(global.x),
                  y: clamp01(global.y),
                  confidence: clamp01(room?.confidence),
                  verificationConfidence: clamp01(room?.verificationConfidence),
                  verified: true,
                  planId,
                  planTitle: String(result.plan?.title || ""),
                  source: "openai_full_sheet_audit_verified_deferred",
                },
                plans
              );
            });

          console.log(
            "[VENTRA ANALYZER] deferred audit-room verification",
            {
              plan: result.plan?.title || result.plan?.id,
              candidates: deferredCandidates.map((room) => room.label),
              accepted: accepted.map((room) => room.label),
            }
          );

          return accepted;
        })
      )).flat();

    authoritativeRooms =
      mergeVerifiedRoomPasses(
        mergeVerifiedRoomPasses(
          recoveredRooms,
          auditedRooms
        ),
        verifiedDeferredAuditRooms
      );
  }

  rawRooms.length = 0;
  rawRooms.push(
    ...authoritativeRooms
  );

  console.log(
    "[VENTRA ANALYZER] full-sheet room audit",
    {
      authoritative:
        useAuditAsAuthority,
      planRooms:
        authoritativeRooms.length,
      auditedCount:
        auditedRooms.length,
      rawAuditedCount:
        rawAuditedRooms.length,
      deferredAuditOnlyCount:
        auditOnlyRejections.length,
      auditConfidence:
        Number(
          auditConfidence.toFixed(
            3
          )
        ),
      audited:
        auditedRooms.map(
          (room) => ({
            label:
              room.label,
            plan:
              room.planId,
            confidence:
              room.confidence,
          })
        ),
    }
  );

  const dedupedRooms =
    dedupeRooms(
      rawRooms
    );

  const acceptedRooms =
    dedupedRooms.filter(
      (room) =>
        room.verified === true &&
        room.confidence >= 0.62
    );

  const reviewRooms =
    dedupedRooms.filter(
      (room) =>
        room.confidence >= 0.35 &&
        !(
          room.verified === true &&
          room.confidence >= 0.62
        )
    );

  // APS exact printed text is strong corroboration. If OpenAI sees the same
  // label at all, lift it above the acceptance threshold rather than requiring
  // duplicated OCR observations.
  const trustedKeys =
    new Set(
      apsEvidence.trusted.map(
        (item) =>
          `${item.type}::${item.label.toUpperCase()}`
      )
    );

  for (const room of reviewRooms) {
    const key =
      `${room.type}::${room.label.toUpperCase()}`;

    if (
      trustedKeys.has(key)
    ) {
      room.confidence =
        Math.max(
          room.confidence,
          0.86
        );
      acceptedRooms.push(
        room
      );
    }
  }

  const finalAccepted =
    dedupeRooms(
      acceptedRooms
    );

  const acceptedKey =
    new Set(
      finalAccepted.map(
        (room) =>
          `${room.planId}:${room.type}:${room.x.toFixed(
            4
          )}:${room.y.toFixed(
            4
          )}`
      )
    );

  const finalReview =
    reviewRooms.filter(
      (room) =>
        !acceptedKey.has(
          `${room.planId}:${room.type}:${room.x.toFixed(
            4
          )}:${room.y.toFixed(
            4
          )}`
        )
    );

  const sumVisual =
    (key) => {
      let total = 0;
      let weighted = 0;
      let weight = 0;

      for (const plan of planAnalyses) {
        total +=
          Number(
            plan?.[key]
          ) || 0;

        const confidence =
          Number(
            plan?.openingConfidence
          ) || 0;

        weighted +=
          confidence;
        weight += 1;
      }

      return {
        total,
        confidence:
          weight > 0
            ? weighted /
              weight
            : 0,
      };
    };

  const visualDoors =
    sumVisual("doors");
  const visualWindows =
    sumVisual(
      "windows"
    );

  const minimalCadWindows =
    !layout?.windowSchedules?.length &&
    visualWindows.total === 0
      ? await detectMinimalCadWindowMarkers(
          source.buffer,
          sourceMeta,
          plans
        )
      : {
          count: 0,
          confidence: 0,
          source: "not_needed",
          markers: [],
        };

  async function scheduleQuantity(
    entries,
    kind
  ) {
    const candidates =
      (Array.isArray(entries)
        ? entries
        : []
      )
        .filter(
          (entry) =>
            Number(
              entry?.confidence
            ) >= 0.5
        )
        .slice(0, 2);

    for (const entry of candidates) {
      const crop =
        await cropRegion(
          source.buffer,
          sourceMeta,
          entry.bbox,
          `${kind}-schedule`
        );

      const parsed =
        await analyzeSchedule(
          openai,
          crop,
          kind
        );

      const quantityHeader =
        String(
          parsed?.quantityHeaderText || ""
        ).trim();

      const headerLooksLikeQuantity =
        /\b(?:QTY|QUANTITY|COUNT|NO\.?\s*OF|NUMBER\s*OF)\b/i.test(
          quantityHeader
        );

      const firstRows =
        Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];

      const rowArithmeticConsistent = (row) => {
        const quantity = Number(row?.quantity);
        if (!Number.isInteger(quantity) || quantity < 0) return false;

        const cost = Number(row?.cost);
        const total = Number(row?.total);
        if (!Number.isFinite(cost) || !Number.isFinite(total)) return true;

        const expected = quantity * cost;
        return (
          Math.abs(expected - total) <=
          Math.max(0.5, Math.abs(total) * 0.02)
        );
      };

      const strongSinglePassSchedule =
        headerLooksLikeQuantity &&
        Number(parsed?.confidence) >= 0.94 &&
        firstRows.length > 0 &&
        firstRows.every(
          (row) =>
            Number(row?.confidence) >= 0.94 &&
            rowArithmeticConsistent(row)
        );

      const verifiedRows =
        strongSinglePassSchedule
          ? firstRows.map((row) => ({
              ...row,
              verifiedQuantity: Number(row.quantity),
              verificationConfidence: Math.min(
                Number(row?.confidence) || 0,
                Number(parsed?.confidence) || 0
              ),
              arithmeticValid: true,
              verificationSource: "high_confidence_schedule_fast_path",
            }))
          : await verifyScheduleRows(
              openai,
              source.buffer,
              sourceMeta,
              crop,
              kind,
              parsed
            );

      if (strongSinglePassSchedule) {
        console.log(
          "[VENTRA ANALYZER] schedule verification fast-path",
          {
            kind,
            rows: firstRows.length,
            confidence: Number(parsed?.confidence) || 0,
          }
        );
      }

      const allRowsVerified =
        verifiedRows.length > 0 &&
        verifiedRows.every(
          (row) => {
            const firstPass =
              Number(
                row?.quantity
              );
            const verified =
              Number(
                row?.verifiedQuantity
              );

            return (
              Number.isInteger(
                firstPass
              ) &&
              firstPass >= 0 &&
              Number.isInteger(
                verified
              ) &&
              verified >= 0 &&
              firstPass ===
                verified &&
              row?.arithmeticValid !==
                false &&
              Number(
                row?.verificationConfidence
              ) >= 0.78
            );
          }
        );

      if (
        headerLooksLikeQuantity &&
        allRowsVerified
      ) {
        const quantities =
          verifiedRows.map(
            (row) =>
              Number(
                row.quantity
              )
          );

        const calculatedTotal =
          quantities.reduce(
            (sum, value) =>
              sum + value,
            0
          );

        console.log(
          "[VENTRA ANALYZER] verified schedule row sum",
          {
            accepted: true,
            kind,
            header:
              quantityHeader,
            rows:
              verifiedRows.map(
                (row) => ({
                  mark:
                    row.mark,
                  quantity:
                    row.quantity,
                  verified:
                    row.verifiedQuantity,
                  arithmeticValid:
                    row.arithmeticValid !== false,
                  confidence:
                    row.verificationConfidence,
                })
              ),
            calculatedTotal,
          }
        );

        if (
          calculatedTotal > 200
        ) {
          console.warn(
            "[VENTRA ANALYZER] schedule total rejected as implausible",
            {
              kind,
              calculatedTotal,
            }
          );

          continue;
        }

        return {
          value:
            calculatedTotal,
          confidence:
            Math.min(
              ...verifiedRows.map(
                (row) =>
                  Number(
                    row.verificationConfidence
                  ) || 0
              )
            ),
          source:
            `${kind}_schedule_verified_row_sum`,
          evidence: {
            header:
              quantityHeader,
            rows:
              verifiedRows,
          },
        };
      }

      console.warn(
        "[VENTRA ANALYZER] schedule verification rejected",
        {
          kind,
          header:
            quantityHeader,
          rowCount:
            verifiedRows.length,
          allRowsVerified,
          mismatches:
            verifiedRows
              .map(
                (row, index) => ({
                  index,
                  mark:
                    row?.mark || "",
                  firstPass:
                    row?.quantity ?? null,
                  verified:
                    row?.verifiedQuantity ?? null,
                  confidence:
                    row?.verificationConfidence || 0,
                })
              )
              .filter(
                (row) =>
                  Number(row.firstPass) !==
                    Number(row.verified) ||
                  !Number.isInteger(
                    Number(row.firstPass)
                  ) ||
                  !Number.isInteger(
                    Number(row.verified)
                  )
              ),
          firstPassConfidence:
            Number(
              parsed?.confidence
            ) || 0,
        }
      );
    }

    return null;
  }

  const [
    scheduleDoors,
    scheduleWindows,
  ] =
    await schedulePromise;

  function chooseOpening(
    schedule,
    visual,
    deterministicFallback = null
  ) {
    if (schedule) {
      return {
        value:
          schedule.value,
        confidence:
          schedule.confidence,
        status:
          "accepted",
        source:
          schedule.source,
      };
    }

    if (
      deterministicFallback &&
      Number(deterministicFallback.count) > 0 &&
      Number(deterministicFallback.confidence) >= 0.95
    ) {
      return {
        value:
          Number(deterministicFallback.count),
        confidence:
          Number(deterministicFallback.confidence),
        status:
          "accepted",
        source:
          deterministicFallback.source ||
          "autodesk_thumbnail_cad_window_marker",
      };
    }

    /*
     * Vision can positively detect openings, but "I did not see one"
     * is not proof that an opening does not exist.
     *
     * Positive visual counts may be accepted at high confidence.
     * Visual zero is never authoritative by itself.
     */
    if (
      visual.confidence >=
        0.90 &&
      Number(visual.total) > 0
    ) {
      return {
        value:
          Number(visual.total),
        confidence:
          visual.confidence,
        status:
          "accepted",
        source:
          "openai_plan_regions_positive_detection",
      };
    }

    return {
      value: null,
      confidence:
        visual.confidence,
      status:
        "needs_review",
      source:
        Number(visual.total) === 0
          ? "visual_zero_not_authoritative"
          : "unresolved",
    };
  }

  const doors =
    chooseOpening(
      scheduleDoors,
      visualDoors
    );
  const geometryWindows =
    geometryWindowCount !== null &&
    geometryWindowCount !== undefined &&
    geometryWindowCount !== "" &&
    Number.isFinite(Number(geometryWindowCount))
      ? {
          count: Math.max(0, Number(geometryWindowCount)),
          confidence: 1,
          source: "aps_geometry",
        }
      : null;

  const windows =
    chooseOpening(
      scheduleWindows,
      visualWindows,
      geometryWindows &&
        Number(geometryWindows.count) > 0
        ? geometryWindows
        : minimalCadWindows
    );

  for (const planAnalysis of planAnalyses) {
    planAnalysis.rooms = finalAccepted.filter(
      (room) =>
        String(room?.planId || "") ===
        String(planAnalysis?.planId || "")
    ).length;
  }

  console.log(
    "[VENTRA ANALYZER] final",
    {
      rooms:
        finalAccepted.map(
          (room) => ({
            label:
              room.label,
            type:
              room.type,
            plan:
              room.planId,
            confidence:
              room.confidence,
            verified:
              room.verified === true,
            verificationConfidence:
              room.verificationConfidence || null,
          })
        ),
      needsReview:
        finalReview.map(
          (room) => ({
            label:
              room.label,
            type:
              room.type,
            confidence:
              room.confidence,
          })
        ),
      doors,
      windows,
      planAnalyses,
    }
  );

  return {
    labels:
      finalAccepted,
    openings: {
      doors:
        doors.value,
      windows:
        windows.value,
      confidence:
        Math.min(
          doors.confidence ||
            0,
          windows.confidence ||
            0
        ),
      source:
        "aps_openai_sheet_plan_analysis_non_authoritative_openings",
    },
    validation: {
      rooms: {
        accepted:
          finalAccepted,
        needsReview:
          finalReview,
        acceptedCount:
          finalAccepted.length,
        reviewCount:
          finalReview.length,
      },
      openings: {
        doors,
        windows,
      },
    },
    apsEvidence: {
      rawCount:
        apsEvidence.raw.length,
      trustedCount:
        apsEvidence.trusted.length,
      labels:
        apsEvidence.trusted,
    },
    sheet: {
      source:
        source.source,
      width:
        sourceMeta.width,
      height:
        sourceMeta.height,
      layoutConfidence:
        Number(
          layout?.confidence
        ) || 0,
      plans:
        planAnalyses,
    },
    analysisMode:
      "aps_openai_sheet_plan_orchestrator_deterministic",
    analyzerVersion:
      ANALYZER_VERSION,
    cached: false,
  };
}

async function handleRoomLabels(
  request
) {
  try {
    const body =
      await request.json();

    const urn =
      body?.urn || null;
    const image =
      body?.image || null;
    const geometryWindowCount =
      body?.geometryWindowCount ?? null;
    const recoveryOnly =
      body?.recoveryOnly === true;
    const analysisRunId =
      String(
        body?.analysisRunId ||
          "default"
      );

    // A translated Autodesk document gets ONE authoritative analysis result
    // for the lifetime of this analyzer version. Viewer callbacks and React
    // rerenders must not create different takeoff answers for the same URN.
    const imageFingerprint =
      typeof image === "string"
        ? `${image.length}:${image.slice(
            -32
          )}`
        : "no-image";

    const cacheNamespace =
      recoveryOnly
        ? `${ANALYZER_VERSION}::${body.projectId}::${String(body.requestId).split(':')[0]}::room-recovery-v28`
        : `${ANALYZER_VERSION}::${body.projectId}::${String(body.requestId).split(':')[0]}`;

    const cacheKey =
      urn
        ? `${cacheNamespace}::${urn}`
        : `${cacheNamespace}::no-urn::${analysisRunId}::${imageFingerprint}`;

    const cached =
      analysisCache.get(
        cacheKey
      );

    if (
      cached &&
      Date.now() -
        cached.createdAt <
        CACHE_TTL_MS
    ) {
      return NextResponse.json({
        ...cached.result,
        cached: true,
      });
    }

    const pending =
      inFlight.get(
        cacheKey
      );

    if (pending) {
      const result =
        await pending;
      return NextResponse.json({
        ...result,
        cached: true,
      });
    }

    const promise =
      recoveryOnly
        ? executeLowCostRoomRecovery({
            image,
            urn,
          })
        : executeAnalysis({
            image,
            urn,
            geometryWindowCount,
          });

    inFlight.set(
      cacheKey,
      promise
    );

    try {
      const result =
        await promise;

      analysisCache.set(
        cacheKey,
        {
          createdAt:
            Date.now(),
          result,
        }
      );

      return NextResponse.json(
        result
      );
    } finally {
      inFlight.delete(
        cacheKey
      );
    }
  } catch (error) {
    console.error(
      "[VENTRA ANALYZER]",
      error
    );

    return NextResponse.json(
      {
        labels: [],
        openings: {
          doors: null,
          windows: null,
          confidence: 0,
          source:
            "analysis_failed",
        },
        validation: {
          rooms: {
            accepted: [],
            needsReview: [],
            acceptedCount: 0,
            reviewCount: 0,
          },
          openings: {
            doors: {
              status:
                "needs_review",
            },
            windows: {
              status:
                "needs_review",
            },
          },
        },
        error:
          error instanceof Error
            ? error.message
            : "Drawing analysis failed.",
      },
      {
        status: 502,
      }
    );
  }
}

export async function POST(request){return commercialRun(request,"drawing",handleRoomLabels);}
