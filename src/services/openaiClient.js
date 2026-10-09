import "server-only";
import OpenAI from "openai";

let openaiClient = null;

export function getOpenAIClient() {
  if (openaiClient) {
    return openaiClient;
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is missing from .env.local."
    );
  }

  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return openaiClient;
}

export async function createResponse(payload) {
  const openai = getOpenAIClient();

  return openai.responses.create(payload);
}