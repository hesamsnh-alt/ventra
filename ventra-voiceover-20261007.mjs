import fs from "node:fs/promises";
import path from "node:path";

const text = `Every construction project starts with a vision. Turning that vision into a finished building means bringing drawings, quantities, budgets, people, and deadlines together.

Meet Ventra. Your connected workspace for construction planning, estimating, and project records.

Start with your dashboard. Create a project, add its client, location, budget, and planned dates. Keep drawings, documents, costs, and updates within reach.

In the Drawing Center, upload your source files. Supported image plans and engineering files use their appropriate workflows. Review extracted information against the original drawing before relying on it.

Explore an interactive three-dimensional preview. Rotate the space, inspect walls and openings, review furniture and finishes, and export a view for your client. For supported engineering files, inspect the source through the engineering viewer. Always verify construction dimensions against the original plans.

Move into the Bill of Quantities. Review quantities and units, edit descriptions, and refine the scope. In Estimate, check the cost breakdown and adjust rates for your suppliers and contractors. Shape your commercial offer with the available overhead, profit, discount, and tax controls.

Prepare your Quotation. Review line items and totals, add your company identity and logo, and create a professional proposal.

Now connect your quantities to your execution plan with the new BOQ Schedule.

Load the project's BOQ and review its activity sections, from preparation and structural work to electrical, plumbing, mechanical installations, and finishes.

Choose an execution method for each activity. Compare options such as pumped or manual concrete placement. Use an available reference rate as a starting point, or enter your contractor's production rate where a rate is missing.

Set the number of crews, working hours, breaks, and productive time. Select working days, add holidays, and include required waiting periods. Ventra calculates proposed durations and dates from these inputs.

Review the activity order. The current schedule uses a conservative sequential work plan. Check it against your site's requirements, then save a shared baseline for your team.

As work progresses, update the checklist. Tick Done for completed activities, or save a partial completion percentage for work still underway.

The schedule summary weights progress by estimated work effort. Compare reported completion with the baseline. Behind-schedule and overdue activities appear in red. Completed work appears in green. Keep baseline dates fixed so delays remain visible.

In Team and Contract, organise access and record the agreement's payment stages. Define advance payments, milestone percentages, and final settlement. Schedule progress supports review; it does not automatically approve payments.

Use Tasks to track responsibilities and status. Capture daily reports, organise site photos and supporting documents, and review project activity. Site evidence supports your team's assessment; a photograph alone does not prove completion.

Invite project members with appropriate access. Authorised members can update the shared schedule. Viewers can follow it without changing the plan.

Explore the engineering tools for supporting calculations and conversions. Manage your account and subscription through Profile and Billing, and reach Support when you need assistance.

See the design. Review the quantities. Build the budget. Plan the work. Track the progress.

Ventra. Bring your construction project into focus.`;

async function main() {
  if (text.length > 4096) throw new Error("Narration is too long.");
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("Node.js 20.12 or newer is required.");
  }

  try {
    process.loadEnvFile(path.resolve(".env.local"));
  } catch {
    throw new Error("Cannot load .env.local. Run from the Ventra folder.");
  }

  const key = (
    process.env.OPENAI_TTS_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();

  if (!key) throw new Error("No API key found in .env.local.");

  const dir = path.resolve("ventra-voiceover-output");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `ventra-narration-new-${stamp}`);

  console.log("Generating English narration. Please wait...");
  console.log("This makes one paid API request. No automatic retries.");

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "cedar",
        response_format: "mp3",
        input: text,
        instructions: "Read this English construction technology narration with a confident, warm, natural professional voice. Clear articulation, steady pacing, brief pauses between paragraphs. Say Ventra as VEN-truh, BOQ as B O Q. Read only the supplied text. No music or sound effects."
      }),
      signal: AbortSignal.timeout(240000)
    });
  } catch {
    throw new Error("Network failure or timeout. Check API usage before retrying.");
  }

  if (!response.ok) {
    const hint = {
      400: "Speech request rejected. Check model and voice access.",
      401: "API key rejected. Check it locally.",
      403: "API project permission denied.",
      429: "API quota or rate limit reached. Check API billing."
    };
    throw new Error(`HTTP ${response.status}: ${hint[response.status] || "Speech service failed."}`);
  }

  if (!/audio\//i.test(response.headers.get("content-type") || "")) {
    throw new Error("Response was not audio. No MP3 saved.");
  }

  let audio;
  try {
    audio = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error("Audio download interrupted. Check API usage before retrying.");
  }
  if (audio.length < 1024) throw new Error("Audio response was too small.");

  await fs.writeFile(`${base}.mp3`, audio, { flag: "wx" });
  await fs.writeFile(`${base}.txt`, text, { flag: "wx" });

  console.log("SUCCESS");
  console.log(`Audio: ${base}.mp3`);
  console.log(`Transcript: ${base}.txt`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
