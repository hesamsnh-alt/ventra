import "server-only";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function classifyDrawingPage(fileUrl) {
  const response = await openai.responses.create({
    model: "gpt-5.1",

    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            file_url: fileUrl,
          },

          {
            type: "input_text",
            text: `
Identify this drawing page.

Return ONLY JSON.

{
"type":"",
"discipline":"",
"title":"",
"sheetNumber":""
}
`,
          },
        ],
      },
    ],
  });

  return JSON.parse(response.output_text);
}