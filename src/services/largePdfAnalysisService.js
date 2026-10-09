import { extractPdfPage, loadPdf } from "@/services/pdfService";
import { runPageQueue } from "@/services/queueService";

const DEFAULT_CONCURRENCY = 2;

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function mergeDetectedItems(pageResults) {
  const merged = new Map();

  for (const page of pageResults) {
    for (const item of page.detected_items || []) {
      const name = String(item.name || "Unknown item").trim();
      const unit = String(item.unit || "item").trim();
      const key = `${name.toLowerCase()}::${unit.toLowerCase()}`;
      const current = merged.get(key);

      if (!current) {
        merged.set(key, {
          name,
          quantity: Number(item.quantity) || 0,
          unit,
          description: item.description || "",
          pages: [page.pageNumber],
        });
        continue;
      }

      current.quantity += Number(item.quantity) || 0;
      current.pages.push(page.pageNumber);

      if (!current.description && item.description) {
        current.description = item.description;
      }
    }
  }

  return Array.from(merged.values()).map((item) => ({
    ...item,
    quantity: round(item.quantity),
    pages: [...new Set(item.pages)].sort((a, b) => a - b),
  }));
}

function mergePageResults(
  successfulPages,
  failedPages,
  totalPages
) {
  const confidenceValues =
    successfulPages
      .map((page) =>
        Number(page.confidence)
      )
      .filter(Number.isFinite);

  const confidence =
    confidenceValues.length
      ? confidenceValues.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        confidenceValues.length
      : 0;

  const rooms =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(page.rooms) || 0),
      0
    );

  const doors =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(page.doors) || 0),
      0
    );

  const windows =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(page.windows) || 0),
      0
    );

  const originalWallLength =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(
          page.wall_length
        ) || 0),
      0
    );

  const originalWallArea =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(
          page.wall_area
        ) || 0),
      0
    );

  const floorArea =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(
          page.floor_area
        ) || 0),
      0
    );

  const ceilingArea =
    successfulPages.reduce(
      (sum, page) =>
        sum +
        (Number(
          page.ceiling_area
        ) || 0),
      0
    );

  const defaultWallHeight = 3;

  let finalWallLength =
    originalWallLength;

  let wallLengthEstimated = false;

  if (
    finalWallLength <= 0 &&
    floorArea > 0
  ) {
    const externalPerimeter =
      4 * Math.sqrt(floorArea);

    const averageRoomWidth =
      rooms > 0
        ? Math.sqrt(
            floorArea / rooms
          )
        : 0;

    const internalPartitions =
      rooms > 1
        ? averageRoomWidth *
          (rooms - 1)
        : 0;

    finalWallLength =
      externalPerimeter +
      internalPartitions;

    wallLengthEstimated = true;
  }

  const finalWallArea =
    originalWallArea > 0
      ? originalWallArea
      : finalWallLength > 0
        ? finalWallLength *
          defaultWallHeight
        : 0;

  const notes = [
    `Analyzed ${successfulPages.length} of ${totalPages} pages individually.`,
  ];

  if (failedPages.length) {
    notes.push(
      `Failed pages: ${failedPages
        .map(
          (page) =>
            page.pageNumber
        )
        .join(", ")}.`
    );
  }

  if (wallLengthEstimated) {
    notes.push(
      `Wall length was estimated from ${round(
        floorArea
      )} m² floor area and ${rooms} detected rooms.`
    );
  }

  if (
    originalWallArea <= 0 &&
    finalWallLength > 0
  ) {
    notes.push(
      `Wall area was calculated using ${round(
        finalWallLength
      )} m wall length × ${defaultWallHeight} m default wall height.`
    );
  }

  notes.push(
    "Quantities are preliminary and may include repeated items across plans, details, elevations and schedules. A quantity surveyor must review the merged result."
  );

  return {
    rooms,

    doors,

    windows,

    wall_length:
      round(finalWallLength),

    wall_area:
      round(finalWallArea),

    wall_height:
      defaultWallHeight,

    floor_area:
      round(floorArea),

    ceiling_area:
      round(ceilingArea),

    confidence:
      round(
        wallLengthEstimated
          ? Math.min(
              confidence,
              45
            )
          : confidence,
        1
      ),

    wall_length_estimated:
      wallLengthEstimated,

    wall_area_estimated:
      originalWallArea <= 0 &&
      finalWallLength > 0,

    wall_length_source:
      originalWallLength > 0
        ? "ai_page_analysis"
        : wallLengthEstimated
          ? "floor_area_room_estimate"
          : "unavailable",

    wall_area_source:
      originalWallArea > 0
        ? "ai_page_analysis"
        : finalWallLength > 0
          ? "wall_length_x_default_height"
          : "unavailable",

    wall_height_source:
      originalWallArea > 0
        ? "ai_page_analysis"
        : "project_default",

    notes:
      notes.join(" "),

    detected_items:
      mergeDetectedItems(
        successfulPages
      ),

    total_pages:
      totalPages,

    analyzed_pages:
      successfulPages.length,

    failed_pages:
      failedPages,

    page_results:
      successfulPages,
  };
}

async function downloadPdf(fileUrl) {
  const response = await fetch(fileUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Could not download the PDF for analysis (${response.status}).`
    );
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("pdf")) {
    throw new Error("The secure file URL did not return a PDF document.");
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function analyzeLargePdf({
  fileUrl,
  fileName,
  projectName = "",
  discipline = "",
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const fileBytes = await downloadPdf(fileUrl);
  const { pdf, totalPages } = await loadPdf(fileBytes);
  const pages = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    pages.push({
      pageNumber: pageIndex + 1,
      bytes: await extractPdfPage(pdf, pageIndex),
    });
  }

  const queueResults = await runPageQueue({
    pages,
    concurrency,
    context: {
      sourceFileName: fileName,
      projectName,
      discipline,
    },
  });

  const successfulPages = queueResults
    .filter((entry) => entry.success)
    .map((entry) => entry.result)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const failedPages = queueResults
    .filter((entry) => !entry.success)
    .map((entry) => ({
      pageNumber: entry.pageNumber,
      error: entry.error,
    }));

  if (successfulPages.length === 0) {
    throw new Error(
      failedPages[0]?.error || "No PDF pages could be analyzed."
    );
  }

  return mergePageResults(successfulPages, failedPages, totalPages);
}
