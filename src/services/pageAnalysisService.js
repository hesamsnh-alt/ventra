import "server-only";
import { getOpenAIClient } from "@/services/openaiClient";
import { buildTakeoffPrompt } from "@/services/promptBuilder";
import { parseTakeoffResponse } from "@/services/responseParser";
import { takeoffSchema } from "@/services/takeoffSchema";

const PAGE_MODEL =
  process.env.OPENAI_DRAWING_MODEL ||
  "gpt-5";

function toUploadFile(pageBytes, fileName) {
  return new File(
    [pageBytes],
    fileName,
    {
      type: "application/pdf",
    }
  );
}

async function removeUploadedFile(
  openai,
  fileId
) {
  if (!fileId) {
    return;
  }

  try {
    await openai.files.delete(fileId);

    console.log(
      "[Page Analysis] Temporary file deleted",
      {
        fileId,
      }
    );
  } catch (error) {
    console.warn(
      "[Page Analysis] Could not delete temporary file",
      {
        fileId,
        message: error?.message,
        status: error?.status,
        code: error?.code,
      }
    );
  }
}

export async function analyzeDrawingPage({
  pageBytes,
  pageNumber,
  projectName = "",
  discipline = "",
  sourceFileName = "drawing.pdf",
}) {
  if (!pageBytes?.length) {
    throw new Error(
      `Page ${pageNumber} is empty.`
    );
  }

  const openai =
    getOpenAIClient();

  let uploadedFile = null;

  const cleanSourceFileName =
    String(sourceFileName || "drawing.pdf")
      .replace(/\.pdf$/i, "")
      .replace(/[^\w.-]+/g, "-");

  const temporaryFileName =
    `${cleanSourceFileName}-page-${pageNumber}.pdf`;

  console.log(
    "[Page Analysis] Started",
    {
      pageNumber,
      sourceFileName,
      temporaryFileName,
      byteLength: pageBytes.length,
      model: PAGE_MODEL,
    }
  );

  try {
    uploadedFile =
      await openai.files.create({
        file: toUploadFile(
          pageBytes,
          temporaryFileName
        ),
        purpose: "user_data",
      }, {maxRetries:0});

    if (!uploadedFile?.id) {
      throw new Error(
        `OpenAI file upload failed for page ${pageNumber}.`
      );
    }

    console.log(
      "[Page Analysis] File uploaded",
      {
        pageNumber,
        fileId: uploadedFile.id,
        fileName:
          uploadedFile.filename ||
          temporaryFileName,
        status:
          uploadedFile.status ||
          "uploaded",
      }
    );

    const response =
      await openai.responses.create({
        model: PAGE_MODEL,
        max_output_tokens: 12000,
        ...(/^gpt-5(?:$|-\d)/.test(PAGE_MODEL)?{reasoning:{effort:'minimal'}}:{}),

        input: [
          {
            role: "user",

            content: [
              {
                type: "input_text",

                text: buildTakeoffPrompt({
                  pageNumber,
                  projectName,
                  discipline,
                }),
              },

              {
                type: "input_file",
                file_id:
                  uploadedFile.id,
              },
            ],
          },
        ],

        text: {
          format: {
            type: "json_schema",

            name:
              "construction_takeoff_page",

            description:
              "Preliminary construction quantity takeoff extracted from one drawing page.",

            strict: true,

            schema:
              takeoffSchema,
          },
        },
      }, {maxRetries:0});

    if (!response) {
      throw new Error(
        `OpenAI returned an empty response for page ${pageNumber}.`
      );
    }
    if(response.status && response.status!=='completed')throw Object.assign(new Error(`PDF page ${pageNumber} response incomplete: ${response.incomplete_details?.reason||response.status}. Partial output withheld; no automatic retry.`),{code:'PDF_PAGE_RESPONSE_INCOMPLETE'});

    console.log(
      "[Page Analysis] OpenAI response received",
      {
        pageNumber,
        responseId:
          response?.id || null,
        status:
          response?.status || null,
        usage: response?.usage || null,
      }
    );

    const parsedResult =
      parseTakeoffResponse(
        response
      );

    console.log(
      "[Page Analysis] Completed",
      {
        pageNumber,
      }
    );

    return {
      pageNumber,
      ...parsedResult,
    };
  } catch (error) {
    console.error(
      "[Page Analysis] Failed",
      {
        pageNumber,
        name:
          error?.name ||
          "UnknownError",
        message:
          error?.message ||
          "Page analysis failed.",
        status:
          error?.status ||
          null,
        code:
          error?.code ||
          null,
        type:
          error?.type ||
          null,
        param:
          error?.param ||
          null,
        requestId:
          error?.request_id ||
          error?.requestId ||
          null,
        stack:
          error?.stack ||
          null,
      }
    );

    throw error;
  } finally {
    await removeUploadedFile(
      openai,
      uploadedFile?.id
    );
  }
}
