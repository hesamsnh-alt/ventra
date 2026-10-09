export function parseTakeoffResponse(response) {
  if (!response) {
    throw new Error(
      "No response was received from OpenAI."
    );
  }

  if (!response.output_text) {
    throw new Error(
      "OpenAI returned an empty response."
    );
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new Error(
      "OpenAI returned invalid JSON."
    );
  }
}