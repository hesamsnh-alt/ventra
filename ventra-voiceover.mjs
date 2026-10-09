// Run from the Ventra project directory: node .\ventra-voiceover.mjs
// Requires Node.js 20.12+ (or a current Node.js LTS). No npm packages needed.
// Reads OPENAI_TTS_API_KEY, falling back to OPENAI_API_KEY, from .env.local.
// --preview makes a short voice sample. --dry-run makes no API call.
// Each normal execution makes ONE paid OpenAI speech request. No auto-retries.
import fs from 'node:fs/promises';
import path from 'node:path';

const narration = `Every building starts with a plan. But delivering it takes more than drawings. It takes clear quantities, considered costs, coordinated work, and decisions you can explain.

Meet Ventra. A construction workspace that brings the project story together.

Start in your dashboard. Open a project and keep its drawings, documents, commercial details, and day-to-day updates within reach.

In the Drawing Center, upload your source files. Work with supported images, PDFs, and CAD documents through the appropriate analysis workflow. Review extracted information against the original drawing before relying on it.

Explore the three-dimensional model. Orbit around the space, inspect rooms and openings, and review the layout from different angles. Use the preview to make design conversations clearer, and check the result against your plans.

Move into the bill of quantities. Review measured quantities, edit descriptions, adjust rates, and organise the scope. Add overhead, profit, discount, and tax to shape your commercial offer. Budget rates remain yours to verify.

Open Estimate to review the cost breakdown. Then move to Quotation. Refine your line items, add your company identity and logo, and prepare a document that represents your business.

In Team and Contract, organise project access and record the agreement's payment stages. Define the advance, milestone percentages, and final settlement so the payment plan is clear.

Use Schedule to plan activities and dates. Use Tasks to record responsibilities, priorities, and status. Keep these planning drafts current as the work changes.

Track overall progress with project updates. Capture daily reports, organise supporting documents, and review the activity view. Keep site records close to the decisions they support. Progress needs your team's review; a photograph alone is not proof of completion.

Beyond the workspace, explore the engineering tools, manage your account and billing, and reach support when you need help.

From design review to quantities. From estimates to quotations. From planning to project records. Ventra helps you bring the details into focus.

Ventra. Build your next decision on a clearer view.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--preview'].includes(arg))) {
    throw new Error('Use: node ventra-voiceover.mjs [--preview] [--dry-run]');
  }
  const preview = args.includes('--preview');
  const input = preview ? narration.split('\n\n').slice(0, 2).join('\n\n') : narration;
  if (input.length > 4096) throw new Error('Narration exceeds the speech input limit.');
  if (args.includes('--dry-run')) {
    console.log(`Validation passed. ${input.length} characters, ${input.split(/\s+/).length} words. No API call made.`);
    console.log(input);
    return;
  }
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('Node.js 20.12 or newer is required. Check your version with: node --version');
  }
  try { process.loadEnvFile(path.resolve('.env.local')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read .env.local. Check its format.'); }
  const key = (process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  if (!key || /YOUR_|HERE|\.\.\./i.test(key)) {
    throw new Error('No usable key found. Run this script from ventra, beside .env.local containing OPENAI_API_KEY. Never send the key in chat.');
  }
  const outputDir = path.resolve('ventra-voiceover-output');
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(outputDir, `ventra-${preview ? 'sample' : 'narration'}-${stamp}`);
  console.log(`Generating ${preview ? 'short sample' : 'full English narration'} using OpenAI. This uses paid API credit.`);
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts', voice: 'cedar', response_format: 'mp3',
        input,
        instructions: 'Deliver a polished English construction technology brand narration. Confident, warm, articulate, understated energy. Natural pacing with brief pauses between paragraphs. No exaggerated announcer voice. Say Ventra as VEN-truh, BOQ as B O Q, CAD as cad. Read only the supplied text. Do not add music or sound effects.',
      }),
      signal: AbortSignal.timeout(240000),
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'Request timed out. No automatic retry was made. Check API usage before retrying.' : 'Network request failed. Check your internet connection. No automatic retry was made.');
  }
  if (!response.ok) {
    const messages = {
      401: 'The API key was rejected. Check it locally; do not share it.',
      403: 'This key/project does not have permission for the requested speech model.',
      429: 'API quota or rate limit reached. Check API Billing and usage. ChatGPT subscription credit is separate.',
      400: 'The speech request was rejected. Check model and voice availability in your API project.',
    };
    throw new Error(`HTTP ${response.status}: ${messages[response.status] || 'Speech service failed. No automatic retry was made.'}`);
  }
  if (!/audio\//i.test(response.headers.get('content-type') || '')) throw new Error('Expected audio but received a different response type. Nothing saved as MP3.');
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); }
  catch { throw new Error('Audio download was interrupted. Check API usage before retrying.'); }
  if (bytes.length < 1024) throw new Error('Audio response is unexpectedly small. No MP3 saved.');
  await fs.writeFile(`${base}.mp3`, bytes, { flag: 'wx' });
  await fs.writeFile(`${base}.txt`, input, { flag: 'wx' });
  console.log(`\nSaved audio: ${base}.mp3\nSaved transcript: ${base}.txt\nUpload the MP3 here for editing. Do not upload .env.local.\nPublication note: disclose that the narration is AI-generated.`);
}

main().catch(error => { console.error(`\n${error.message}`); process.exitCode = 1; });
