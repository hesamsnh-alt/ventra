import "server-only";

import { analyzeLargePdf } from "@/services/largePdfAnalysisService";
import { createResponse } from "@/services/openaiClient";
import { buildTakeoffPrompt } from "@/services/promptBuilder";
import { parseTakeoffResponse } from "@/services/responseParser";
import { takeoffSchema } from "@/services/takeoffSchema";
import { validateUploadedFile } from "@/services/fileValidator";

const DRAWING_MODEL = process.env.OPENAI_DRAWING_MODEL || "gpt-5";

function buildFileContent({ fileUrl, fileName, isImage }) {
  if (isImage) {
    return { type: "input_image", image_url: fileUrl, detail: "high" };
  }

  return { type: "input_file", file_url: fileUrl, filename: fileName };
}

export async function analyzeSingleDrawing({
  fileUrl,
  fileName,
  fileType,
  pageNumber = null,
  projectName = "",
  discipline = "",
}) {
  const fileInfo = validateUploadedFile({ fileUrl, fileName, fileType });
  const prompt = buildTakeoffPrompt({ pageNumber, projectName, discipline });

  const response = await createResponse({
    model: DRAWING_MODEL,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          buildFileContent({ fileUrl, fileName, isImage: fileInfo.isImage }),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "construction_takeoff",
        description: "Preliminary construction quantity takeoff extracted from a drawing.",
        strict: true,
        schema: takeoffSchema,
      },
    },
  });

  return parseTakeoffResponse(response);
}

export async function analyzeDrawing(input) {
  const fileName = String(input?.fileName || "");
  const fileType = String(input?.fileType || "").toLowerCase();
  const isPdf = fileType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return analyzeLargePdf(input);
  }

  return analyzeSingleDrawing(input);
}
