import "server-only";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function askProject(question, knowledge) {
  const response = await openai.responses.create({
    model: "gpt-5.1",

    input: [
      {
        role: "system",
        content: `
You are a senior Quantity Surveyor,
Construction Engineer,
and Estimator.

Answer ONLY using the provided project data.

If the answer is not available,
say you don't know.

Never invent quantities.
`,
      },

      {
        role: "user",
        content: JSON.stringify({
          question,
          knowledge,
        }),
      },
    ],
  });

  return response.output_text;
}